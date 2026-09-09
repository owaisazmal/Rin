import AsyncStorage from '@react-native-async-storage/async-storage';
import { deriveBackupId, deriveKey, generateCode, open } from '../backup';
import {
  backupEverything,
  listMonths,
  pullMonth,
  pullTasks,
  pushMonth,
  pushTasks,
  restoreEverything,
  restoreMonth,
} from '../sync';
import { loadMonth, readMonthForEditing, readMonthVouched, saveMonth } from '../storage';
import { loadTasks, saveTasks } from '../tasks';
import { loadLedger, markDirty, pendingCount, pendingKeys } from '../syncLedger';
import { emptyMonthData } from '../types';
import type { Task } from '../tasks';
import type { Sealed } from '../backup';

/**
 * The only code in the app that touches a network, so the things worth
 * checking are what it puts on the wire and what it does when the wire is
 * unhelpful: nothing readable leaves, a wrong code reads back as nothing, and
 * whatever comes back is re-parsed rather than trusted.
 *
 * A whole-phone backup now also decides what *not* to send, which is the other
 * half of the file and the half that fails invisibly: a month wrongly judged
 * unchanged is a month that quietly stops being backed up, and nothing on any
 * screen would ever say so. So the tests below count writes rather than trust
 * a return value, and one of them asserts that a month was not even read off
 * the disk — because skipping the read is the point, not a detail of it.
 */

/** AsyncStorage, reduced to what the whole-phone flows actually touch */
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

/**
 * The real store, with both month readers wrapped so a test can ask whether a
 * month was read at all, and step in front of the read when it needs something
 * to happen mid-run. Everything else is the genuine article: these tests are
 * about what reaches the wire, and a fake parser would take that away.
 *
 * `readMonthVouched` is the one the backup uses. `loadMonth` is watched beside
 * it because it is the lossy reader — the one that answers a half-understood
 * record with the half it understood — and no path that ends at the server is
 * allowed to go anywhere near it.
 */
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
  /** every document write that reached the server, so a skip is measurable */
  writes: 0,
  /**
   * Fails the task collection alone, leaving the months readable. A restore
   * that gets its months and loses its deadlines is the shape of the worst
   * failure this file has, and nothing else here can produce it.
   */
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

