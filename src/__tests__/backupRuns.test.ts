import AsyncStorage from '@react-native-async-storage/async-storage';
import { setDoc } from '@react-native-firebase/firestore';
import { deriveBackupId, generateCode, normalizeCode } from '../backup';
import { saveCode } from '../backupState';
import * as sync from '../sync';
import { backupEverything } from '../sync';
import { saveMonth } from '../storage';
import { saveTasks } from '../tasks';
import { loadLedger, markDirty, pendingKeys, recordBlocked } from '../syncLedger';
import { shouldRun, statusOf } from '../hooks/autoBackupPolicy';
import {
  backupNow,
  endLaunch,
  forgetLaunch,
  launchMemory,
  launchMoment,
  retryEverything,
  runAndSettle,
} from '../hooks/backupRuns';
import { emptyMonthData } from '../types';
import type { Task } from '../tasks';

const mockLocal = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockLocal.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockLocal.set(k, v);
    }),
    getAllKeys: jest.fn(async () => [...mockLocal.keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map((k) => [k, mockLocal.get(k) ?? null])),
  },
}));

jest.mock('expo-secure-store', () => {
  const keychain = new Map<string, string>();
  return {
    __esModule: true,
    __keychain: keychain,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    isAvailableAsync: jest.fn(async () => true),
    getItemAsync: jest.fn(async (k: string) => keychain.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      keychain.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      keychain.delete(k);
    }),
  };
});

jest.mock('expo-crypto', () => ({
  __esModule: true,
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

const mockDocs = new Map<string, Record<string, unknown>>();
const mockServer = {
  signedIn: false,
  /** the error code every write comes back with, as an expired token would */
  refuseWith: null as string | null,
  /** or refuse only once this many writes have landed, which is how a run half works */
  refuseAfter: null as number | null,
  writes: 0,
};

jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  getAuth: () => ({
    get currentUser() {
      return mockServer.signedIn ? { uid: 'anon' } : null;
    },
  }),
  signInAnonymously: jest.fn(async () => {
    mockServer.signedIn = true;
  }),
}));

jest.mock('@react-native-firebase/app-check', () => ({
  __esModule: true,
  ReactNativeFirebaseAppCheckProvider: class {
    configure() {}
  },
  initializeAppCheck: jest.fn(),
  getToken: jest.fn(),
}));

jest.mock('@react-native-firebase/firestore', () => {
  const turnAway = () => {
    const refusing =
      mockServer.refuseWith !== null &&
      (mockServer.refuseAfter === null || mockServer.writes >= mockServer.refuseAfter);
    if (!refusing) return;
    const error = new Error('firestore') as Error & { code: string };
    error.code = mockServer.refuseWith as string;
    throw error;
  };
  return {
    __esModule: true,
    getFirestore: () => ({}),
    serverTimestamp: () => '<server-time>',
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    setDoc: jest.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
      turnAway();
      mockServer.writes++;
      mockDocs.set(ref.path, data);
    }),
    getDoc: jest.fn(async (ref: { path: string }) => {
      turnAway();
      const data = mockDocs.get(ref.path);
      return { exists: () => data !== undefined, data: () => data };
    }),
    getDocs: jest.fn(async (ref: { path: string }) => {
      turnAway();
      const prefix = `${ref.path}/`;
      return {
        docs: [...mockDocs.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((k) => ({ id: k.slice(prefix.length), data: () => mockDocs.get(k) })),
      };
    }),
  };
});

const keychain = (require('expo-secure-store') as { __keychain: Map<string, string> }).__keychain;

beforeEach(async () => {
  mockDocs.clear();
  mockLocal.clear();
  keychain.clear();
  mockServer.signedIn = false;
  mockServer.refuseWith = null;
  mockServer.refuseAfter = null;
  mockServer.writes = 0;
  // each test is a fresh launch; only the process ends here, the disk was cleared above
  endLaunch();
});

const CODE = generateCode();

const month = {
  ...emptyMonthData(),
  habits: [{ id: '0', name: 'Run' }],
  grid: { '1:0': 1 as const },
};

const tasks: Task[] = [
  { id: '0', text: 'Send the invoice', due: 1_800_000_000_000, done: false },
];

/** The document names a backup under this code would be filed under */
const paths = () => [...mockDocs.keys()].map((p) => p.replace(/[0-9a-f]{64}/, '<id>')).sort();

/** Everything the phone holds, backed up once and settled */
async function alreadyBackedUp() {
  await saveCode(CODE);
  await saveMonth(2026, 8, month);
  await saveTasks(tasks);
  await backupNow(CODE);
}

/** Would the phone start a run of its own right now, coming back to the app? */
async function wouldRunOnOpening(): Promise<boolean> {
  return shouldRun('opened', {
    ledger: await loadLedger(),
    seen: '',
    ...(await launchMoment()),
    // the day after, so the throttles are not what is under test
    since: 24 * 60 * 60_000,
  });
}

