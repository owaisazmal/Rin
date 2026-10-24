import AsyncStorage from '@react-native-async-storage/async-storage';
import { deriveBackupId, deriveKey, generateCode, open } from '../backup';
import {
  backupEverything,
  deleteBackup,
  listMonths,
  pullMonth,
  restoreEverything,
  restoreMonth,
} from '../sync';
import { loadMonth, readMonthForEditing, readMonthVouched, saveMonth } from '../storage';
import { loadTasks, saveTasks } from '../tasks';
import { loadLedger, markDirty, pendingCount, pendingKeys } from '../syncLedger';
import { emptyMonthData } from '../types';
import type { Task } from '../tasks';
import type { Sealed } from '../backup';

const mockLocal = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockLocal.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockLocal.set(k, v);
    }),
    getAllKeys: jest.fn(async () => [...mockLocal.keys()]),
    multiGet: jest.fn(async (keys: string[]) =>
      keys.map((k) => [k, mockLocal.get(k) ?? null])
    ),
  },
}));

// the real store, with the month readers wrapped so a test can see whether a month was read
jest.mock('../storage', () => {
  const actual = jest.requireActual('../storage') as typeof import('../storage');
  return {
    ...actual,
    loadMonth: jest.fn(actual.loadMonth),
    readMonthVouched: jest.fn(actual.readMonthVouched),
  };
});
const readMonth = loadMonth as jest.MockedFunction<typeof loadMonth>;
const vouchMonth = readMonthVouched as jest.MockedFunction<typeof readMonthVouched>;

jest.mock('expo-crypto', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

const mockDocs = new Map<string, Record<string, unknown>>();
const mockState = {
  signedIn: false,
  failWith: null as string | null,
  signInCalls: 0,
  appCheckStarts: 0,
  // every document write that reached the server, so a skip is measurable
  writes: 0,
  // fails the task collection alone, leaving the months readable
  failTasksWith: null as string | null,
};

jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  getAuth: () => ({ get currentUser() { return mockState.signedIn ? { uid: 'anon' } : null; } }),
  signInAnonymously: jest.fn(async () => {
    mockState.signInCalls++;
    mockState.signedIn = true;
  }),
}));

// React Native defines this; plain Node does not
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

jest.mock('@react-native-firebase/app-check', () => ({
  __esModule: true,
  ReactNativeFirebaseAppCheckProvider: class { configure() {} },
  initializeAppCheck: jest.fn(() => {
    mockState.appCheckStarts++;
  }),
  getToken: jest.fn(),
}));

jest.mock('@react-native-firebase/firestore', () => {
  const fail = () => {
    if (mockState.failWith !== null) {
      const error = new Error('firestore') as Error & { code: string };
      error.code = mockState.failWith;
      throw error;
    }
  };
  return {
    __esModule: true,
    getFirestore: () => ({}),
    serverTimestamp: () => '<server-time>',
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    setDoc: jest.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
      fail();
      mockState.writes++;
      mockDocs.set(ref.path, data);
    }),
    getDoc: jest.fn(async (ref: { path: string }) => {
      fail();
      const data = mockDocs.get(ref.path);
      return { exists: () => data !== undefined, data: () => data };
    }),
    deleteDoc: jest.fn(async (ref: { path: string }) => {
      fail();
      mockDocs.delete(ref.path);
    }),
    getDocs: jest.fn(async (ref: { path: string }) => {
      fail();
      if (mockState.failTasksWith !== null && ref.path.endsWith('/tasks')) {
        const error = new Error('firestore') as Error & { code: string };
        error.code = mockState.failTasksWith;
        throw error;
      }
      const prefix = `${ref.path}/`;
      return {
        docs: [...mockDocs.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((k) => ({ id: k.slice(prefix.length), data: () => mockDocs.get(k) })),
      };
    }),
  };
});

beforeEach(() => {
  mockDocs.clear();
  mockLocal.clear();
  mockState.signedIn = false;
  mockState.failWith = null;
  mockState.signInCalls = 0;
  mockState.appCheckStarts = 0;
  mockState.writes = 0;
  mockState.failTasksWith = null;
  readMonth.mockClear();
  vouchMonth.mockClear();
});

const TASKS_BLOB = '@monthly-planning/tasks';
const monthBlob = (key: string) => `@monthly-planning/${key}`;

const CODE = generateCode();

const month = {
  ...emptyMonthData(),
  habits: [{ id: '0', name: 'Run' }],
  grid: { '1:0': 1 as const },
};

// two habits with a mark each, so there is something for a month to lose
const twoHabits = {
  ...emptyMonthData(),
  habits: [
    { id: '0', name: 'Run' },
    { id: '1', name: 'Read' },
  ],
  grid: { '1:0': 1 as const, '2:1': 2 as const },
};

// the same month with one habit rotted on disk: it parses to an ordinary-looking smaller month
const halfReadable = JSON.stringify({
  ...twoHabits,
  habits: [twoHabits.habits[0], { id: '1', name: 42 }],
});

const tasks: Task[] = [
  { id: '0', text: 'Send the invoice', due: 1_800_000_000_000, done: false },
];

// a second open deadline, so the open list has a row it can lose
const alsoOpen: Task = {
  id: '3',
  text: 'Renew the passport',
  due: 1_900_000_000_000,
  done: false,
};

// local time, so the year a task is filed under is the year the device reads
function at(year: number, month: number, day: number): number {
  return new Date(year, month, day, 12).getTime();
}

const finishedIn2024: Task = {
  id: '1',
  text: 'File the accounts',
  due: at(2024, 2, 1),
  done: true,
  completedAt: at(2024, 2, 3),
};

const finishedIn2025: Task = {
  id: '2',
  text: 'Renew the insurance',
  due: at(2025, 5, 10),
  done: true,
  completedAt: at(2025, 5, 11),
};

// every document path, with the derived id blanked
function paths(): string[] {
  return [...mockDocs.keys()].map((p) => p.replace(/[0-9a-f]{64}/, '<id>')).sort();
}

