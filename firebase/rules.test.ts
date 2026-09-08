import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { randomBytes as mockRandomBytes } from 'crypto';
import type { Sealed } from '../src/backup';

// The real backup module runs here too, so what the app actually produces can
// be checked against the rules that will actually receive it. Only its source
// of randomness is swapped, since expo-crypto needs a device.
jest.mock('expo-crypto', () => ({
  __esModule: true,
  getRandomBytes: (n: number) => new Uint8Array(mockRandomBytes(n)),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const backup = require('../src/backup') as typeof import('../src/backup');

/**
 * The rules are the whole server side, so this is the whole server-side test
 * suite. It runs against the Firestore emulator (`npm run test:rules`), which
 * evaluates firestore.rules exactly as production does. Each case is one thing
 * a signed-in phone — or a script pretending to be one — might try.
 */

type Db = ReturnType<RulesTestEnvironment['unauthenticatedContext']>['firestore'] extends () => infer R
  ? R
  : never;

let env: RulesTestEnvironment;

/** hex(SHA-256(...)) shaped, as the app derives it */
const ID = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rin',
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});

afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const phone = (install = 'install-1'): Db => env.authenticatedContext(install).firestore();
const nobody = (): Db => env.unauthenticatedContext().firestore();

/** A well-formed encrypted record, with any field overridden */
const blob = (over: Record<string, unknown> = {}) => ({
  v: 1,
  iv: 'A'.repeat(16),
  ct: 'Q'.repeat(200),
  updatedAt: serverTimestamp(),
  ...over,
});

const month = (db: Db, id = ID, m = '2026-09') => doc(db, 'backups', id, 'months', m);
const tasks = (db: Db, id = ID, name = 'current') => doc(db, 'backups', id, 'tasks', name);

describe('without a signed-in app', () => {
  it('nothing can be written', async () => {
    await assertFails(setDoc(month(nobody()), blob()));
  });

  it('nothing can be read', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(month(ctx.firestore()), blob()));
    await assertFails(getDoc(month(nobody())));
  });
});

describe('a signed-in phone', () => {
  it('can write, read back and list the months of a backup it knows the id of', async () => {
    const db = phone();
    await assertSucceeds(setDoc(month(db), blob()));
    await assertSucceeds(setDoc(month(db, ID, '2026-08'), blob()));
    await assertSucceeds(getDoc(month(db)));
    const listed = await assertSucceeds(getDocs(collection(db, 'backups', ID, 'months')));
    expect(listed.size).toBe(2);
  });

  it('can update and delete', async () => {
    const db = phone();
    await setDoc(month(db), blob());
    await assertSucceeds(updateDoc(month(db), blob({ ct: 'R'.repeat(300) })));
    await assertSucceeds(deleteDoc(month(db)));
  });

  it('is not tied to an install: the id is the credential, by design', async () => {
    await setDoc(month(phone('old-phone')), blob());
    await assertSucceeds(getDoc(month(phone('new-phone'))));
  });

  it('cannot go looking for backups it does not know the id of', async () => {
    await setDoc(month(phone()), blob());
    // a guess at an id is allowed through — the space is 2^256 — and finds nothing
    const guessed = await assertSucceeds(getDoc(month(phone(), OTHER)));
    expect(guessed.exists()).toBe(false);
    // the ways of discovering ids are what the rules shut
    await assertFails(getDocs(collection(phone(), 'backups')));
    await assertFails(getDocs(collectionGroup(phone(), 'months')));
  });
});