describe('the morning the server turned this install away', () => {
  it('parks every document it was refused, which is what nobody may leave standing', async () => {
    // the raw sync run, which is why every caller has to settle it afterwards
    await alreadyBackedUp();
    await saveMonth(2026, 8, { ...month, observations: ['typed', '', '', ''] });
    await markDirty('2026-09');

    mockServer.refuseWith = 'firestore/permission-denied';
    await expect(backupEverything(CODE)).resolves.toMatchObject({
      ok: true,
      pushed: 0,
      blocked: [{ key: '2026-09', reason: 'rejected' }],
    });

    const ledger = await loadLedger();
    expect(ledger.blocked).toEqual(['2026-09']);
    expect(pendingKeys(ledger)).toEqual([]);
  });

  it('takes the park off again the moment the run is accounted for', async () => {
    await alreadyBackedUp();
    await saveMonth(2026, 8, { ...month, observations: ['typed', '', '', ''] });
    await markDirty('2026-09');

    mockServer.refuseWith = 'firestore/permission-denied';
    await backupNow(CODE);

    const ledger = await loadLedger();
    expect(ledger.blocked).toEqual([]);
    expect(pendingKeys(ledger)).toEqual(['2026-09']);
  });

  it('sends it on the next run, with nobody having touched anything', async () => {
    await alreadyBackedUp();
    const typed = { ...month, observations: ['typed', '', '', ''] };
    await saveMonth(2026, 8, typed);
    await markDirty('2026-09');

    mockServer.refuseWith = 'firestore/permission-denied';
    await backupNow(CODE);

    mockServer.refuseWith = null;
    expect(await wouldRunOnOpening()).toBe(true);
    await runAndSettle();

    expect(pendingKeys(await loadLedger())).toEqual([]);
    expect(paths()).toContain('backups/<id>/months/2026-09');
  });
});

describe('the first backup this phone ever made, refused', () => {
  it('does not let a run it was refused everything of count as having checked the phone', async () => {
    await saveCode(CODE);
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);

    mockServer.refuseWith = 'firestore/permission-denied';
    await expect(backupNow(CODE)).resolves.toMatchObject({ ok: true, pushed: 0 });

    const ledger = await loadLedger();
    expect(ledger.digests).toEqual({});
    expect(pendingKeys(ledger)).toEqual([]);
    expect((await launchMoment()).accounted).toBe(false);
  });

  it('tries again on its own, and the whole phone goes up', async () => {
    await saveCode(CODE);
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);

    mockServer.refuseWith = 'firestore/permission-denied';
    await backupNow(CODE);

    mockServer.refuseWith = null;
    expect(await wouldRunOnOpening()).toBe(true);
    await runAndSettle();

    expect(paths()).toEqual([
      'backups/<id>/months/2026-09',
      'backups/<id>/tasks/current',
    ]);
  });

  it('comes back for the half of a run that was refused, dirty flag or no dirty flag', async () => {
    await saveCode(CODE);
    await saveMonth(2026, 7, month);
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);

    mockServer.refuseWith = 'firestore/permission-denied';
    mockServer.refuseAfter = 1;
    await expect(backupNow(CODE)).resolves.toMatchObject({
      ok: true,
      pushed: 1,
      blocked: [{ key: '2026-08', reason: 'rejected' }, { key: 'current', reason: 'rejected' }],
    });

    const ledger = await loadLedger();
    expect(ledger.blocked).toEqual([]);
    expect(pendingKeys(ledger)).toEqual([]);
    expect(ledger.lastPushAt).not.toBeNull();

    mockServer.refuseWith = null;
    expect(await wouldRunOnOpening()).toBe(true);
    await runAndSettle();

    expect(paths()).toEqual([
      'backups/<id>/months/2026-08',
      'backups/<id>/months/2026-09',
      'backups/<id>/tasks/current',
    ]);
  });

  it('still lets somebody ask for it by hand, and says the same thing afterwards', async () => {
    await saveCode(CODE);
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);

    mockServer.refuseWith = 'firestore/permission-denied';
    await backupNow(CODE);
    mockServer.refuseWith = null;

    await retryEverything();
    expect(paths()).toContain('backups/<id>/months/2026-09');
    expect(pendingKeys(await loadLedger())).toEqual([]);
  });
});