function readBack(suffix: string): unknown {
  const record = mockDocs.get(`backups/${deriveBackupId(CODE)}/${suffix}`);
  const plaintext = open(deriveKey(CODE), record as unknown as Sealed);
  return plaintext === null ? null : JSON.parse(plaintext);
}

describe('what goes on the wire', () => {
  it('stores ciphertext, not the month', async () => {
    await saveMonth(2026, 8, month);
    await expect(backupEverything(CODE)).resolves.toMatchObject({ ok: true, pushed: 1 });
    const [[path, record]] = [...mockDocs.entries()];
    // filed under a derived id, never the code
    expect(path).toMatch(/^backups\/[0-9a-f]{64}\/months\/2026-09$/);
    expect(path).not.toContain(CODE.replace(/-/g, ''));
    // and nothing in the record reads as the habit
    const written = JSON.stringify(record);
    expect(written).not.toContain('Run');
    expect(record).toMatchObject({ v: 1, updatedAt: '<server-time>' });
  });

  it('lets the server stamp the time rather than the phone', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    const [record] = [...mockDocs.values()];
    expect(record.updatedAt).toBe('<server-time>');
  });

  it('signs in once, not once per call', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    await listMonths(CODE);
    await pullMonth(CODE, 2026, 8);
    expect(mockState.signInCalls).toBe(1);
  });

  it('starts App Check with the first request rather than at launch, and once', async () => {
    let fresh!: typeof import('../sync');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      fresh = require('../sync');
    });
    expect(mockState.appCheckStarts).toBe(0);
    await fresh.listMonths(CODE);
    await fresh.pullMonth(CODE, 2026, 8);
    expect(mockState.appCheckStarts).toBe(1);
  });
});

describe('round trips', () => {
  it('brings a month back exactly', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    await expect(pullMonth(CODE, 2026, 8)).resolves.toEqual({ ok: true, value: month });
  });

  it('brings the task list back exactly', async () => {
    await saveTasks(tasks);
    await backupEverything(CODE);
    expect(readBack('tasks/current')).toEqual(tasks);
  });

  it('brings a repeat rule back exactly', async () => {
    const recurring: Task[] = [
      { ...tasks[0], repeat: { every: 'month', day: 31 } },
      { ...alsoOpen, repeat: { every: 'week' } },
    ];
    await saveTasks(recurring);
    await backupEverything(CODE);
    expect(readBack('tasks/current')).toEqual(recurring);
  });

  it('lists the months a backup holds, newest first, without decrypting them', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    await expect(listMonths(CODE)).resolves.toEqual({
      ok: true,
      value: ['2026-09', '2026-01'],
    });
  });
});

describe('when it cannot work', () => {
  it('reports a month that was never backed up', async () => {
    await expect(pullMonth(CODE, 2026, 8)).resolves.toEqual({ ok: false, reason: 'missing' });
  });

  it('reports the wrong code as unreadable rather than returning nonsense', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    const other = generateCode();
    // the other code derives a different id, so it finds nothing at all
    await expect(pullMonth(other, 2026, 8)).resolves.toEqual({ ok: false, reason: 'missing' });

    // and even pointed at the right document, it cannot open it
    const [path] = [...mockDocs.keys()];
    const record = mockDocs.get(path)!;
    expect(open(deriveKey(other), record as never)).toBeNull();
  });

  it.each([
    // the request never arrived
    ['firestore/unavailable', 'offline'],
    ['firestore/deadline-exceeded', 'offline'],
    ['auth/network-request-failed', 'offline'],
    // the server answered, and the answer was no
    ['firestore/permission-denied', 'rejected'],
    ['firestore/unauthenticated', 'rejected'],
    // sign-in runs first, so this is what a disabled anonymous provider looks like
    ['auth/admin-restricted-operation', 'rejected'],
    ['auth/operation-not-allowed', 'rejected'],
    // anything else carrying a Firebase code reached Firebase
    ['auth/internal-error', 'rejected'],
    ['', 'rejected'],
  ])('reports %s as %s', async (code, reason) => {
    mockState.failWith = code;
    await expect(listMonths(CODE)).resolves.toEqual({ ok: false, reason });
  });

  it('never throws at the caller', async () => {
    await saveMonth(2026, 8, month);
    mockState.failWith = 'firestore/unavailable';
    await expect(backupEverything(CODE)).resolves.toMatchObject({ ok: false });
    await expect(pullMonth(CODE, 2026, 8)).resolves.toMatchObject({ ok: false });
    await expect(listMonths(CODE)).resolves.toMatchObject({ ok: false });
    await expect(restoreEverything(CODE)).resolves.toMatchObject({ ok: false });
    await expect(restoreMonth(CODE, 2026, 8)).resolves.toMatchObject({ ok: false });
    await expect(deleteBackup(CODE)).resolves.toMatchObject({ ok: false });
  });

  it('refuses a month that decrypts but says something it cannot read', async () => {
    const { seal } = jest.requireActual('../backup') as typeof import('../backup');
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    const [path] = [...mockDocs.keys()];
    mockDocs.set(path, {
      ...seal(deriveKey(CODE), JSON.stringify({ habits: 'not an array', grid: 42 })),
      updatedAt: '<server-time>',
    });
    await expect(pullMonth(CODE, 2026, 8)).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });

  it('refuses a month too big for the rules without sending it', async () => {
    await saveMonth(2026, 8, { ...month, observations: ['x'.repeat(60_000), '', '', ''] });
    await expect(backupEverything(CODE)).resolves.toMatchObject({
      blocked: [{ key: '2026-09', reason: 'too-large', detail: 'observations' }],
    });
    expect(mockState.writes).toBe(0);
  });
});

describe('a store that will not answer', () => {
  it('does not retire a month it merely failed to look for', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE); // settled, nothing waiting
    await saveMonth(2026, 8, { ...month, observations: ['changed', '', '', ''] });
    await markDirty('2026-09');

    const keys = AsyncStorage.getAllKeys as jest.Mock;
    keys.mockRejectedValueOnce(new Error('disk'));
    await backupEverything(CODE);

    // the month is still waiting, because the run never actually looked
    expect(pendingKeys(await loadLedger())).toEqual(['2026-09']);
  });

  it('still retires one it looked for and genuinely did not find', async () => {
    await markDirty('2026-06'); // flagged, never stored
    await backupEverything(CODE);

    expect(pendingKeys(await loadLedger())).toEqual([]);
  });
});

