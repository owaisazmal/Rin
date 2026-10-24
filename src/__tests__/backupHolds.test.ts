import { deriveBackupId, generateCode } from '../backup';
import { listMonths } from '../sync';
import {
  clearUnvouched,
  loadLedger,
  markDirty,
  recordBlocked,
  recordUnvouched,
  seedPushed,
} from '../syncLedger';
import { NO_RUNS, shouldRun, statusOf } from '../hooks/autoBackupPolicy';
import { needsHolds } from '../screens/backupWording';

const mockLocal = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockLocal.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockLocal.set(k, v);
    }),
  },
}));
jest.mock('expo-crypto', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

const mockState = { signedIn: false, reads: 0 };

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
  getToken: jest.fn(),
}));
jest.mock('@react-native-firebase/firestore', () => ({
  __esModule: true,
  getFirestore: () => ({}),
  serverTimestamp: () => '<server-time>',
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(async () => {
    mockState.reads++;
    return { docs: [] };
  }),
}));

const CODE = generateCode();

beforeEach(() => {
  mockLocal.clear();
  mockState.signedIn = false;
  mockState.reads = 0;
});

/** The root effect in App.tsx: list the backup only when the card's wording needs it */
async function look(): Promise<void> {
  const status = statusOf(await loadLedger(), NO_RUNS);
  if (!needsHolds(status)) return;
  await listMonths(CODE);
}

/** The signed-in state of an install that has never touched the network */
const untouched = () => ({ reads: mockState.reads, signedIn: mockState.signedIn });

describe('what an ordinary phone costs when the app is opened', () => {
  it('costs nothing at all on a phone that has never done anything', () => {
    return look().then(() => expect(untouched()).toEqual({ reads: 0, signedIn: false }));
  });

  it('costs nothing on a phone with edits waiting to go', async () => {
    await markDirty('2026-09');

    await look();

    expect(untouched()).toEqual({ reads: 0, signedIn: false });
  });

  it('costs nothing on a phone that has been checked and found settled', async () => {
    await seedPushed(deriveBackupId(CODE), { '2026-09': 'a'.repeat(64) });

    await look();

    expect(untouched()).toEqual({ reads: 0, signedIn: false });
  });

  it('asks exactly once when this phone is holding a record it cannot read', async () => {
    await recordUnvouched('2026-09', '2 of 12 habits');

    await look();

    expect(mockState.reads).toBe(1);
  });

  it('asks when a run was refused something, as it always did', async () => {
    await recordBlocked('2026-09', 1);

    await look();

    expect(mockState.reads).toBe(1);
  });

  it('is not a reason to start a run, on either trigger', async () => {
    await seedPushed(deriveBackupId(CODE), { '2026-09': 'a'.repeat(64) });
    await recordUnvouched('2026-09', '2 of 12 habits');
    const ledger = await loadLedger();

    for (const trigger of ['opened', 'idle'] as const) {
      expect(
        shouldRun(trigger, {
          ledger,
          accounted: true,
          seen: '',
          attempted: '',
          stalled: false,
          turnedAway: 0,
          since: Number.MAX_SAFE_INTEGER,
        })
      ).toBe(false);
    }
  });

  it('goes quiet again once the record is whole', async () => {
    await recordUnvouched('2026-09', '2 of 12 habits');
    await clearUnvouched('2026-09');

    await look();

    expect(untouched()).toEqual({ reads: 0, signedIn: false });
  });
});