describe('what a record must look like', () => {
  it.each([
    ['too short an id', 'a'.repeat(63), '2026-09'],
    ['uppercase hex', 'A'.repeat(64), '2026-09'],
    ['not hex', 'z'.repeat(64), '2026-09'],
    ['month 13', ID, '2026-13'],
    ['month 0', ID, '2026-00'],
    ['a year before 2000', ID, '1999-12'],
    ['a name for a month', ID, 'september'],
  ])('refuses %s in the path', async (_, id, m) => {
    await assertFails(setDoc(month(phone(), id, m), blob()));
  });

  const wrong: [string, Record<string, unknown>][] = [
    ['an extra field', { note: 'hi' }],
    ['an unknown version', { v: 2 }],
    ['a nonce that is too short', { iv: 'A'.repeat(15) }],
    ['a nonce that is too long', { iv: 'A'.repeat(33) }],
    ['a nonce that is not a string', { iv: 12 }],
    ['empty ciphertext', { ct: '' }],
    ['ciphertext that is not a string', { ct: ['Q'] }],
    ["the phone's clock instead of the server's", { updatedAt: new Date() }],
  ];

  it.each(wrong)('refuses %s', async (_, over) => {
    await assertFails(setDoc(month(phone()), blob(over)));
  });

  it('refuses a record with no timestamp at all', async () => {
    const { updatedAt: _, ...withoutTimestamp } = blob();
    await assertFails(setDoc(month(phone()), withoutTimestamp));
  });

  it('caps a month at 64 KiB of ciphertext', async () => {
    await assertSucceeds(setDoc(month(phone()), blob({ ct: 'Q'.repeat(65536) })));
    await assertFails(setDoc(month(phone()), blob({ ct: 'Q'.repeat(65537) })));
  });

  it('refuses a missing field on update as firmly as on create', async () => {
    const db = phone();
    await setDoc(month(db), blob());
    await assertFails(updateDoc(month(db), { note: 'hi' }));
  });
});

describe('the task list', () => {
  it('is one record named "current" and nothing else', async () => {
    const db = phone();
    await assertSucceeds(setDoc(tasks(db), blob()));
    await assertSucceeds(getDoc(tasks(db)));
    await assertFails(setDoc(tasks(db, ID, 'other'), blob()));
    await assertFails(getDoc(tasks(db, ID, 'other')));
    await assertSucceeds(deleteDoc(tasks(db)));
  });

  it('caps at 256 KiB of ciphertext', async () => {
    await assertSucceeds(setDoc(tasks(phone()), blob({ ct: 'Q'.repeat(262144) })));
    await assertFails(setDoc(tasks(phone()), blob({ ct: 'Q'.repeat(262145) })));
  });
});

describe('anything else', () => {
  it('is unreachable', async () => {
    const db = phone();
    await assertFails(setDoc(doc(db, 'users', 'u1'), { any: 'thing' }));
    await assertFails(setDoc(doc(db, 'backups', ID), { any: 'thing' }));
    await assertFails(setDoc(doc(db, 'backups', ID, 'notes', 'n1'), blob()));
  });
});

/**
 * The seam between the two halves of the design: what `src/backup.ts` encrypts
 * on the phone, and what `firestore.rules` will let through. Both are checked
 * on their own above; this is the only place they meet, and a change to either
 * that breaks the other shows up here rather than on a user's phone.
 */
describe('what the app actually produces', () => {
  const code = backup.generateCode();
  const id = backup.deriveBackupId(code);
  const key = backup.deriveKey(code);

  it('files a real month under an id the rules accept, and reads it back', async () => {
    const db = phone();
    const plaintext = JSON.stringify({
      habits: [{ id: '0', name: 'Run' }],
      grid: { '1:0': 1 },
      observations: ['凛'],
      keyGoals: [{ text: 'Ship it', done: true }],
    });
    const sealed = backup.seal(key, plaintext);

    await assertSucceeds(
      setDoc(doc(db, 'backups', id, 'months', '2026-09'), {
        ...sealed,
        updatedAt: serverTimestamp(),
      })
    );

    const stored = await assertSucceeds(getDoc(doc(db, 'backups', id, 'months', '2026-09')));
    const data = stored.data() as Sealed;
    // the server holds nothing readable
    expect(JSON.stringify(data)).not.toContain('Run');
    expect(JSON.stringify(data)).not.toContain('Ship it');
    // and the phone gets it all back
    expect(backup.open(key, data)).toBe(plaintext);
  });

  it('files the task list the same way', async () => {
    const plaintext = JSON.stringify([{ id: '0', text: 'Send the invoice', due: 1, done: false }]);
    await assertSucceeds(
      setDoc(doc(phone(), 'backups', id, 'tasks', 'current'), {
        ...backup.seal(key, plaintext),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('produces an id no other code produces', async () => {
    const other = backup.deriveBackupId(backup.generateCode());
    expect(other).not.toBe(id);
    // and it is still a shape the rules accept
    await assertSucceeds(
      setDoc(doc(phone(), 'backups', other, 'months', '2026-01'), {
        ...backup.seal(backup.deriveKey(code), 'x'),
        updatedAt: serverTimestamp(),
      })
    );
  });
});