describe('backing up the whole phone', () => {
  it('sends every stored month and the task list', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);

    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 2,
      pushed: 3,
      unchanged: 0,
      skipped: 0,
      blocked: [],
    });
    expect(paths()).toEqual([
      'backups/<id>/months/2026-01',
      'backups/<id>/months/2026-09',
      'backups/<id>/tasks/current',
    ]);
  });

  it('sends nothing readable, even across many months', async () => {
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);
    await backupEverything(CODE);
    const written = JSON.stringify([...mockDocs.values()]);
    expect(written).not.toContain('Run');
    expect(written).not.toContain('Send the invoice');
  });

  it('succeeds with nothing to send on a phone that has never been used', async () => {
    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 0,
      pushed: 0,
      unchanged: 0,
      skipped: 0,
      blocked: [],
    });
  });

  it('leaves a month it has already sent alone, without even reading it', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);

    readMonth.mockClear();
    vouchMonth.mockClear();
    const sent = mockState.writes;
    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 1,
      pushed: 0,
      unchanged: 1,
      skipped: 0,
      blocked: [],
    });
    expect(vouchMonth).not.toHaveBeenCalled();
    expect(readMonth).not.toHaveBeenCalled();
    expect(mockState.writes).toBe(sent);
  });

  it('sends a month again as soon as something in it changes', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);

    const edited = { ...month, observations: ['Ran twice this week', '', '', ''] };
    await saveMonth(2026, 8, edited);
    await markDirty('2026-09');

    const sent = mockState.writes;
    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 1,
      pushed: 1,
      unchanged: 0,
      skipped: 0,
      blocked: [],
    });
    expect(mockState.writes).toBe(sent + 1);
    await expect(pullMonth(CODE, 2026, 8)).resolves.toEqual({ ok: true, value: edited });

    // and the digest of what landed was recorded, so it settles again
    const settled = mockState.writes;
    await backupEverything(CODE);
    expect(mockState.writes).toBe(settled);
  });

  it('sends everything again under a new code rather than trusting the old ledger', async () => {
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);
    await backupEverything(CODE);

    const sent = mockState.writes;
    await expect(backupEverything(generateCode())).resolves.toEqual({
      ok: true,
      months: 1,
      pushed: 2,
      unchanged: 0,
      skipped: 0,
      blocked: [],
    });
    // the month and the open deadlines, into an empty tree
    expect(mockState.writes).toBe(sent + 2);
  });

  it('costs nothing for a month that was opened but never written in', async () => {
    // paging back through history writes an empty month to disk
    await saveMonth(2025, 3, emptyMonthData());
    await saveMonth(2026, 8, month);
    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 1,
      pushed: 1,
      unchanged: 0,
      skipped: 1,
      blocked: [],
    });
    expect(paths()).toEqual(['backups/<id>/months/2026-09']);
  });

  it('stops the run when the connection is dead rather than pushing months down it', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, month);
    mockState.failWith = 'firestore/unavailable';
    await expect(backupEverything(CODE)).resolves.toEqual({ ok: false, reason: 'offline' });
    expect(mockDocs.size).toBe(0);
  });

  it('records a refusal against the document instead of abandoning the run', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, month);
    mockState.failWith = 'firestore/permission-denied';
    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 0,
      pushed: 0,
      unchanged: 0,
      skipped: 0,
      blocked: [
        { key: '2026-09', reason: 'rejected' },
        { key: '2026-01', reason: 'rejected' },
      ],
    });
  });

  it('names an oversized month and keeps going with the months behind it', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, { ...month, observations: ['x'.repeat(60_000), '', '', ''] });

    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 1,
      pushed: 1,
      unchanged: 0,
      skipped: 0,
      blocked: [{ key: '2026-09', reason: 'too-large', detail: 'observations' }],
    });
    // September never went anywhere near the wire; January still landed
    expect(paths()).toEqual(['backups/<id>/months/2026-01']);
  });

  it('sends the months even when the deadline list is too big to go', async () => {
    await saveMonth(2026, 8, month);
    await saveTasks([{ ...tasks[0], text: 'y'.repeat(220_000) }]);

    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 1,
      pushed: 1,
      unchanged: 0,
      skipped: 0,
      blocked: [{ key: 'current', reason: 'too-large' }],
    });
    expect(paths()).toEqual(['backups/<id>/months/2026-09']);
  });
});

describe('the deadline archive', () => {
  it('keeps the open deadlines apart from the year they were finished in', async () => {
    await saveTasks([tasks[0], finishedIn2024]);
    await backupEverything(CODE);

    expect(paths()).toEqual(['backups/<id>/tasks/2024', 'backups/<id>/tasks/current']);
    expect(readBack('tasks/current')).toEqual([tasks[0]]);
    expect(readBack('tasks/2024')).toEqual([finishedIn2024]);
  });

  it('gives each year its own document', async () => {
    await saveTasks([finishedIn2024, finishedIn2025]);
    await backupEverything(CODE);

    expect(paths()).toEqual(['backups/<id>/tasks/2024', 'backups/<id>/tasks/2025']);
    expect(readBack('tasks/2024')).toEqual([finishedIn2024]);
    expect(readBack('tasks/2025')).toEqual([finishedIn2025]);
  });

  it('leaves a finished year alone once it is up', async () => {
    await saveTasks([finishedIn2024]);
    await backupEverything(CODE);

    // a new deadline this year is no reason to re-send 2024
    await saveTasks([finishedIn2024, tasks[0]]);
    const sent = mockState.writes;
    await backupEverything(CODE);
    expect(mockState.writes).toBe(sent + 1);
    expect(readBack('tasks/current')).toEqual([tasks[0]]);
  });

  it('reassembles the shards into one list on the way back', async () => {
    await saveMonth(2026, 8, month);
    await saveTasks([tasks[0], finishedIn2024, finishedIn2025]);
    await backupEverything(CODE);

    mockLocal.clear();
    await restoreEverything(CODE);
    await expect(loadTasks()).resolves.toEqual([tasks[0], finishedIn2024, finishedIn2025]);
  });
});

