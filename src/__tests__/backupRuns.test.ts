import { generateCode } from '../backup';
import { saveCode } from '../backupState';
import { backupEverything } from '../sync';
import { saveMonth } from '../storage';
import { saveTasks } from '../tasks';
import { loadLedger, markDirty, pendingKeys, recordBlocked } from '../syncLedger';
import { shouldRun, statusOf } from '../hooks/autoBackupPolicy';
import {
  backupNow,
  forgetLaunch,
  launchMemory,
  launchMoment,
  retryEverything,
  runAndSettle,
} from '../hooks/backupRuns';
import { emptyMonthData } from '../types';
import type { Task } from '../tasks';

/**
 * A morning when the server would not talk to this install, and the morning
 * after it.
 *
 * The failure these are written from is the worst one this app has had, because
 * nothing about it is visible from inside the app: an App Check token expires
 * between two writes, every document offered comes back refused, each refusal is
 * remembered against the document it happened to — and a document the server
 * refused stops being counted as waiting. On a phone that has pushed before that
 * leaves nothing waiting, nothing to run for, and a card saying everything is
 * fine, for good. Only editing every month on the phone by hand would bring it
 * back, and nobody would ever know to.
 *
 * So the tests are written as the two mornings rather than as assertions about
 * functions: refused on Monday, and sending again on Tuesday with nobody having
 * touched anything.
 */

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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const keychain = (require('expo-secure-store') as { __keychain: Map<string, string> }).__keychain;

beforeEach(async () => {
  mockDocs.clear();
  mockLocal.clear();
  keychain.clear();
  mockServer.signedIn = false;
  mockServer.refuseWith = null;
  mockServer.refuseAfter = null;
  mockServer.writes = 0;
  // a launch is a process, and each of these is a fresh one
  forgetLaunch();
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
    ...launchMoment(),
    // the throttles are about how recently something was tried; every question
    // here is about the day after, so none of them is what is under test
    since: 24 * 60 * 60_000,
  });
}

describe('the morning the server turned this install away', () => {
  it('parks every document it was refused, which is what nobody may leave standing', async () => {
    // The raw run, straight from `sync`. From where that code stands a refusal
    // is a refusal and it is right to record one — and this is exactly why
    // nothing in the app is allowed to call it without settling it afterwards:
    // parked, a document stops being counted as waiting, and nothing but an
    // edit to it ever brings it back.
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
    // The same refusal through the door every caller goes through — the button
    // on the backup screen, and the phone's own triggers, are the same door.
    // The month is waiting again afterwards, because it is: the server said no
    // to this install, not to September.
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

    // the following morning: the token is fine again, and the only thing that
    // has happened in between is that the app was opened
    mockServer.refuseWith = null;
    expect(await wouldRunOnOpening()).toBe(true);
    await runAndSettle();

    expect(pendingKeys(await loadLedger())).toEqual([]);
    expect(paths()).toContain('backups/<id>/months/2026-09');
  });
});

