/** TEMPORARY ADVERSARIAL PROBE — delete after the review run. */
import { deriveBackupId, deriveKey, generateCode, seal } from '../backup';
import { backupEverything } from '../sync';
import { saveMonth } from '../storage';
import { loadLedger } from '../syncLedger';
import { backupCard } from '../screens/backupWording';
import type { BackupStatus } from '../hooks/autoBackupPolicy';
import { emptyMonthData } from '../types';

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
jest.mock('expo-crypto', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

const mockDocs = new Map<string, Record<string, unknown>>();
const mockState = { signedIn: false, writes: 0, rejectAll: false, attempts: 0 };

jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  getAuth: () => ({
    get currentUser() {
      return mockState.signedIn ? { uid: 'anon' } : null;
    },
  }),
  signInAnonymously: jest.fn(async () => {
    mockState.signedIn = true;
  }),
}));
jest.mock('@react-native-firebase/app-check', () => ({
  __esModule: true,
  ReactNativeFirebaseAppCheckProvider: class {
    configure() {}
  },
  initializeAppCheck: jest.fn(),
}));
jest.mock('@react-native-firebase/firestore', () => ({
  __esModule: true,
  getFirestore: () => ({}),
  serverTimestamp: () => '<server-time>',
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  setDoc: jest.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
    mockState.attempts++;
    if (mockState.rejectAll) {
      const e = new Error('denied') as Error & { code: string };
      e.code = 'permission-denied';
      throw e;
    }
    mockState.writes++;
    mockDocs.set(ref.path, data);
  }),
  getDoc: jest.fn(async (ref: { path: string }) => {
    const data = mockDocs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  }),
  getDocs: jest.fn(async (ref: { path: string }) => {
    const prefix = `${ref.path}/`;
    return {
      docs: [...mockDocs.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ id: k.slice(prefix.length), data: () => mockDocs.get(k) })),
    };
  }),
}));

beforeEach(() => {
  mockDocs.clear();
  mockLocal.clear();
  mockState.signedIn = false;
  mockState.writes = 0;
  mockState.rejectAll = false;
  mockState.attempts = 0;
});

const CODE = generateCode();
const twoHabits = { ...emptyMonthData(), habits: [{ id: '0', name: 'Run' }] };

describe('CLAIM: "Rin will keep trying this on its own"', () => {
  it('a rejected month is parked and NOT retried by a later run without an edit', async () => {
    await saveMonth(2026, 8, twoHabits);
    mockState.rejectAll = true;

    const first = await backupEverything(CODE);
    expect(first.ok).toBe(true);
    expect((first as { blocked: { reason: string }[] }).blocked).toEqual([
      { key: '2026-09', reason: 'rejected' },
    ]);
    const attemptsAfterFirst = mockState.attempts;
    expect(attemptsAfterFirst).toBeGreaterThan(0);
    expect((await loadLedger()).blocked).toContain('2026-09');

    // the server is healthy again, and the app runs again on its own
    mockState.rejectAll = false;
    mockState.attempts = 0;
    const second = await backupEverything(CODE);

    // eslint-disable-next-line no-console
    console.log(
      `second run: attempts=${mockState.attempts} writes=${mockState.writes} pushed=${(second as { pushed: number }).pushed}`
    );
    // TRUE: the run walks every stored month and re-attempts anything whose
    // recorded digest does not match, so the park suppresses the *waiting
    // count* and not the send. The claim on the card holds.
    expect(mockState.attempts).toBe(1);
    expect(mockDocs.has(`backups/${deriveBackupId(CODE)}/months/2026-09`)).toBe(true);
    expect((await loadLedger()).blocked).not.toContain('2026-09');
  });

  it('and once it lands the phone goes quiet again', async () => {
    await saveMonth(2026, 8, twoHabits);
    mockState.rejectAll = true;
    await backupEverything(CODE);
    mockState.rejectAll = false;
    mockState.attempts = 0;
    await backupEverything(CODE);
    // it went up on the first healthy run, so later runs are free
    expect(mockState.attempts).toBe(1);
    await backupEverything(CODE);
    await backupEverything(CODE);
    expect(mockState.attempts).toBe(1);
  });

  it('the card that makes the claim is the one that ships', () => {
    const card = backupCard(
      {
        waiting: [],
        blocked: [{ key: '2026-09', reason: 'rejected' }],
        damaged: [],
        reconciled: true,
      } as unknown as BackupStatus,
      null,
      null
    );
    // eslint-disable-next-line no-console
    console.log(`\nSHIPPED rejected card body:\n  ${card.body}`);
    expect(card.body).toContain('Rin will keep trying this on its own');
  });
});