describe('restoring onto another phone', () => {
  it('brings the months and the tasks down', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);
    await backupEverything(CODE);

    // a different phone: same backup, empty local storage
    mockLocal.clear();
    await expect(restoreEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 2,
      skipped: 0,
      deadlines: 'restored',
    });
    await expect(loadMonth(2026, 8)).resolves.toEqual(month);
    await expect(loadMonth(2026, 0)).resolves.toEqual(month);
    await expect(loadTasks()).resolves.toEqual(tasks);
  });

  it('restores a recurring series with its rule and its finished occurrences', async () => {
    const series: Task[] = [
      { ...tasks[0], repeat: { every: 'year', day: 29 } },
      { ...finishedIn2024, text: tasks[0].text },
      { ...finishedIn2025, text: tasks[0].text },
    ];
    await saveMonth(2026, 8, month);
    await saveTasks(series);
    await backupEverything(CODE);

    mockLocal.clear();
    await expect(restoreEverything(CODE)).resolves.toMatchObject({ ok: true, deadlines: 'restored' });
    await expect(loadTasks()).resolves.toEqual(series);
    expect(JSON.parse(mockLocal.get(TASKS_BLOB)!)[0].repeat).toEqual({ every: 'year', day: 29 });
  });

  it('reports a code with no backup behind it', async () => {
    await expect(restoreEverything(CODE)).resolves.toEqual({ ok: false, reason: 'missing' });
  });

  it('skips a month it cannot decrypt instead of writing it blank', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    // corrupt one of the two stored records
    const [first] = [...mockDocs.keys()].filter((k) => k.endsWith('2026-01'));
    mockDocs.set(first, { ...mockDocs.get(first)!, ct: 'QQQQ' });

    mockLocal.clear();
    const result = await restoreEverything(CODE);
    expect(result).toEqual({ ok: true, months: 1, skipped: 1, deadlines: 'none' });
    // the good one landed, the bad one left nothing behind
    await expect(loadMonth(2026, 8)).resolves.toEqual(month);
    expect(mockLocal.has('@monthly-planning/2026-01')).toBe(false);
  });

  it('sends nothing at all on the backup straight after a restore', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, month);
    await saveTasks([tasks[0], finishedIn2024, finishedIn2025]);
    await backupEverything(CODE);

    mockLocal.clear();
    await restoreEverything(CODE);

    const sent = mockState.writes;
    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 2,
      pushed: 0,
      unchanged: 5,
      skipped: 0,
      blocked: [],
    });
    expect(mockState.writes).toBe(sent);
  });

  it('re-sends a month the restore could not read, rather than assuming it landed', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    const [broken] = [...mockDocs.keys()].filter((k) => k.endsWith('2026-01'));
    mockDocs.set(broken, { ...mockDocs.get(broken)!, ct: 'QQQQ' });

    mockLocal.clear();
    await restoreEverything(CODE);
    // nothing for January on the phone yet; put something there and it goes
    await saveMonth(2026, 0, month);
    const sent = mockState.writes;
    await backupEverything(CODE);
    expect(mockState.writes).toBe(sent + 1);
  });
});