jest.mock('@react-native-firebase/app-check', () => ({
  __esModule: true,
  ReactNativeFirebaseAppCheckProvider: class { configure() {} },
  initializeAppCheck: jest.fn(),
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
  mockState.writes = 0;
  mockState.failTasksWith = null;
  readMonth.mockClear();
  vouchMonth.mockClear();
});

/** Where the two stores this file reads behind their own loaders actually live */
const TASKS_BLOB = '@monthly-planning/tasks';
const monthBlob = (key: string) => `@monthly-planning/${key}`;

const CODE = generateCode();

const month = {
  ...emptyMonthData(),
  habits: [{ id: '0', name: 'Run' }],
  grid: { '1:0': 1 as const },
};

/** Two habits, with a mark on each, so there is something for a month to lose */
const twoHabits = {
  ...emptyMonthData(),
  habits: [
    { id: '0', name: 'Run' },
    { id: '1', name: 'Read' },
  ],
  grid: { '1:0': 1 as const, '2:1': 2 as const },
};

/**
 * The same month with one habit rotted on disk — a number where its name was.
 *
 * `loadMonth` drops that habit, and the grid drops the marks that belonged to
 * it, and what comes back is an ordinary-looking month with a third of it gone:
 * not empty, not obviously corrupt, and one `JSON.stringify` from the wire.
 */
const halfReadable = JSON.stringify({
  ...twoHabits,
  habits: [twoHabits.habits[0], { id: '1', name: 42 }],
});

const tasks: Task[] = [
  { id: '0', text: 'Send the invoice', due: 1_800_000_000_000, done: false },
];

/** A second open deadline, so the open list has a row it can lose */
const alsoOpen: Task = {
  id: '3',
  text: 'Renew the passport',
  due: 1_900_000_000_000,
  done: false,
};

/** Local time, so the year a task is filed under is the year the device reads */
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

/** Every document path, with the derived id blanked so it can be written down */
function paths(): string[] {
  return [...mockDocs.keys()].map((p) => p.replace(/[0-9a-f]{64}/, '<id>')).sort();
}

/** What one document actually says, for the tests that care about the split */
function readBack(suffix: string): unknown {
  const record = mockDocs.get(`backups/${deriveBackupId(CODE)}/${suffix}`);
  const plaintext = open(deriveKey(CODE), record as unknown as Sealed);
  return plaintext === null ? null : JSON.parse(plaintext);
}

describe('what goes on the wire', () => {
  it('stores ciphertext, not the month', async () => {
    await expect(pushMonth(CODE, 2026, 8, month)).resolves.toEqual({ ok: true });
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
    await pushMonth(CODE, 2026, 8, month);
    const [record] = [...mockDocs.values()];
    expect(record.updatedAt).toBe('<server-time>');
  });

  it('signs in once, not once per call', async () => {
    await pushMonth(CODE, 2026, 8, month);
    await pushMonth(CODE, 2026, 7, month);
    await pullMonth(CODE, 2026, 8);
    expect(mockState.signInCalls).toBe(1);
  });
});

describe('round trips', () => {
  it('brings a month back exactly', async () => {
    await pushMonth(CODE, 2026, 8, month);
    await expect(pullMonth(CODE, 2026, 8)).resolves.toEqual({ ok: true, value: month });
  });

  it('brings the task list back exactly', async () => {
    await pushTasks(CODE, tasks);
    await expect(pullTasks(CODE)).resolves.toEqual({ ok: true, value: tasks });
  });

  it('lists the months a backup holds, newest first, without decrypting them', async () => {
    await pushMonth(CODE, 2026, 0, month);
    await pushMonth(CODE, 2026, 8, month);
    await expect(listMonths(CODE)).resolves.toEqual({
      ok: true,
      value: ['2026-09', '2026-01'],
    });
  });
});

describe('when it cannot work', () => {
  it('reports a month that was never backed up', async () => {
    await expect(pullMonth(CODE, 2026, 8)).resolves.toEqual({ ok: false, reason: 'missing' });
    await expect(pullTasks(CODE)).resolves.toEqual({ ok: false, reason: 'missing' });
  });

  it('reports the wrong code as unreadable rather than returning nonsense', async () => {
    await pushMonth(CODE, 2026, 8, month);
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
    // sign-in runs first, so this is what a disabled anonymous provider looks
    // like — it used to be misreported as being offline
    ['auth/admin-restricted-operation', 'rejected'],
    ['auth/operation-not-allowed', 'rejected'],
    // anything else carrying a Firebase code reached Firebase
    ['auth/internal-error', 'rejected'],
    ['', 'rejected'],
  ])('reports %s as %s', async (code, reason) => {
    mockState.failWith = code;
    await expect(pushMonth(CODE, 2026, 8, month)).resolves.toEqual({ ok: false, reason });
  });

  it('never throws at the caller', async () => {
    mockState.failWith = 'firestore/unavailable';
    await expect(pushMonth(CODE, 2026, 8, month)).resolves.toMatchObject({ ok: false });
    await expect(pullMonth(CODE, 2026, 8)).resolves.toMatchObject({ ok: false });
    await expect(pushTasks(CODE, tasks)).resolves.toMatchObject({ ok: false });
    await expect(pullTasks(CODE)).resolves.toMatchObject({ ok: false });
    await expect(listMonths(CODE)).resolves.toMatchObject({ ok: false });
  });

  /**
   * This used to expect an empty month back, on the grounds that re-parsing
   * whatever arrives is better than trusting it. Re-parsing is right and
   * handing the result over is not: the answer went to `restoreEverything`,
   * which wrote it to disk over the month this phone already had.
   */
  it('refuses a month that decrypts but says something it cannot read', async () => {
    const { seal } = jest.requireActual('../backup') as typeof import('../backup');
    await pushMonth(CODE, 2026, 8, month);
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
    const huge = { ...month, observations: ['x'.repeat(60_000), '', '', ''] };
    await expect(pushMonth(CODE, 2026, 8, huge)).resolves.toEqual({
      ok: false,
      reason: 'too-large',
      detail: 'observations',
    });
    expect(mockState.writes).toBe(0);
  });
});


describe('a store that will not answer', () => {
  /**
   * The sweep that retires a flag for a month nothing is stored under rests
   * entirely on the listing being true. If a refused listing came back looking
   * like a phone with no months at all, that reasoning would retire every flag
   * on the device and settle a backup that never happened — the same mistake as
   * reading a half-parsed record as a deletion, one level up.
   */
  it('does not retire a month it merely failed to look for', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);           // settled, nothing waiting
    await saveMonth(2026, 8, { ...month, observations: ['changed', '', '', ''] });
    await markDirty('2026-09');

    const keys = AsyncStorage.getAllKeys as jest.Mock;
    keys.mockRejectedValueOnce(new Error('disk'));
    await backupEverything(CODE);

    // the month is still waiting, because the run never actually looked
    expect(pendingKeys(await loadLedger())).toEqual(['2026-09']);
  });

  it('still retires one it looked for and genuinely did not find', async () => {
    await markDirty('2026-06');             // flagged, never stored
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
    // newest first, so the September refusal is the one that used to end it
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
    await saveTasks([tasks[0], finishedIn2024, finishedIn2025]);
    await backupEverything(CODE);

    await expect(pullTasks(CODE)).resolves.toEqual({
      ok: true,
      value: [tasks[0], finishedIn2024, finishedIn2025],
    });
  });

  it('skips a shard it cannot decrypt rather than losing the list', async () => {
    await saveTasks([tasks[0], finishedIn2024]);
    await backupEverything(CODE);
    const archive = `backups/${deriveBackupId(CODE)}/tasks/2024`;
    mockDocs.set(archive, { ...mockDocs.get(archive)!, ct: 'QQQQ' });

    await expect(pullTasks(CODE)).resolves.toEqual({ ok: true, value: [tasks[0]] });
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
    // the phone still holds nothing for January, so there is nothing to send;
    // put something there and it goes, while September stays put
    await saveMonth(2026, 0, month);
    const sent = mockState.writes;
    await backupEverything(CODE);
    expect(mockState.writes).toBe(sent + 1);
  });
});

