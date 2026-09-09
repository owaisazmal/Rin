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

/**
 * What asking the backup what it holds costs, and which phones are allowed to
 * ask.
 *
 * The card offers to pull a damaged month back down, and it may only offer that
 * when the backup actually has the month — so somewhere, something has to list
 * the months. A listing is a read, and a read is an anonymous sign-in and the
 * code out of the Keychain before it is anything else. The rule this app has
 * held to every round is that a phone which is opened and not edited costs none
 * of those, so the question is asked for the states whose wording turns on the
 * answer and for no others.
 *
 * That condition was too narrow for the one case it existed for. Only a blocked
 * document brought it to life, and a document is blocked only by a run that
 * tried to send it — so a month that went bad where it lay, which no run ever
 * looks at, was never listed and never offered the rescue. Widening it is the
 * change under test here, and the thing worth proving is that it was widened by
 * exactly one state.
 *
 * Every status below is built from a ledger that was actually written to, by
 * the same calls the screens and the runs make, and the reads are counted at
 * Firestore.
 */

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

/**
 * The root effect, in the order it runs: look at what the card is about to say,
 * and go to the network only if the answer would change it. The `if` is the one
 * line `App.tsx` repeats, and it repeats it by calling the same function.
 */
async function look(): Promise<void> {
  const status = statusOf(await loadLedger(), NO_RUNS);
  if (!needsHolds(status)) return;
  await listMonths(CODE);
}

/** The signed-in state of an install that has never touched the network */
const untouched = () => ({ reads: mockState.reads, signedIn: mockState.signedIn });

describe('what an ordinary phone costs when the app is opened', () => {
  it('costs nothing at all on a phone that has never done anything', () => {
    // Not even a ledger on disk. This is a fresh install and the first frames
    // of every launch, and it must not turn into a request.
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

  /**
   * The month damaged on the disk, which is what this change is for. It is not
   * dirty, not blocked and not waiting — nothing about it is a reason to start
   * a run — and it is the one thing on a quiet phone worth a question, because
   * the answer decides whether the card may offer the copy in the backup or has
   * to say that this damaged one is all there is.
   */
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

  /**
   * And the widening stops there. A note about a record this phone cannot read
   * is emphatically not a reason to back anything up — what this phone holds is
   * the half of a record that survived a parse, and sending that is the whole
   * fault the note exists to prevent — so neither trigger may start a run over
   * it. The lookup and the run are two different questions and only one of them
   * moved.
   */
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
          settled: '',
          attempted: '',
          setbacks: 0,
          turnedAway: 0,
          since: Number.MAX_SAFE_INTEGER,
        })
      ).toBe(false);
    }
  });

  /**
   * The month was repaired, by an edit or by the restore the card offered, and
   * the note came off. What must not survive is the question: a phone that has
   * nothing left to ask about goes back to costing nothing, rather than listing
   * the backup on every launch for the rest of its life.
   */
  it('goes quiet again once the record is whole', async () => {
    await recordUnvouched('2026-09', '2 of 12 habits');
    await clearUnvouched('2026-09');

    await look();

    expect(untouched()).toEqual({ reads: 0, signedIn: false });
  });
});