describe('never sending what this phone cannot vouch for', () => {
  it('never empties the deadline archive over a list it could not read', async () => {
    await saveTasks([tasks[0], finishedIn2024, finishedIn2025]);
    await backupEverything(CODE);

    // truncated on disk: `loadTasks` would answer with an empty list
    mockLocal.set(TASKS_BLOB, '[{"id":"0","tex');
    await markDirty('current');

    const sent = mockState.writes;
    const result = await backupEverything(CODE);
    expect(mockState.writes).toBe(sent);
    // all three documents still say what they said
    expect(readBack('tasks/current')).toEqual([tasks[0]]);
    expect(readBack('tasks/2024')).toEqual([finishedIn2024]);
    expect(readBack('tasks/2025')).toEqual([finishedIn2025]);
    expect(result).toMatchObject({
      ok: true,
      blocked: [
        { key: '2024', reason: 'unreadable' },
        { key: '2025', reason: 'unreadable' },
        { key: 'current', reason: 'unreadable' },
      ],
    });
  });

  it('names the deadline list on a first backup, before the ledger has heard of it', async () => {
    await saveMonth(2026, 8, month);
    // a phone with no ledger at all, and a deadline list that will not parse
    mockLocal.set(TASKS_BLOB, '[{"id":"0","tex');

    await expect(backupEverything(CODE)).resolves.toMatchObject({
      ok: true,
      pushed: 1,
      blocked: [{ key: 'current', reason: 'unreadable' }],
    });
    // the month went and the deadlines did not, and the ledger agrees
    expect(paths()).toEqual(['backups/<id>/months/2026-09']);
    expect((await loadLedger()).blocked).toEqual(['current']);
  });

  it('names the deadline list on a first backup that only half parses', async () => {
    mockLocal.set(TASKS_BLOB, JSON.stringify([tasks[0], { ...alsoOpen, due: 'friday' }]));

    await expect(backupEverything(CODE)).resolves.toMatchObject({
      ok: true,
      blocked: [{ key: 'current', reason: 'incomplete', detail: '1 of 2 deadlines' }],
    });
    expect(mockState.writes).toBe(0);
  });

  it('never empties the archive over a deadline list the store has lost', async () => {
    await saveTasks([tasks[0], finishedIn2024, finishedIn2025]);
    await backupEverything(CODE);

    // the blob goes rather than going bad, which reads exactly like a phone with no deadlines
    mockLocal.delete(TASKS_BLOB);
    await markDirty('2024');
    await markDirty('current');

    const sent = mockState.writes;
    const result = await backupEverything(CODE);
    expect(mockState.writes).toBe(sent);
    // all three documents still say what they said
    expect(readBack('tasks/current')).toEqual([tasks[0]]);
    expect(readBack('tasks/2024')).toEqual([finishedIn2024]);
    expect(readBack('tasks/2025')).toEqual([finishedIn2025]);
    expect(result).toMatchObject({
      ok: true,
      blocked: [
        { key: '2024', reason: 'unreadable' },
        { key: '2025', reason: 'unreadable' },
        { key: 'current', reason: 'unreadable' },
      ],
    });
  });

  it('still calls a missing list empty when no deadline was ever filed under one', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);

    // no task digest on record, so absence is a phone that never wrote a deadline
    await saveMonth(2026, 0, month);
    await expect(backupEverything(CODE)).resolves.toMatchObject({
      ok: true,
      pushed: 1,
      blocked: [],
    });
  });

  it('never sends a deadline list it only half understands', async () => {
    await saveTasks([tasks[0], alsoOpen]);
    await backupEverything(CODE);

    // one row goes bad; both are open, so nothing is orphaned and only the vouched read notices
    mockLocal.set(TASKS_BLOB, JSON.stringify([tasks[0], { ...alsoOpen, due: 'friday' }]));
    await markDirty('current');

    const sent = mockState.writes;
    await expect(backupEverything(CODE)).resolves.toMatchObject({
      ok: true,
      blocked: [{ key: 'current', reason: 'incomplete', detail: '1 of 2 deadlines' }],
    });
    expect(mockState.writes).toBe(sent);
    expect(readBack('tasks/current')).toEqual([tasks[0], alsoOpen]);
  });

  it('records every document it names as blocked, so the run and the ledger agree', async () => {
    await saveTasks([tasks[0], finishedIn2024]);
    await backupEverything(CODE);

    mockLocal.set(TASKS_BLOB, '[{"id":"0","tex');
    await markDirty('current');

    const run = await backupEverything(CODE);
    expect(run.ok && run.blocked.map((doc) => doc.key)).toEqual(['2024', 'current']);
    expect((await loadLedger()).blocked).toEqual(['2024', 'current']);
  });

  it('lets a year go quiet again once the deadline list can be read', async () => {
    await saveTasks([tasks[0], finishedIn2024]);
    await backupEverything(CODE);

    mockLocal.set(TASKS_BLOB, '[{"id":"0","tex');
    await markDirty('current');
    await backupEverything(CODE);
    expect((await loadLedger()).blocked).toEqual(['2024', 'current']);

    // the server already holds 2024's bytes, so no push will ever land to unpark it
    await saveTasks([tasks[0], finishedIn2024]);
    await markDirty('current');
    await backupEverything(CODE);
    expect((await loadLedger()).blocked).toEqual([]);
  });

  it('still lets a deleted year reach the backup as an empty document', async () => {
    await saveTasks([tasks[0], finishedIn2024]);
    await backupEverything(CODE);

    // the last deadline of 2024 is deleted, which is an edit and reports itself
    await saveTasks([tasks[0]]);
    await markDirty('2024');
    await markDirty('current');

    await backupEverything(CODE);
    expect(readBack('tasks/2024')).toEqual([]);
  });

  it('leaves a year alone when nothing said the deadlines in it changed', async () => {
    await saveTasks([tasks[0], finishedIn2024]);
    await backupEverything(CODE);

    // emptied by something that is not an edit
    await saveTasks([]);

    await backupEverything(CODE);
    expect(readBack('tasks/2024')).toEqual([finishedIn2024]);
  });

  it('never overwrites a backed-up month with an empty one it could not read', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);

    // `loadMonth` would answer this with an empty month
    mockLocal.set(monthBlob('2026-09'), '{"habits":[{"id":"0","na');
    await markDirty('2026-09');

    const sent = mockState.writes;
    await expect(backupEverything(CODE)).resolves.toMatchObject({
      ok: true,
      blocked: [{ key: '2026-09', reason: 'unreadable' }],
    });
    expect(mockState.writes).toBe(sent);
    expect(readBack('months/2026-09')).toEqual(month);
  });

  it('never sends a month this phone only half understands over the good copy', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);

    // not empty, so its digest disagrees exactly as a real edit's would
    mockLocal.set(monthBlob('2026-09'), halfReadable);
    await markDirty('2026-09');

    const sent = mockState.writes;
    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 1,
      pushed: 0,
      unchanged: 1,
      skipped: 0,
      blocked: [
        { key: '2026-09', reason: 'incomplete', detail: '1 of 2 habits, 1 grid entry' },
      ],
    });
    expect(mockState.writes).toBe(sent);
    // both habits, both marks: the backup still holds the month in full
    expect(readBack('months/2026-09')).toEqual(twoHabits);
  });

  // the one hole vouching can't close: once re-saved, the thinned month is a whole record
  it('has nothing left to catch once a damaged month has been re-saved', async () => {
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);

    mockLocal.set(monthBlob('2026-09'), halfReadable);
    await markDirty('2026-09');
    await expect(readMonthForEditing(2026, 8)).resolves.toMatchObject({ complete: false });

    // the save effect, writing back what it read
    await saveMonth(2026, 8, (await readMonthForEditing(2026, 8)).data);
    await expect(readMonthForEditing(2026, 8)).resolves.toMatchObject({ complete: true });

    await backupEverything(CODE);
    // the thinned month, over the whole one, reported as an ordinary success
    expect(readBack('months/2026-09')).toEqual(month);
  });

  it('carries on with the months behind one it cannot vouch for', async () => {
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);

    mockLocal.set(monthBlob('2026-09'), halfReadable);
    await markDirty('2026-09');
    // a January this phone holds and the backup has never seen
    await saveMonth(2026, 0, month);

    await expect(backupEverything(CODE)).resolves.toMatchObject({
      ok: true,
      pushed: 1,
      blocked: [
        { key: '2026-09', reason: 'incomplete', detail: '1 of 2 habits, 1 grid entry' },
      ],
    });
    expect(paths()).toEqual([
      'backups/<id>/months/2026-01',
      'backups/<id>/months/2026-09',
    ]);
    expect(readBack('months/2026-09')).toEqual(twoHabits);
  });

  it('settles a month whose record has gone from the disk, rather than calling it stuck', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);

    // still listed, nothing behind it any more
    mockLocal.set(monthBlob('2026-09'), undefined as unknown as string);
    await markDirty('2026-09');

    const sent = mockState.writes;
    await expect(backupEverything(CODE)).resolves.toMatchObject({
      ok: true,
      skipped: 1,
      blocked: [],
    });
    expect(mockState.writes).toBe(sent);
    expect(pendingCount(await loadLedger())).toBe(0);
    expect(readBack('months/2026-09')).toEqual(month);
  });

  it('keeps a month edited while its refusal was in flight waiting to go', async () => {
    await saveMonth(2026, 8, month);
    await markDirty('2026-09');

    // the edit lands between the read and the refusal
    const read = vouchMonth.getMockImplementation()!;
    vouchMonth.mockImplementationOnce(async (year, at) => {
      const answer = await read(year, at);
      await saveMonth(2026, 8, { ...month, observations: ['typed mid-run', '', '', ''] });
      await markDirty('2026-09');
      return answer;
    });

    mockState.failWith = 'firestore/permission-denied';
    await expect(backupEverything(CODE)).resolves.toMatchObject({
      ok: true,
      blocked: [{ key: '2026-09', reason: 'rejected' }],
    });
    // the refusal covers only the version that was offered
    expect(pendingKeys(await loadLedger())).toEqual(['2026-09']);
  });

  it('sends a month edited while the run was already under way', async () => {
    await saveMonth(2026, 8, month);
    await saveMonth(2026, 11, month);
    await backupEverything(CODE);

    // December is dirty and will be read; September is settled in the snapshot
    await saveMonth(2026, 11, { ...month, observations: ['December', '', '', ''] });
    await markDirty('2026-12');

    const edited = { ...month, observations: ['typed mid-run', '', '', ''] };
    const read = vouchMonth.getMockImplementation()!;
    vouchMonth.mockImplementationOnce(async (year, month) => {
      // lands after the snapshot and before September is looked at
      await saveMonth(2026, 8, edited);
      await markDirty('2026-09');
      return read(year, month);
    });

    const sent = mockState.writes;
    await backupEverything(CODE);
    expect(mockState.writes).toBe(sent + 2);
    await expect(pullMonth(CODE, 2026, 8)).resolves.toEqual({ ok: true, value: edited });
  });

  it('stops counting a month that was opened and never written in', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);

    // paging to a fresh month writes it to disk and reports the edit
    await saveMonth(2025, 3, emptyMonthData());
    await markDirty('2025-04');

    const sent = mockState.writes;
    await expect(backupEverything(CODE)).resolves.toMatchObject({ ok: true, skipped: 1 });
    expect(mockState.writes).toBe(sent);
    expect(pendingCount(await loadLedger())).toBe(0);
  });

  it('stops counting a month the store never managed to write', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);

    await markDirty('2026-06');

    const sent = mockState.writes;
    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 1,
      pushed: 0,
      unchanged: 1,
      skipped: 1,
      blocked: [],
    });
    expect(mockState.writes).toBe(sent);
    expect(pendingKeys(await loadLedger())).toEqual([]);

    // and it stays down, rather than being retired and found again every run
    await expect(backupEverything(CODE)).resolves.toMatchObject({ skipped: 0 });
    expect(pendingKeys(await loadLedger())).toEqual([]);
  });

  it('lets go of a year it parked that no longer holds a deadline', async () => {
    await saveTasks([tasks[0], finishedIn2024]);
    await backupEverything(CODE);

    // the list rots, so 2024 is parked at generation zero
    mockLocal.set(TASKS_BLOB, '[{"id":"0","tex');
    await markDirty('current');
    await backupEverything(CODE);
    expect((await loadLedger()).blocked).toEqual(['2024', 'current']);

    // the list is written again, without the 2024 deadline in it
    await saveTasks([tasks[0]]);
    await markDirty('current');
    await backupEverything(CODE);

    const ledger = await loadLedger();
    expect(ledger.blocked).toEqual([]);
    expect(pendingKeys(ledger)).toEqual([]);
    // the park came off; the document did not
    expect(readBack('tasks/2024')).toEqual([finishedIn2024]);
  });

  it('lets go of the open list it parked on a run that had no other name', async () => {
    // nothing on record and an unparseable list, so `current` is parked at generation zero
    mockLocal.set(TASKS_BLOB, '[{"id":"0","tex');
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    expect((await loadLedger()).blocked).toEqual(['current']);

    // readable again and empty, so no push will ever land under that name
    await saveTasks([]);
    await backupEverything(CODE);
    expect((await loadLedger()).blocked).toEqual([]);
  });

  it('carries a month somebody emptied on purpose instead of calling it damaged', async () => {
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);
    expect(readBack('months/2026-09')).toEqual(twoHabits);

    // both habits deleted in the planner: an ordinary edit, read whole
    await saveMonth(2026, 8, emptyMonthData());
    await markDirty('2026-09');
    await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({ status: 'complete' });

    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 1,
      pushed: 1,
      unchanged: 0,
      skipped: 0,
      blocked: [],
    });
    expect(readBack('months/2026-09')).toEqual(emptyMonthData());
    expect(pendingKeys(await loadLedger())).toEqual([]);
  });

  it('will not carry an emptiness nothing on this phone reported', async () => {
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);

    // emptied by something that is not an edit; a settled month is not even read
    await saveMonth(2026, 8, emptyMonthData());

    const sent = mockState.writes;
    await expect(backupEverything(CODE)).resolves.toMatchObject({
      ok: true,
      pushed: 0,
      unchanged: 1,
      blocked: [],
    });
    expect(mockState.writes).toBe(sent);
    expect(readBack('months/2026-09')).toEqual(twoHabits);
  });

  it('says how much actually reached the server when part of the run was refused', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 7, month);
    await saveMonth(2026, 8, { ...month, observations: ['x'.repeat(60_000), '', '', ''] });

    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 2,
      pushed: 2,
      unchanged: 0,
      skipped: 0,
      blocked: [{ key: '2026-09', reason: 'too-large', detail: 'observations' }],
    });
  });
});