/**
 * The three ways this feature could destroy somebody's history, and the three
 * ways it could lie about having saved it.
 *
 * Every test below was written against a run that failed it. They are grouped
 * apart from the rest because they share one rule, and it is the rule the whole
 * file exists to keep: when this phone cannot read or account for something of
 * its own, the backup sends nothing and says so. An empty document is a
 * statement that somebody deleted their data, and it is never allowed to be a
 * guess.
 */
describe('never sending what this phone cannot vouch for', () => {
  it('never empties the deadline archive over a list it could not read', async () => {
    await saveTasks([tasks[0], finishedIn2024, finishedIn2025]);
    await backupEverything(CODE);

    // the stored list is truncated under the app's feet: `loadTasks` swallows
    // the parse error and answers with an empty list, exactly as it would for
    // somebody who had deleted every deadline they ever had
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

  /**
   * The same refusal on the very first run, where every name it could have used
   * has just been thrown away.
   *
   * `loadLedgerFor` wipes and re-keys the ledger before the loop starts, so a
   * phone backing up for the first time has no digests and no dirty flags —
   * which is where the names of the blocked task documents were coming from.
   * A list that would not parse was therefore blocked with *nothing* reported,
   * and the run came back a clean, fully reconciled success while somebody's
   * deadlines stayed on the phone.
   */
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

  /**
   * Absence is the one answer that legitimately means an empty list — and it
   * only means that on a phone that has never written a deadline. Here the
   * ledger holds three task digests, so this phone has sent deadlines before
   * and nothing under the key now is the local store having lost them.
   */
  it('never empties the archive over a deadline list the store has lost', async () => {
    await saveTasks([tasks[0], finishedIn2024, finishedIn2025]);
    await backupEverything(CODE);

    // the blob goes, rather than going bad. `loadTasks` and the vouched read
    // both answer "nothing here", which is exactly what a phone with no
    // deadlines at all looks like — and every shard on record was emptied on
    // the strength of it, from the one copy that is not on this phone.
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

    // the ledger holds a month digest and no task digest at all, so absence
    // here is a phone that has never written a deadline rather than one that
    // lost them, and January must still get through behind it
    await saveMonth(2026, 0, month);
    await expect(backupEverything(CODE)).resolves.toMatchObject({
      ok: true,
      pushed: 1,
      blocked: [],
    });
  });

  /**
   * The same hole one storey down, and the one the old guard could not see: it
   * was asked only when a shard had vanished entirely, so a list that lost a row
   * without losing a whole document walked straight past it.
   */
  it('never sends a deadline list it only half understands', async () => {
    await saveTasks([tasks[0], alsoOpen]);
    await backupEverything(CODE);

    // one row on disk goes bad. Both deadlines are open, so both belong to the
    // same document and nothing is orphaned — `loadTasks` drops the bad row and
    // the survivor used to be sealed and written over a document holding both.
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

    // nothing edited 2024, and it is still a document this run refused to
    // touch. Naming it in the run and forgetting it in the ledger left the two
    // accounts of the same refusal disagreeing about what is stuck.
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

    // the list comes back. The server already holds exactly those bytes, so
    // nothing will ever be pushed under 2024's name to say it is fine, and
    // nothing edits a year that is over — without this it would sit on the
    // Settings card as stuck for the life of the phone.
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

    // the list on disk is emptied by something that is not an edit — the app
    // rewriting what it read back after a failed load is the way this happens
    await saveTasks([]);

    await backupEverything(CODE);
    expect(readBack('tasks/2024')).toEqual([finishedIn2024]);
  });

  it('never overwrites a backed-up month with an empty one it could not read', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);

    // the same swallowed parse error, one storey down: `loadMonth` answers with
    // an empty month, and the digest disagrees, so the old code sealed the blank
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

  /**
   * The one this whole file is for. Everything above it is about a month that
   * came back empty, which at least announces itself; this is a month that came
   * back looking fine and was not fine, and there is nothing on any screen or in
   * any digest that could have told the difference.
   */
  it('never sends a month this phone only half understands over the good copy', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);

    // one habit on disk goes bad. The parsers drop it and the marks that
    // belonged to it, exactly as they are supposed to for a screen, and what is
    // left is a month that is emphatically not empty — so the digest disagrees
    // with the recorded one precisely as a real edit would, and the survivors
    // used to be sealed and written over the whole month on the server.
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

  /**
   * The one hole this file cannot close, pinned where its consequence lands.
   *
   * Vouching protects a damaged month right up until something writes it back.
   * `useMonthData`'s save effect fires as soon as a month finishes loading
   * rather than only when somebody types, so merely *opening* the month below
   * rewrites it in the form `loadMonth` parsed — and the record is then
   * genuinely complete: one habit short, one mark short, with nothing left
   * anywhere to say so. The backup takes it without a word, because by then
   * there is nothing left to catch.
   *
   * The fix belongs to the hook, which must not write back a month it could not
   * read in full; `readMonthForEditing` is what tells it. This test is the
   * standing evidence of what happens while it does.
   */
  it('has nothing left to catch once a damaged month has been re-saved', async () => {
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);

    mockLocal.set(monthBlob('2026-09'), halfReadable);
    await markDirty('2026-09');
    await expect(readMonthForEditing(2026, 8)).resolves.toMatchObject({ complete: false });

    // the save effect, doing exactly what it does today
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

    // the key is still listed and there is nothing behind it any more. Absence
    // is not a half-read record: there is nothing to send, the backup's copy
    // stands, and the flag comes down rather than being carried for ever.
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

    // the edit lands between the read and the refusal, so what the server
    // turned down is no longer what this phone holds
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
    // the refusal is recorded against the version that was offered, so the edit
    // that arrived after it is still waiting rather than covered by it
    expect(pendingKeys(await loadLedger())).toEqual(['2026-09']);
  });

  it('sends a month edited while the run was already under way', async () => {
    await saveMonth(2026, 8, month);
    await saveMonth(2026, 11, month);
    await backupEverything(CODE);

    // December is dirty and will be read; September is not, and the ledger
    // snapshot taken before the loop says so
    await saveMonth(2026, 11, { ...month, observations: ['December', '', '', ''] });
    await markDirty('2026-12');

    const edited = { ...month, observations: ['typed mid-run', '', '', ''] };
    const read = vouchMonth.getMockImplementation()!;
    vouchMonth.mockImplementationOnce(async (year, month) => {
      // the edit lands while December is being read, which is after the
      // snapshot and before September is looked at
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

    // paging to a fresh month writes it to disk and reports the edit; there is
    // nothing in it to send, so the flag has to come down or the phone claims
    // something is on its way for ever
    await saveMonth(2025, 3, emptyMonthData());
    await markDirty('2025-04');

    const sent = mockState.writes;
    await expect(backupEverything(CODE)).resolves.toMatchObject({ ok: true, skipped: 1 });
    expect(mockState.writes).toBe(sent);
    expect(pendingCount(await loadLedger())).toBe(0);
  });

  /**
   * The same nag one step further out, where no loop could reach it at all.
   *
   * The run walks `listStoredMonths`, so a flag naming a month with nothing
   * stored under it is never visited — the `absent` branch inside the loop only
   * ever fires for a key that was listed. `saveMonth` is best-effort and
   * swallows a failed write while the call reporting the edit runs on the next
   * line regardless, so one failure on a month nobody had stored before leaves
   * the card counting a month waiting for the life of the phone, and a run
   * starting every half hour to send a document that does not exist.
   */
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

  /**
   * A year parked while the deadline list was unreadable, which nothing could
   * ever un-park again.
   *
   * Both ways a park comes off need the document to be in the run's shards — a
   * push lands under its name, or the "already up there" branch clears a stale
   * one — and the orphan rule that puts a vanished year back into the shards
   * will not do it at generation zero, because emptying a year nobody reported
   * an edit to is how an archive gets wiped by a list that went thin on its
   * own. A finished year satisfies neither, so the card said "Deadlines you
   * finished in 2024 is not reaching the backup" for the life of the phone —
   * wrong about the cause, and offering a remedy that cannot work.
   */
  it('lets go of a year it parked that no longer holds a deadline', async () => {
    await saveTasks([tasks[0], finishedIn2024]);
    await backupEverything(CODE);

    // the stored list rots, so every document on record is parked — 2024 at
    // generation zero, since nothing has edited a finished year for months
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
    // the park came off; the document did not. Emptying a year on the strength
    // of a list that went thin without an edit is exactly the trade the orphan
    // rule already refuses to make, and this changes none of it.
    expect(readBack('tasks/2024')).toEqual([finishedIn2024]);
  });

  it('lets go of the open list it parked on a run that had no other name', async () => {
    // nothing on record and a list that will not parse, so `current` is parked
    // at generation zero as the only name there was to report
    mockLocal.set(TASKS_BLOB, '[{"id":"0","tex');
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    expect((await loadLedger()).blocked).toEqual(['current']);

    // the list is readable again and holds nothing, so no shard is computed
    // under that name and no push will ever land to say it is fine
    await saveTasks([]);
    await backupEverything(CODE);
    expect((await loadLedger()).blocked).toEqual([]);
  });

  /**
   * A month somebody cleared out on purpose, which the run used to name as
   * `unreadable` and decline to send. The vouched read says `complete`: nothing
   * is damaged and the phone knows it. So the card read "Rin could not read
   * September 2026 on this phone / this phone's copy looks damaged" over intact
   * data, and its advice — write in that month again — would have un-emptied
   * the month rather than backed it up, leaving the deletion permanently unable
   * to reach the backup.
   */
  it('carries a month somebody emptied on purpose instead of calling it damaged', async () => {
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);
    expect(readBack('months/2026-09')).toEqual(twoHabits);

    // both habits deleted in the planner: an ordinary edit, saved like any
    // other, and a record this phone reads from end to end
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

  /**
   * The gate that makes the test above safe rather than reckless, which is why
   * it is asserted separately: an empty document goes over a full one on
   * somebody's say-so and never on a digest that merely disagrees. This one
   * passes either way on purpose — it guards the half of the old behaviour that
   * was kept, not the half that was wrong.
   */
  it('will not carry an emptiness nothing on this phone reported', async () => {
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);

    // the blob is emptied by something that is not an edit and reports nothing
    // — the deadline archive's "leaves a year alone" case, one storey up. A
    // month with a recorded digest and no flag against it is not even read.
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

    // two months are safe and one is stuck, and the run says both rather than
    // leaving a screen to read "nothing got through" off a non-empty `blocked`
    await expect(backupEverything(CODE)).resolves.toEqual({
      ok: true,
      months: 2,
      pushed: 2,
      unchanged: 0,
      skipped: 0,
      blocked: [{ key: '2026-09', reason: 'too-large', detail: 'observations' }],
    });
  });

  it('joins a run already in flight instead of sending everything twice', async () => {
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);
    await backupEverything(CODE);

    await saveMonth(2026, 8, { ...month, observations: ['changed', '', '', ''] });
    await markDirty('2026-09');

    // tapping Back Up while the idle timer's run is in the air
    const sent = mockState.writes;
    const [first, second] = await Promise.all([
      backupEverything(CODE),
      backupEverything(CODE),
    ]);
    expect(mockState.writes).toBe(sent + 1);
    expect(first).toEqual(second);
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

    // nothing on this phone claims to be the backup's deadline list, so nothing
    // here can be sent back over the only copy that still has them
    expect(mockLocal.has(TASKS_BLOB)).toBe(false);
    expect(pendingKeys(await loadLedger())).toEqual([]);
  });

  it('empties the local list only when the backup genuinely holds no deadlines', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);

    // a phone with a deadline of its own, restoring a backup that has none:
    // "make this phone the other one" means the list goes
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

  /**
   * Two phones on one code, the second one on a newer build: its records carry
   * a version this build does not know, so `open` answers null for those and
   * not for the others, and the archive comes down half-openable.
   *
   * The phone keeps one flat list, so writing what arrived is a replacement
   * rather than a merge — every deadline that lived in the document that would
   * not open is deleted from the phone that still had it. The identical failure
   * for a month is counted in `skipped` and reported; this one had no state to
   * be in and no sentence to be said, so it happened in silence under "one
   * month is back".
   */
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
    // and nothing here claims to be the backup's copy of a deadline document,
    // so this phone's own list is left waiting to be sent rather than orphaned
    expect(pendingKeys(await loadLedger())).toEqual(['2025', 'current']);
  });

  it('leaves a month the restore never covered waiting rather than orphaned', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);

    // this phone has a January the backup has never seen — an older code, or a
    // second phone. It exists nowhere else, so it has to be waiting afterwards.
    mockLocal.clear();
    await saveMonth(2026, 0, month);
    await restoreEverything(CODE);
    expect(pendingKeys(await loadLedger())).toEqual(['2026-01']);
  });
});