describe('the first backup this phone ever made, refused', () => {
  /**
   * The hardest version of it, because there is nothing on record to recover
   * from. A first run re-keys the ledger before it starts, so nothing is dirty
   * and nothing has a digest: refused, the ledger afterwards knows literally
   * nothing, and the only thing standing between this phone and a backup it
   * never makes again is the refusal to call a turned-away run a run that
   * checked anything.
   */
  it('does not let a run it was refused everything of count as having checked the phone', async () => {
    await saveCode(CODE);
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);

    mockServer.refuseWith = 'firestore/permission-denied';
    await expect(backupNow(CODE)).resolves.toMatchObject({ ok: true, pushed: 0 });

    const ledger = await loadLedger();
    expect(ledger.digests).toEqual({});
    expect(pendingKeys(ledger)).toEqual([]);
    expect(launchMoment().accounted).toBe(false);
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
    // September goes up and then the token expires, so August is refused with
    // nothing on this phone recording that it did not go: it was never dirty —
    // a first run has no flags at all — and the park comes off it a moment
    // later. The ledger now looks like a phone that has backed up. Only this
    // launch remembers being refused, so only this launch can insist.
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
    // The retry in Settings is the other half of the story and it must not have
    // become the only half: it takes the park off everything, whatever put it
    // there, and runs without asking the throttles a thing.
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
  /**
   * The tap is the one moment in this app where somebody is actually watching,
   * and it used to be the moment the phone forgot everything it knew.
   *
   * Clearing what is stuck was done first, before the run — the ledger's parks
   * and this launch's memory of why each document was refused, both at once —
   * and nothing put either back when the run then failed to report. A refusal
   * the *server* made lives in that memory and nowhere else, because the park is
   * lifted on purpose so one expired token is not permanent, so a tap answered
   * by a dead connection left a phone with an empty blocked list, nothing
   * counted as waiting, no reason for any trigger to start, and a card saying
   * everything was in the backup. Pressing "try again" made the phone quieter
   * than not pressing it at all.
   *
   * Both routes a run has to get nowhere are below, because both went through
   * that same erasure: an answer that never comes back, and a run that never
   * starts because the Keychain would not give up the code.
   */

  /** What Settings would put in front of somebody right now */
  async function card() {
    const memory = launchMemory();
    return statusOf(await loadLedger(), memory.refusals, memory.accounted);
  }

  /**
   * Monday, half way through the run: September lands and then the token
   * expires, so August and the deadline list come back refused. Nothing on the
   * phone records that they did not go — a first run has no dirty flags, and the
   * park comes off a refusal about the install the moment the run is accounted
   * for — so this launch's memory of the refusal is the only thing standing
   * between this phone and a backup it never makes again.
   */
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
    expect(launchMoment().turnedAway).toBe(2);

    // The person opens Settings, reads that the phone is not reaching the
    // backup, and taps TRY IT AGAIN NOW — in a lift.
    mockServer.refuseWith = 'firestore/unavailable';
    await retryEverything();

    expect(launchMoment().turnedAway).toBe(2);
    expect((await card()).blocked.map((doc) => doc.key)).toEqual(['2026-08', 'current']);
    expect(await wouldRunOnOpening()).toBe(true);

    // and out of the lift, with nobody having touched anything, the two
    // documents that never went finally go
    mockServer.refuseWith = null;
    await runAndSettle();
    expect(paths()).toEqual([
      'backups/<id>/months/2026-08',
      'backups/<id>/months/2026-09',
      'backups/<id>/tasks/current',
    ]);
  });

  it('still knows what the server turned away when the run never starts', async () => {
    // The other route to the same nothing: the Keychain does not answer, so no
    // code is read and no request is made. A run that never happened has said
    // even less about what is stuck than one that came back empty-handed.
    await turnedAwayHalfWay();
    keychain.clear();

    await retryEverything();

    expect(launchMoment().turnedAway).toBe(2);
    expect((await card()).blocked.map((doc) => doc.key)).toEqual(['2026-08', 'current']);
    expect(await wouldRunOnOpening()).toBe(true);
  });

  it('leaves the ledger holding the month the server would not take', async () => {
    // The other class of refusal, and the one the ledger itself remembers. A
    // September over the size cap is parked against the document with no dirty
    // flag of its own, so the blocked list is the only record there is that the
    // month is not up there; erasing it left a card reading "everything on this
    // phone is in the backup" about a month the run had just refused to send.
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
    // The half of the old behaviour worth keeping, and the reason a retry
    // clears anything at all. A month already on the server character for
    // character is stepped over in silence by every run — no push, no skip, so
    // nothing on the ordinary path will ever take a park off it — and a retry is
    // where a park like that is meant to end. It ends after the run rather than
    // before it, once the run has come back without naming it.
    await alreadyBackedUp();
    await recordBlocked('2026-09');
    expect((await loadLedger()).blocked).toEqual(['2026-09']);

    await retryEverything();

    expect((await loadLedger()).blocked).toEqual([]);
    expect((await card()).blocked).toEqual([]);
  });
});

describe('what a finished run may leave counted as waiting', () => {
  /**
   * Reached by two taps and a wait. Ticking a deadline off files it under the
   * year it was finished in and reports that year as changed; un-ticking it, or
   * deleting it, before the next run leaves that year holding nothing. Nothing
   * was ever sent under it, so there is no digest to make it an orphan, and no
   * loop in the run has any reason to look at it — so the flag stood there for
   * the life of the phone, the card said the deadlines were waiting, and a run
   * started every half hour to send a document that does not exist.
   */
  it('retires a year whose only deadline was ticked off and un-ticked again', async () => {
    await alreadyBackedUp();
    const sent = mockServer.writes;

    await markDirty('current');
    await markDirty('2026');
    expect(pendingKeys(await loadLedger())).toEqual(['2026', 'current']);

    await runAndSettle();

    expect(pendingKeys(await loadLedger())).toEqual([]);
    expect(paths()).not.toContain('backups/<id>/tasks/2026');
    // and nothing went on the wire to achieve it: the open list is unchanged
    // and the year never existed
    expect(mockServer.writes).toBe(sent);
  });

  it('leaves a year the backup does hold to be emptied rather than forgotten', async () => {
    // The other side of the same line. A year with a digest against it is a
    // document the backup is still holding deadlines in, so a flag on it means
    // the last of them was deleted and the document has to be emptied — which
    // is a write, not a retirement.
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