describe('a restore that could not bring the deadlines down', () => {
  it('does not call itself a success, and writes nothing over the list', async () => {
    await saveMonth(2026, 8, month);
    await saveTasks([tasks[0], finishedIn2024]);
    await backupEverything(CODE);

    // another phone: the months arrive and the deadline documents do not
    mockLocal.clear();
    mockState.failTasksWith = 'firestore/permission-denied';
    await expect(restoreEverything(CODE)).resolves.toEqual({ ok: false, reason: 'rejected' });

    // nothing here claims to be the backup's deadline list
    expect(mockLocal.has(TASKS_BLOB)).toBe(false);
    expect(pendingKeys(await loadLedger())).toEqual([]);
  });

  it('empties the local list only when the backup genuinely holds no deadlines', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);

    // a phone with a deadline of its own, restoring a backup that has none
    mockLocal.clear();
    await saveTasks([tasks[0]]);
    await expect(restoreEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 1,
      skipped: 0,
      deadlines: 'none',
    });
    await expect(loadTasks()).resolves.toEqual([]);
  });

  it('leaves the deadlines alone when only some of the documents would open', async () => {
    await saveMonth(2026, 8, month);
    await saveTasks([tasks[0], finishedIn2024]);
    await backupEverything(CODE);

    // the open list will not open; the 2024 archive still will
    const openList = `backups/${deriveBackupId(CODE)}/tasks/current`;
    mockDocs.set(openList, { ...mockDocs.get(openList)!, ct: 'QQQQ' });

    // another phone, holding deadlines that exist nowhere else
    mockLocal.clear();
    const mine = [tasks[0], alsoOpen, finishedIn2025];
    await saveTasks(mine);

    await expect(restoreEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 1,
      skipped: 0,
      deadlines: 'partial',
    });
    await expect(loadTasks()).resolves.toEqual(mine);
    // this phone's own list is left waiting to be sent rather than orphaned
    expect(pendingKeys(await loadLedger())).toEqual(['2025', 'current']);
  });

  it('leaves a month the restore never covered waiting rather than orphaned', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);

    // a January the backup has never seen exists nowhere else
    mockLocal.clear();
    await saveMonth(2026, 0, month);
    await restoreEverything(CODE);
    expect(pendingKeys(await loadLedger())).toEqual(['2026-01']);
  });
});