describe('the retry that got nowhere', () => {
  /** What Settings would put in front of somebody right now */
  async function card() {
    return statusOf(await loadLedger(), await launchMemory());
  }

  async function turnedAwayHalfWay() {
    await saveCode(CODE);
    await saveMonth(2026, 7, month);
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);

    mockServer.refuseWith = 'firestore/permission-denied';
    mockServer.refuseAfter = 1;
    await backupNow(CODE);
    mockServer.refuseAfter = null;
  }

  it('still knows what the server turned away when the run comes back offline', async () => {
    await turnedAwayHalfWay();
    expect((await launchMoment()).turnedAway).toBe(2);

    mockServer.refuseWith = 'firestore/unavailable';
    await retryEverything();

    expect((await launchMoment()).turnedAway).toBe(2);
    expect((await card()).blocked.map((doc) => doc.key)).toEqual(['2026-08', 'current']);
    expect(await wouldRunOnOpening()).toBe(true);

    mockServer.refuseWith = null;
    await runAndSettle();
    expect(paths()).toEqual([
      'backups/<id>/months/2026-08',
      'backups/<id>/months/2026-09',
      'backups/<id>/tasks/current',
    ]);
  });

  it('still knows what the server turned away when the run never starts', async () => {
    await turnedAwayHalfWay();
    // the Keychain gives nothing, so no request is made at all
    keychain.clear();

    await retryEverything();

    expect((await launchMoment()).turnedAway).toBe(2);
    expect((await card()).blocked.map((doc) => doc.key)).toEqual(['2026-08', 'current']);
    expect(await wouldRunOnOpening()).toBe(true);
  });

  it('leaves the ledger holding the month the server would not take', async () => {
    await saveCode(CODE);
    await saveMonth(2026, 7, month);
    await saveMonth(2026, 8, { ...month, observations: ['x'.repeat(60_000), '', '', ''] });
    await saveTasks(tasks);
    await backupNow(CODE);
    expect((await loadLedger()).blocked).toEqual(['2026-09']);

    keychain.clear();
    await retryEverything();

    expect((await loadLedger()).blocked).toEqual(['2026-09']);
    expect((await card()).blocked).toEqual([
      { key: '2026-09', reason: 'too-large', detail: 'observations' },
    ]);
  });

  it('does let go of a park a finished run no longer stands behind', async () => {
    // a month already on the server is stepped over in silence, so only a retry unparks it
    await alreadyBackedUp();
    await recordBlocked('2026-09');
    expect((await loadLedger()).blocked).toEqual(['2026-09']);

    await retryEverything();

    expect((await loadLedger()).blocked).toEqual([]);
    expect((await card()).blocked).toEqual([]);
  });
});

describe('what a finished run may leave counted as waiting', () => {
  it('retires a year whose only deadline was ticked off and un-ticked again', async () => {
    await alreadyBackedUp();
    const sent = mockServer.writes;

    await markDirty('current');
    await markDirty('2026');
    expect(pendingKeys(await loadLedger())).toEqual(['2026', 'current']);

    await runAndSettle();

    expect(pendingKeys(await loadLedger())).toEqual([]);
    expect(paths()).not.toContain('backups/<id>/tasks/2026');
    expect(mockServer.writes).toBe(sent);
  });

  it('leaves a year the backup does hold to be emptied rather than forgotten', async () => {
    await saveCode(CODE);
    await saveMonth(2026, 8, month);
    await saveTasks([
      ...tasks,
      { id: '1', text: 'File the accounts', due: 1, done: true, completedAt: new Date(2024, 2, 3).getTime() },
    ]);
    await backupNow(CODE);
    expect(paths()).toContain('backups/<id>/tasks/2024');

    // the finished deadline is deleted, which marks both documents it touched
    await saveTasks(tasks);
    await markDirty('current');
    await markDirty('2024');
    await runAndSettle();

    expect(pendingKeys(await loadLedger())).toEqual([]);
    expect(paths()).toContain('backups/<id>/tasks/2024');
  });
});

describe('the morning after the phone was closed', () => {
  async function refusedHalfWayAndClosed() {
    await saveCode(CODE);
    await saveMonth(2026, 7, month);
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);

    mockServer.refuseWith = 'firestore/permission-denied';
    mockServer.refuseAfter = 1;
    await backupNow(CODE);
    mockServer.refuseAfter = null;
    mockServer.refuseWith = null;

    // and the app is closed. Whatever is on the disk is all there is.
    endLaunch();
  }

  /** What Settings would put in front of somebody right now */
  async function card() {
    return statusOf(await loadLedger(), await launchMemory());
  }

  /** The real question the phone asks itself on opening, throttles and all */
  async function opening(): Promise<boolean> {
    return shouldRun('opened', {
      ledger: await loadLedger(),
      seen: '',
      ...(await launchMoment()),
    });
  }

  it('knows it is behind, and does not tell anybody otherwise', async () => {
    await refusedHalfWayAndClosed();

    const ledger = await loadLedger();
    expect(pendingKeys(ledger)).toEqual([]);
    expect(ledger.blocked).toEqual([]);
    expect(ledger.lastPushAt).not.toBeNull();

    expect((await launchMoment()).turnedAway).toBe(2);
    expect((await card()).reconciled).toBe(false);
  });

  it('starts a run of its own, with nobody having touched anything', async () => {
    await refusedHalfWayAndClosed();

    expect(await opening()).toBe(true);
    await runAndSettle();

    expect(paths()).toEqual([
      'backups/<id>/months/2026-08',
      'backups/<id>/months/2026-09',
      'backups/<id>/tasks/current',
    ]);
  });

  it('goes quiet again once a run has been refused nothing', async () => {
    await refusedHalfWayAndClosed();
    await runAndSettle();
    endLaunch();

    expect((await launchMoment()).turnedAway).toBe(0);
    expect((await card()).reconciled).toBe(true);
    expect(await opening()).toBe(false);
  });

  it('does not describe the next backup with what the last one refused', async () => {
    await refusedHalfWayAndClosed();
    await forgetLaunch();

    // closed again, so the answer comes off the disk
    endLaunch();
    expect((await launchMoment()).turnedAway).toBe(0);
  });
});

