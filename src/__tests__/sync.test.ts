import { generateCode, deriveKey, open } from '../backup';
import {
  backupEverything,
  listMonths,
  pullMonth,
  pullTasks,
  pushMonth,
  pushTasks,
  restoreEverything,
} from '../sync';
import { loadMonth, saveMonth } from '../storage';
import { loadTasks, saveTasks } from '../tasks';
import { emptyMonthData } from '../types';
import type { Task } from '../tasks';

/**
 * The only code in the app that touches a network, so the things worth
 * checking are what it puts on the wire and what it does when the wire is
 * unhelpful: nothing readable leaves, a wrong code reads back as nothing, and
 * whatever comes back is re-parsed rather than trusted.
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

jest.mock('expo-crypto', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

const mockDocs = new Map<string, Record<string, unknown>>();
const mockState = { signedIn: false, failWith: null as string | null, signInCalls: 0 };

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
      mockDocs.set(ref.path, data);
    }),
    getDoc: jest.fn(async (ref: { path: string }) => {
      fail();
      const data = mockDocs.get(ref.path);
      return { exists: () => data !== undefined, data: () => data };
    }),
    getDocs: jest.fn(async (ref: { path: string }) => {
      fail();
      const prefix = `${ref.path}/`;
      return {
        docs: [...mockDocs.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((k) => ({ id: k.slice(prefix.length) })),
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

  it('re-parses what comes back instead of trusting it', async () => {
    // a record that decrypts but says something the app does not understand
    const { seal } = jest.requireActual('../backup') as typeof import('../backup');
    await pushMonth(CODE, 2026, 8, month);
    const [path] = [...mockDocs.keys()];
    mockDocs.set(path, {
      ...seal(deriveKey(CODE), JSON.stringify({ habits: 'not an array', grid: 42 })),
      updatedAt: '<server-time>',
    });
    const result = await pullMonth(CODE, 2026, 8);
    expect(result).toEqual({ ok: true, value: emptyMonthData() });
  });
});


describe('backing up the whole phone', () => {
  it('sends every stored month and the task list', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, month);
    await saveTasks(tasks);

    await expect(backupEverything(CODE)).resolves.toEqual({ ok: true, months: 2 });
    const paths = [...mockDocs.keys()].map((p) => p.replace(/[0-9a-f]{64}/, '<id>'));
    expect(paths.sort()).toEqual([
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

  it('stops at the first refusal rather than hammering a closed door', async () => {
    await saveMonth(2026, 0, month);
    await saveMonth(2026, 8, month);
    mockState.failWith = 'firestore/permission-denied';
    await expect(backupEverything(CODE)).resolves.toEqual({ ok: false, reason: 'rejected' });
    expect(mockDocs.size).toBe(0);
  });

  it('succeeds with nothing to send on a phone that has never been used', async () => {
    await expect(backupEverything(CODE)).resolves.toEqual({ ok: true, months: 0 });
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
    expect(result).toEqual({ ok: true, months: 1, skipped: 1 });
    // the good one landed, the bad one left nothing behind
    await expect(loadMonth(2026, 8)).resolves.toEqual(month);
    expect(mockLocal.has('@monthly-planning/2026-01')).toBe(false);
  });
});