describe('never writing what came down and cannot be vouched for', () => {
  // puts arbitrary plaintext into a document the backup already holds
  function tamper(suffix: string, plaintext: string) {
    const { seal } = jest.requireActual('../backup') as typeof import('../backup');
    const path = `backups/${deriveBackupId(CODE)}/${suffix}`;
    mockDocs.set(path, { ...seal(deriveKey(CODE), plaintext), updatedAt: '<server-time>' });
  }

  it('never writes a half-parsed month over the copy this phone already holds', async () => {
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);

    // decrypts, is a month, and parses to less than it holds
    tamper('months/2026-09', halfReadable);

    await expect(restoreEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 0,
      skipped: 1,
      deadlines: 'none',
    });

    // the phone's own September is untouched, and still whole
    await expect(loadMonth(2026, 8)).resolves.toEqual(twoHabits);
    await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({ status: 'complete' });
  });

  it('counts a half-parsed month exactly as one that would not decrypt', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);

    tamper('months/2026-09', halfReadable);
    const [january] = [...mockDocs.keys()].filter((k) => k.endsWith('2026-01'));
    mockDocs.set(january, { ...mockDocs.get(january)!, ct: 'QQQQ' });

    await expect(restoreEverything(CODE)).resolves.toMatchObject({
      ok: true,
      months: 0,
      skipped: 2,
    });
  });

  it('skips a month that decrypts to something other than JSON rather than ending the restore', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);

    tamper('months/2026-09', 'not json');
    mockLocal.clear();
    await saveMonth(2026, 8, twoHabits);

    await expect(restoreEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 1,
      skipped: 1,
      deadlines: 'none',
    });
    await expect(loadMonth(2026, 0)).resolves.toEqual(month);
    await expect(loadMonth(2026, 8)).resolves.toEqual(twoHabits);
  });

  it('pulls a month back whole when the document really is whole', async () => {
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);
    mockLocal.clear();

    await expect(restoreEverything(CODE)).resolves.toMatchObject({ ok: true, months: 1 });
    await expect(loadMonth(2026, 8)).resolves.toEqual(twoHabits);
  });

  it('leaves the deadlines alone when a document opens with rows missing from it', async () => {
    await saveMonth(2026, 8, month);
    await saveTasks([tasks[0], finishedIn2024]);
    await backupEverything(CODE);

    // still decrypts to an array of deadlines, one of which this build can't read
    tamper('tasks/2024', JSON.stringify([finishedIn2024, { ...finishedIn2024, id: 7 }]));

    // another phone, holding deadlines that exist nowhere else
    mockLocal.clear();
    const mine = [tasks[0], alsoOpen, finishedIn2025];
    await saveTasks(mine);

    await expect(restoreEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 1,
      skipped: 0,
      deadlines: 'partial',
    });
    await expect(loadTasks()).resolves.toEqual(mine);
    // this phone's own list is left waiting to be sent rather than orphaned
    expect(pendingKeys(await loadLedger())).toEqual(['2025', 'current']);
  });

  it('never empties the local list over a shard that is not a deadline list at all', async () => {
    await saveMonth(2026, 8, month);
    await saveTasks([tasks[0]]);
    await backupEverything(CODE);

    // decrypts, is JSON, and is not a list
    tamper('tasks/current', JSON.stringify({ deadlines: 'moved' }));

    mockLocal.clear();
    await saveTasks([alsoOpen]);
    await expect(restoreEverything(CODE)).resolves.toMatchObject({
      ok: true,
      deadlines: 'unreadable',
    });
    await expect(loadTasks()).resolves.toEqual([alsoOpen]);
  });

  it('still brings a deadline list down when every row of it arrives', async () => {
    await saveMonth(2026, 8, month);
    await saveTasks([tasks[0], finishedIn2024]);
    await backupEverything(CODE);

    mockLocal.clear();
    await expect(restoreEverything(CODE)).resolves.toMatchObject({ deadlines: 'restored' });
    await expect(loadTasks()).resolves.toEqual([tasks[0], finishedIn2024]);
  });
});