/**
 * The same rule, pointed the other way.
 *
 * Everything above is about what leaves this phone. Nothing arriving used to be
 * vouched for at all: a document was decrypted, handed to a deliberately lossy
 * parser, and whatever survived was written to disk over the copy that was
 * already there. That is the outbound bug read backwards, and it is the worse
 * half of it — the record it overwrites is the one on somebody's phone, and
 * there is no server to fall back to afterwards.
 *
 * So a payload gets the same question a stored record gets, from the same
 * function, and a restore writes nothing it cannot answer for.
 */
describe('never writing what came down and cannot be vouched for', () => {
  /** Puts arbitrary plaintext into a document the backup already holds */
  function tamper(suffix: string, plaintext: string) {
    const { seal } = jest.requireActual('../backup') as typeof import('../backup');
    const path = `backups/${deriveBackupId(CODE)}/${suffix}`;
    mockDocs.set(path, { ...seal(deriveKey(CODE), plaintext), updatedAt: '<server-time>' });
  }

  it('never writes a half-parsed month over the copy this phone already holds', async () => {
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);

    // The server's copy goes half-readable — a newer build wrote it, or the
    // write was corrupted, or the transfer was truncated. It decrypts, it is a
    // month, and it parses to less than it holds, which is the one shape that
    // used to sail through: not a decryption failure, not a JSON failure, just
    // an ordinary-looking month with a third of it gone.
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

    // one document will not open and the other opens onto less than it holds;
    // the restore has to say the same thing about both, so the screen can
    await expect(restoreEverything(CODE)).resolves.toMatchObject({
      ok: true,
      months: 0,
      skipped: 2,
    });
  });

  it('pulls a month back whole when the document really is whole', async () => {
    // the guard above is only worth having if it lets an ordinary month past
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);
    mockLocal.clear();

    await expect(restoreEverything(CODE)).resolves.toMatchObject({ ok: true, months: 1 });
    await expect(loadMonth(2026, 8)).resolves.toEqual(twoHabits);
  });

  /**
   * The deadline half, and the quieter of the two. A shard that will not
   * decrypt was already counted; one that decrypts to a perfectly good array
   * with a row missing from it was not counted at all — so the restore poured
   * the short list over the phone's own and called it a clean success.
   */
  it('leaves the deadlines alone when a document opens with rows missing from it', async () => {
    await saveMonth(2026, 8, month);
    await saveTasks([tasks[0], finishedIn2024]);
    await backupEverything(CODE);

    // the 2024 archive still decrypts and is still an array of deadlines. One
    // of its rows is simply not one this build can read.
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
    // and nothing here claims to be the backup's copy of a deadline document,
    // so this phone's own list is left waiting to be sent rather than orphaned
    expect(pendingKeys(await loadLedger())).toEqual(['2025', 'current']);
  });

  it('never empties the local list over a shard that is not a deadline list at all', async () => {
    await saveMonth(2026, 8, month);
    await saveTasks([tasks[0]]);
    await backupEverything(CODE);

    // it decrypts, and it is JSON, and it is not a list — which used to parse
    // to an empty array and reach the phone as "the backup holds no deadlines"
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

/**
 * The way out of the one trap the vouching leaves behind.
 *
 * `has nothing left to catch once a damaged month has been re-saved`, further
 * up this file, is the trap itself, and it is standing evidence rather than a
 * bug fixed: a month whose record rotted on disk is drawn from the survivors
 * and never sent, which keeps the whole copy safe on the server, right up until
 * somebody does what the card tells them and writes in the month. From that
 * save on the thinned version is an ordinary healthy record with nothing left
 * anywhere to say what it lost, and the next run carries it over the better
 * copy.
 *
 * So the repair is made in the other direction: one month, pulled down and
 * written over the damaged one. Everything below is about the three ways that
 * could itself destroy something — writing a payload this phone cannot vouch
 * for, writing over a month the backup never held, and sending the month
 * straight back up over the document it was just copied from.
 */
describe('pulling one damaged month back', () => {
  /** Puts a month into the backup as another phone on the same code would */
  function publish(suffix: string, plaintext: string) {
    const { seal } = jest.requireActual('../backup') as typeof import('../backup');
    const path = `backups/${deriveBackupId(CODE)}/${suffix}`;
    mockDocs.set(path, { ...seal(deriveKey(CODE), plaintext), updatedAt: '<server-time>' });
  }

  /** The state the offer is made in: a good copy up there, a rotted one here */
  async function damaged() {
    await saveMonth(2026, 8, twoHabits);
    await backupEverything(CODE);
    mockLocal.set(monthBlob('2026-09'), halfReadable);
    await markDirty('2026-09');
  }

  it('replaces the damaged copy with the whole month from the backup', async () => {
    await damaged();
    // what the planner is drawing, and what it is not allowed to write back
    await expect(readMonthForEditing(2026, 8)).resolves.toMatchObject({ complete: false });

    await expect(restoreMonth(CODE, 2026, 8)).resolves.toEqual({ ok: true, value: twoHabits });

    // both habits and both marks are on the phone again, and the record is one
    // this phone can now vouch for, so an edit to it is an ordinary edit
    await expect(loadMonth(2026, 8)).resolves.toEqual(twoHabits);
    await expect(readMonthForEditing(2026, 8)).resolves.toEqual({
      data: twoHabits,
      complete: true,
    });
  });

  /**
   * The half that costs a write rather than data, and the reason the ledger is
   * told anything at all. The backup here holds a September this phone never
   * sent — another phone on the same code added a habit — so what comes down
   * disagrees with the digest on record exactly as an edit would, and without
   * the seed the very next run would seal the restored month and send it back
   * over the document it was copied from.
   */
  it('does not send the month straight back up over the one it came from', async () => {
    await saveMonth(2026, 8, month);
    await backupEverything(CODE);
    publish('months/2026-09', JSON.stringify(twoHabits));
    mockLocal.set(monthBlob('2026-09'), halfReadable);
    await markDirty('2026-09');

    await restoreMonth(CODE, 2026, 8);
    const sent = mockState.writes;
    await backupEverything(CODE);

    expect(mockState.writes).toBe(sent);
    expect(readBack('months/2026-09')).toEqual(twoHabits);
  });

  /**
   * One month restored accounts for one document. The digests for every other
   * month are this phone's belief about the same server and are still true, so
   * replacing the map rather than adding to it would re-send the whole history
   * to repair a single month.
   */
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

    // the park was put on against bytes that are no longer on this phone, and a
    // way out that leaves the card still reporting the fault has not worked
    expect((await loadLedger()).blocked).not.toContain('2026-09');
  });

  /**
   * The inbound half of the rule the whole file is built on. A document that
   * decrypts to a well-formed month with a third of it missing is the one shape
   * that looks like nothing at all going wrong, and writing it here would be
   * the same silent deletion as sending the survivors, aimed at the phone.
   */
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

  /**
   * `saveMonth` is best-effort and swallows whatever went wrong, so the write
   * is a belief rather than a fact — and this is why the dirty flag is left
   * standing afterwards instead of being retired along with the park. The next
   * run reads the month, finds the damage still there, and parks it again.
   * Retiring the flag would have that run skip the month unread from then on,
   * and the card would call a damaged month backed up.
   */
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