describe('one run at a time', () => {
  const TURNED_AWAY_KEY = '@monthly-planning/backup-turned-away';

  /** How many runs wrote down what they were turned away from, which every settled run does */
  const settles = () =>
    (AsyncStorage.setItem as jest.Mock).mock.calls.filter(([key]) => key === TURNED_AWAY_KEY).length;

  it('shares the run in the air with every caller under the same code, and settles it once', async () => {
    await alreadyBackedUp();
    await saveMonth(2026, 8, { ...month, observations: ['typed', '', '', ''] });
    await markDirty('2026-09');

    const sent = mockServer.writes;
    (AsyncStorage.setItem as jest.Mock).mockClear();
    // the screen's code is bare, the saved one grouped; both are the same backup
    const [mine, timer, retry] = await Promise.all([
      backupNow(normalizeCode(CODE) as string),
      runAndSettle(),
      retryEverything(),
    ]);

    expect(mockServer.writes).toBe(sent + 1);
    expect(mine).toMatchObject({ ok: true, pushed: 1 });
    // the screen started it, so the others leave the bookkeeping to it
    expect(timer).toBeNull();
    expect(retry).toBeNull();
    expect(settles()).toBe(1);
  });

  it('has a different code wait for the run in the air, then run on its own', async () => {
    await saveCode(CODE);
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);
    const other = generateCode();

    (setDoc as jest.Mock).mockClear();
    const [mine, timer] = await Promise.all([backupNow(other), runAndSettle()]);

    expect(mine).toMatchObject({ ok: true, pushed: 2 });
    expect(timer).not.toBeNull();
    const ids = (setDoc as jest.Mock).mock.calls.map(([ref]) => ref.path.split('/')[1]);
    const [theirs, ours] = [deriveBackupId(other), deriveBackupId(CODE)];
    expect(ids).toEqual([theirs, theirs, ours, ours]);
  });

  it('answers a run that threw as a lost connection, and still settles it', async () => {
    await alreadyBackedUp();
    const spy = jest.spyOn(sync, 'backupEverything').mockRejectedValueOnce(new Error('disk'));

    await expect(backupNow(CODE)).resolves.toEqual({ ok: false, reason: 'offline' });
    expect((await launchMoment()).stalled).toBe(true);
    spy.mockRestore();
  });
});

describe('the turned-away count on the disk', () => {
  const TURNED_AWAY_KEY = '@monthly-planning/backup-turned-away';

  it('still reads the record older builds wrote, so the phone keeps its count', async () => {
    mockLocal.set(TURNED_AWAY_KEY, JSON.stringify({ count: 2, at: 1_700_000_000_000 }));
    expect((await launchMoment()).turnedAway).toBe(2);
  });

  it('keeps the count of a record dated from the future', async () => {
    mockLocal.set(TURNED_AWAY_KEY, JSON.stringify({ count: 3, at: Date.now() + 86_400_000 }));
    expect((await launchMoment()).turnedAway).toBe(3);
  });

  it('writes a bare count from now on', async () => {
    await saveCode(CODE);
    await saveMonth(2026, 7, month);
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);

    mockServer.refuseWith = 'firestore/permission-denied';
    mockServer.refuseAfter = 1;
    await backupNow(CODE);

    expect(mockLocal.get(TURNED_AWAY_KEY)).toBe('2');
    endLaunch();
    expect((await launchMoment()).turnedAway).toBe(2);
  });

  it.each(['"2"', '-1', '1.5', '0', 'null', '[2]', '{"count":0}', '{"count":"2"}', 'not json'])(
    'reads %s as nothing turned away',
    async (raw) => {
      mockLocal.set(TURNED_AWAY_KEY, raw);
      expect((await launchMoment()).turnedAway).toBe(0);
    }
  );
});