describe('pulling one damaged month back', () => {
  // puts a month into the backup as another phone on the same code would
  function publish(suffix: string, plaintext: string) {
    const { seal } = jest.requireActual('../backup') as typeof import('../backup');
    const path = `backups/${deriveBackupId(CODE)}/${suffix}`;
    mockDocs.set(path, { ...seal(deriveKey(CODE), plaintext), updatedAt: '<server-time>' });
  }

  // a good copy up there, a rotted one here
  async function damaged() {
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);
    mockLocal.set(monthBlob('2026-09'), halfReadable);
    await markDirty('2026-09');
  }

  it('replaces the damaged copy with the whole month from the backup', async () => {
    await damaged();
    await expect(readMonthForEditing(2026, 8)).resolves.toMatchObject({ complete: false });

    await expect(restoreMonth(CODE, 2026, 8)).resolves.toEqual({ ok: true, value: twoHabits });

    await expect(loadMonth(2026, 8)).resolves.toEqual(twoHabits);
    await expect(readMonthForEditing(2026, 8)).resolves.toEqual({
      data: twoHabits,
      complete: true,
    });
  });

  it('does not send the month straight back up over the one it came from', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    // another phone on the code added a habit, so the pulled month disagrees with the digest
    publish('months/2026-09', JSON.stringify(twoHabits));
    mockLocal.set(monthBlob('2026-09'), halfReadable);
    await markDirty('2026-09');

    await restoreMonth(CODE, 2026, 8);
    const sent = mockState.writes;
    await backupEverything(CODE);

    expect(mockState.writes).toBe(sent);
    expect(readBack('months/2026-09')).toEqual(twoHabits);
  });

  it('leaves the rest of the history accounted for rather than re-sending it', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    publish('months/2026-09', JSON.stringify(twoHabits));
    mockLocal.set(monthBlob('2026-09'), halfReadable);
    await markDirty('2026-09');

    await restoreMonth(CODE, 2026, 8);
    const sent = mockState.writes;
    await backupEverything(CODE);

    // January was never touched by any of this and does not go up again
    expect(mockState.writes).toBe(sent);
  });

  it('stops calling the month damaged once the damage has been replaced', async () => {
    await damaged();
    await backupEverything(CODE);
    expect((await loadLedger()).blocked).toContain('2026-09');

    await restoreMonth(CODE, 2026, 8);

    expect((await loadLedger()).blocked).not.toContain('2026-09');
  });

  it('refuses a month that arrives with part of it missing rather than writing it', async () => {
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);
    publish('months/2026-09', halfReadable);

    await expect(restoreMonth(CODE, 2026, 8)).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
    // nothing was written, so the phone still holds what it held
    await expect(loadMonth(2026, 8)).resolves.toEqual(twoHabits);
    await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({ status: 'complete' });
  });

  it('says so, and writes nothing, when the backup has never held that month', async () => {
    mockLocal.set(monthBlob('2026-09'), halfReadable);

    await expect(restoreMonth(CODE, 2026, 8)).resolves.toEqual({
      ok: false,
      reason: 'missing',
    });
    // the damaged record is the only copy there is, and it is still here
    expect(mockLocal.get(monthBlob('2026-09'))).toBe(halfReadable);
  });

  it('leaves the month alone when the request never arrived', async () => {
    mockLocal.set(monthBlob('2026-09'), halfReadable);
    mockState.failWith = 'firestore/unavailable';

    await expect(restoreMonth(CODE, 2026, 8)).resolves.toEqual({
      ok: false,
      reason: 'offline',
    });
    expect(mockLocal.get(monthBlob('2026-09'))).toBe(halfReadable);
  });

  // the dirty flag survives restoreMonth, so a write that never landed is found again
  it('finds the damage again when the write it made never landed', async () => {
    await damaged();
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    setItem.mockImplementationOnce(async () => undefined);

    await expect(restoreMonth(CODE, 2026, 8)).resolves.toMatchObject({ ok: true });

    await expect(backupEverything(CODE)).resolves.toMatchObject({
      blocked: [{ key: '2026-09', reason: 'incomplete', detail: '1 of 2 habits, 1 grid entry' }],
    });
    expect(readBack('months/2026-09')).toEqual(twoHabits);
  });
});

describe('erasing the backup', () => {
  const other = generateCode();

  it('removes every month and every task document under that code', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);
    await backupEverything(CODE);
    expect(mockDocs.size).toBeGreaterThan(0);

    await expect(deleteBackup(CODE)).resolves.toEqual({ ok: true, deleted: mockDocs.size });
    expect([...mockDocs.keys()]).toEqual([]);
  });

  it("leaves this phone's own data exactly where it is", async () => {
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);
    await backupEverything(CODE);
    await deleteBackup(CODE);

    // deleting the backup is not deleting your months
    await expect(loadMonth(2026, 8)).resolves.toEqual(month);
    await expect(loadTasks()).resolves.toEqual(tasks);
  });

  it('cannot reach a backup filed under another code', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    const mine = [...mockDocs.keys()];

    await deleteBackup(other);

    // the other code derives a different id, so it found nothing of ours
    expect([...mockDocs.keys()]).toEqual(mine);
  });

  it('forgets what it believed the server held, so the next run does not skip', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    await deleteBackup(CODE);

    // with the old digests still on record this would send nothing at all
    await backupEverything(CODE);
    expect([...mockDocs.keys()].some((k) => k.endsWith('/months/2026-09'))).toBe(true);
  });

  it('does not leave the ledger vouching for months it has already removed', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);

    // the months go, and the connection drops before the task shards are listed
    mockState.failTasksWith = 'firestore/unavailable';
    const result = await deleteBackup(CODE);
    expect(result.ok).toBe(false);
    expect(result.deleted).toBeGreaterThan(0);
    expect([...mockDocs.keys()].some((k) => k.endsWith('/months/2026-09'))).toBe(false);

    // the ledger was cleared, so the month is sent again rather than skipped
    mockState.failTasksWith = null;
    await backupEverything(CODE);
    expect([...mockDocs.keys()].some((k) => k.endsWith('/months/2026-09'))).toBe(true);
  });

  it('says how far it got when the server stops it part way', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    mockState.failWith = 'firestore/unavailable';

    const result = await deleteBackup(CODE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('offline');
  });
});
