import { createHash } from 'crypto';
import {
  Ledger,
  bindingFor,
  clearBlocked,
  digestOf,
  emptyLedger,
  generationOf,
  isPending,
  loadLedger,
  loadLedgerFor,
  markDirty,
  pendingCount,
  pendingKeys,
  recordBlocked,
  recordPushed,
  recordSkipped,
  resetFor,
  seedPushed,
} from '../syncLedger';

/**
 * The ledger decides what a backup is allowed to skip, so every test here is
 * really the same question asked three ways: can a document that changed end up
 * looking like one already sent? A ledger that forgets too much costs an
 * upload. A ledger that remembers something untrue costs somebody's September.
 */

const mockStored = new Map<string, string>();
const mockFailure = { read: false, write: false };

/**
 * The delay is the point. Every mutation is a read-modify-write, so a mock that
 * answered synchronously would let two of them interleave in a way real storage
 * never quite does — and would let the serialisation test pass without there
 * being any serialisation.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const yieldToOthers = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => {
        await yieldToOthers();
        if (mockFailure.read) throw new Error('disk');
        return mockStored.get(key) ?? null;
      }),
      setItem: jest.fn(async (key: string, value: string) => {
        await yieldToOthers();
        if (mockFailure.write) throw new Error('disk');
        mockStored.set(key, value);
      }),
    },
  };
});

/** Two backup ids of the shape `deriveBackupId` produces, without the crypto */
const ID = 'a'.repeat(64);
const OTHER_ID = 'b'.repeat(64);

const SEPTEMBER = '2026-09';
const AUGUST = '2026-08';
const JANUARY = '2026-01';
const FEBRUARY = '2026-02';
const TASKS = 'current';

beforeEach(() => {
  mockStored.clear();
  mockFailure.read = false;
  mockFailure.write = false;
});

/** What is actually on disk, as opposed to what the module says is */
function onDisk(): unknown {
  const raw = mockStored.get('@monthly-planning/sync-ledger');
  return raw === undefined ? undefined : JSON.parse(raw);
}

describe('the record itself', () => {
  it('is one entry, under one key', async () => {
    await markDirty(SEPTEMBER);
    await markDirty(TASKS);
    await recordPushed(SEPTEMBER, digestOf('{}'), 1);
    expect([...mockStored.keys()]).toEqual(['@monthly-planning/sync-ledger']);
  });

  it('knows nothing on a phone that has never backed up', async () => {
    await expect(loadLedger()).resolves.toEqual(emptyLedger());
    expect(pendingCount(await loadLedger())).toBe(0);
  });

  it('reads back what was written', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);
    await recordPushed(SEPTEMBER, digestOf('september'), 1);
    await markDirty(AUGUST);

    const ledger = await loadLedger();
    expect(ledger.binding).toBe(bindingFor(ID));
    expect(ledger.digests).toEqual({ [SEPTEMBER]: digestOf('september') });
    expect(ledger.dirty).toEqual({ [AUGUST]: 1 });
    expect(ledger.blocked).toEqual([]);
    expect(ledger.lastPushAt).toEqual(expect.any(Number));
  });

  it('has nothing to say about a document nobody has touched', async () => {
    const ledger = await loadLedgerFor(ID);
    expect(ledger.digests[SEPTEMBER]).toBeUndefined();
    expect(generationOf(ledger, SEPTEMBER)).toBe(0);
  });
});

/**
 * The dangerous one. A digest that outlives the code it was recorded under
 * describes a document on a server this phone is no longer talking to.
 */
describe('the backup id it is bound to', () => {
  beforeEach(async () => {
    await resetFor(ID);
    await recordPushed(SEPTEMBER, digestOf('september'), 0);
    await recordPushed(TASKS, digestOf('tasks'), 0);
    await markDirty(AUGUST);
    await recordBlocked(AUGUST);
  });

  it('keeps what it knows for the id it was written for', async () => {
    const ledger = await loadLedgerFor(ID);
    expect(ledger.digests[SEPTEMBER]).toBe(digestOf('september'));
    expect(ledger.blocked).toEqual([AUGUST]);
  });

  it('knows nothing at all about a different id', async () => {
    const ledger = await loadLedgerFor(OTHER_ID);
    expect(ledger).toEqual(emptyLedger(OTHER_ID));
    // named individually, because any one of these surviving is a month that
    // the next backup would decide it had already sent
    expect(ledger.digests).toEqual({});
    expect(ledger.dirty).toEqual({});
    expect(ledger.blocked).toEqual([]);
    expect(ledger.lastPushAt).toBeNull();
  });

  it('wipes the stored record rather than hiding it from the caller', async () => {
    await loadLedgerFor(OTHER_ID);
    // anything that read the record afterwards would otherwise see the old
    // digests come back, and skip every month under the new code
    expect(await loadLedger()).toEqual(emptyLedger(OTHER_ID));
    expect(onDisk()).toEqual(emptyLedger(OTHER_ID));
  });

  it('treats a ledger from before there was a code as belonging to no backup', async () => {
    mockStored.clear();
    await markDirty(SEPTEMBER);
    await expect(loadLedgerFor(ID)).resolves.toEqual(emptyLedger(ID));
  });

  it('does not let a later push land under the old id', async () => {
    await loadLedgerFor(OTHER_ID);
    await recordPushed(SEPTEMBER, digestOf('september again'), 0);
    const ledger = await loadLedger();
    expect(ledger.binding).toBe(bindingFor(OTHER_ID));
    expect(ledger.digests).toEqual({ [SEPTEMBER]: digestOf('september again') });
  });
});

/**
 * The second dangerous one. A backup takes seconds and someone can tick a cell
 * inside them; the generation counter is the only thing that notices.
 */
describe('a change made while the push was in flight', () => {
  it('clears the dirty flag when nothing moved underneath it', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);

    const before = await loadLedgerFor(ID);
    await recordPushed(SEPTEMBER, digestOf('september'), generationOf(before, SEPTEMBER));

    const after = await loadLedger();
    expect(after.dirty[SEPTEMBER]).toBeUndefined();
    expect(pendingCount(after)).toBe(0);
  });

  it('keeps it dirty when the month was edited mid-push', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);

    // the run picks the month up and starts sealing it
    const before = await loadLedgerFor(ID);
    const generation = generationOf(before, SEPTEMBER);

    // and while those bytes are on the wire, somebody ticks a cell
    await markDirty(SEPTEMBER);

    await recordPushed(SEPTEMBER, digestOf('september as it was sent'), generation);

    const after = await loadLedger();
    expect(after.dirty[SEPTEMBER]).toBe(generation + 1);
    expect(pendingCount(after)).toBe(1);
  });

  it('records the digest of what actually landed, edit or no edit', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);
    const generation = generationOf(await loadLedgerFor(ID), SEPTEMBER);
    await markDirty(SEPTEMBER);
    await recordPushed(SEPTEMBER, digestOf('september as it was sent'), generation);

    // the digest describes the server, not the phone: it is what is up there
    const after = await loadLedger();
    expect(after.digests[SEPTEMBER]).toBe(digestOf('september as it was sent'));
    expect(after.digests[SEPTEMBER]).not.toBe(digestOf('september after the edit'));
  });

  it('leaves a document dirty through every edit until one of them is sent', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);
    await markDirty(SEPTEMBER);
    await markDirty(SEPTEMBER);
    expect(generationOf(await loadLedger(), SEPTEMBER)).toBe(3);

    // a stale generation from two edits ago settles nothing
    await recordPushed(SEPTEMBER, digestOf('one edit ago'), 1);
    expect((await loadLedger()).dirty[SEPTEMBER]).toBe(3);

    await recordPushed(SEPTEMBER, digestOf('all three edits'), 3);
    expect((await loadLedger()).dirty[SEPTEMBER]).toBeUndefined();
  });
});

/**
 * The third. Saving a month and saving the task list are separate calls from
 * separate screens, and nothing makes them take turns except this.
 */
describe('writes that overlap', () => {
  it('keeps every key when saves land in the same tick', async () => {
    await resetFor(ID);
    const keys = [SEPTEMBER, AUGUST, TASKS, '2025-12', '2024'];
    await Promise.all(keys.map(markDirty));

    const ledger = await loadLedger();
    expect(Object.keys(ledger.dirty).sort()).toEqual([...keys].sort());
    expect(pendingCount(ledger)).toBe(keys.length);
  });

  it('counts every bump of the same key', async () => {
    await resetFor(ID);
    await Promise.all([markDirty(SEPTEMBER), markDirty(SEPTEMBER), markDirty(SEPTEMBER)]);
    expect(generationOf(await loadLedger(), SEPTEMBER)).toBe(3);
  });

  it('does not let a push in flight erase a save made beside it', async () => {
    await resetFor(ID);
    await Promise.all([
      recordPushed(SEPTEMBER, digestOf('september'), 0),
      markDirty(AUGUST),
      recordBlocked(TASKS),
    ]);

    const ledger = await loadLedger();
    expect(ledger.digests[SEPTEMBER]).toBe(digestOf('september'));
    expect(ledger.dirty[AUGUST]).toBe(1);
    expect(ledger.blocked).toEqual([TASKS]);
  });
});

describe('digests', () => {
  it('is the sha256 of the plaintext, hex', () => {
    const plaintext = JSON.stringify({ habits: [{ id: '0', name: 'Run' }] });
    expect(digestOf(plaintext)).toBe(createHash('sha256').update(plaintext, 'utf8').digest('hex'));
    expect(digestOf(plaintext)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('says the same thing every time about the same month', () => {
    expect(digestOf('september')).toBe(digestOf('september'));
  });

  it('notices a single character', () => {
    expect(digestOf('{"grid":{"1:0":1}}')).not.toBe(digestOf('{"grid":{"1:0":2}}'));
  });

  it('handles text that is not ASCII, and empty text', () => {
    expect(digestOf('凛 — 走った 🏃')).toMatch(/^[0-9a-f]{64}$/);
    expect(digestOf('')).toBe(createHash('sha256').update('').digest('hex'));
  });
});

describe('a document the server refused', () => {
  it('stops being counted as waiting, without being called sent', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);
    await markDirty(AUGUST);
    await recordBlocked(AUGUST);

    const ledger = await loadLedger();
    expect(pendingCount(ledger)).toBe(1);
    // still dirty, and still with no digest: nothing here claims it is backed up
    expect(ledger.dirty[AUGUST]).toBe(1);
    expect(ledger.digests[AUGUST]).toBeUndefined();
  });

  it('is listed once however many times it is refused', async () => {
    await resetFor(ID);
    await recordBlocked(AUGUST);
    await recordBlocked(AUGUST);
    expect((await loadLedger()).blocked).toEqual([AUGUST]);
  });

  it('is waiting again once it is cleared', async () => {
    await resetFor(ID);
    await markDirty(AUGUST);
    await recordBlocked(AUGUST);
    await clearBlocked(AUGUST);

    const ledger = await loadLedger();
    expect(ledger.blocked).toEqual([]);
    expect(pendingCount(ledger)).toBe(1);
  });

  it('stops being refused the moment a push of it lands', async () => {
    await resetFor(ID);
    await markDirty(AUGUST);
    await recordBlocked(AUGUST);
    await recordPushed(AUGUST, digestOf('august, smaller'), 1);

    const ledger = await loadLedger();
    expect(ledger.blocked).toEqual([]);
    expect(pendingCount(ledger)).toBe(0);
  });
});

describe('a phone that has just restored', () => {
  it('starts life owing the server nothing', async () => {
    const entries = { [SEPTEMBER]: digestOf('september'), [TASKS]: digestOf('tasks') };
    await seedPushed(ID, entries);

    const ledger = await loadLedgerFor(ID);
    expect(ledger.digests).toEqual(entries);
    expect(pendingCount(ledger)).toBe(0);
    // nothing was pushed — the bytes went the other way
    expect(ledger.lastPushAt).toBeNull();
  });

  it('replaces whatever the phone knew before, rather than adding to it', async () => {
    await resetFor(OTHER_ID);
    await recordPushed(AUGUST, digestOf('august'), 0);
    await markDirty(AUGUST);

    await seedPushed(ID, { [SEPTEMBER]: digestOf('september') });
    const ledger = await loadLedger();
    expect(ledger.binding).toBe(bindingFor(ID));
    expect(ledger.digests).toEqual({ [SEPTEMBER]: digestOf('september') });
    expect(ledger.dirty).toEqual({});
  });

  it('drops a seeded digest that is not one', async () => {
    await seedPushed(ID, { [SEPTEMBER]: 'not a digest' });
    // an unaccountable month is one that gets sent, which is the safe way round
    expect((await loadLedger()).digests).toEqual({});
  });
});

describe('what it survives', () => {
  it.each([
    ['broken JSON', '{not json'],
    ['a string', '"nope"'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a record of the wrong shape', '{"digests":7,"dirty":"lots","blocked":{},"backupId":42}'],
  ])('reads %s as knowing nothing', async (_, stored) => {
    mockStored.set('@monthly-planning/sync-ledger', stored);
    await expect(loadLedger()).resolves.toEqual(emptyLedger());
  });

  it('drops a digest that could not have come from digestOf', async () => {
    mockStored.set(
      '@monthly-planning/sync-ledger',
      JSON.stringify({
        binding: bindingFor(ID),
        digests: { [SEPTEMBER]: 'short', [AUGUST]: 4, '2025-12': digestOf('december') },
      })
    );
    expect((await loadLedger()).digests).toEqual({ '2025-12': digestOf('december') });
  });

  it('keeps a dirty flag it cannot read rather than calling it clean', async () => {
    mockStored.set(
      '@monthly-planning/sync-ledger',
      JSON.stringify({
        binding: bindingFor(ID),
        dirty: { [SEPTEMBER]: 'yes', [AUGUST]: -3, [TASKS]: 2 },
      })
    );
    const ledger = await loadLedger();
    expect(ledger.dirty).toEqual({ [SEPTEMBER]: 1, [AUGUST]: 1, [TASKS]: 2 });
    expect(pendingCount(ledger)).toBe(3);
  });

  it('refuses a key that could name a document somewhere else', async () => {
    mockStored.set(
      '@monthly-planning/sync-ledger',
      JSON.stringify({
        binding: bindingFor(ID),
        digests: { '../../other/doc': digestOf('elsewhere'), [SEPTEMBER]: digestOf('september') },
        dirty: { 'months/2026-09': 1 },
        blocked: ['', '..'],
      })
    );
    const ledger = await loadLedger();
    expect(ledger.digests).toEqual({ [SEPTEMBER]: digestOf('september') });
    expect(ledger.dirty).toEqual({});
    expect(ledger.blocked).toEqual([]);
  });

  it('ignores a key like that on the way in as well', async () => {
    await resetFor(ID);
    await markDirty('months/2026-09');
    await recordBlocked('..');
    const ledger = await loadLedger();
    expect(ledger.dirty).toEqual({});
    expect(ledger.blocked).toEqual([]);
  });

  it('does not crash when storage itself fails', async () => {
    mockFailure.read = true;
    await expect(loadLedger()).resolves.toEqual(emptyLedger());
    await expect(loadLedgerFor(ID)).resolves.toEqual(emptyLedger(ID));
    await expect(markDirty(SEPTEMBER)).resolves.toBeUndefined();

    mockFailure.read = false;
    mockFailure.write = true;
    await expect(resetFor(ID)).resolves.toBeUndefined();
    await expect(recordPushed(SEPTEMBER, digestOf('september'), 0)).resolves.toBeUndefined();
    await expect(recordBlocked(AUGUST)).resolves.toBeUndefined();
    await expect(clearBlocked(AUGUST)).resolves.toBeUndefined();
    await expect(seedPushed(ID, {})).resolves.toBeUndefined();
  });

  it('carries on once storage comes back', async () => {
    mockFailure.write = true;
    await resetFor(ID);
    await markDirty(SEPTEMBER);
    mockFailure.write = false;
    await markDirty(SEPTEMBER);
    // the record that never landed is simply not there; the next one is
    expect(generationOf(await loadLedger(), SEPTEMBER)).toBe(1);
  });

  it('counts nothing waiting on a ledger someone handed it empty', () => {
    expect(pendingCount(emptyLedger())).toBe(0);
    expect(pendingCount({ ...emptyLedger(), blocked: [AUGUST] } as Ledger)).toBe(0);
  });
});

/**
 * A refusal that outlives the reason for it.
 *
 * Nothing clears `blocked` except a push that lands, and a run only starts when
 * something is waiting. So a refused document that stopped counting as waiting
 * takes the phone's whole backup down with it: no run, so no push, so no way
 * back out of `blocked`, forever. The way out has to be the edit — deleting half
 * of an oversized September is exactly how somebody fixes "too large", and it is
 * the only signal this phone will ever get that a retry is worth making.
 */
describe('a refusal that the user has since edited around', () => {
  it('is waiting again the moment the refused document changes', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);

    // a run picks September up, sends it, and the rules turn it down for size
    const generation = generationOf(await loadLedgerFor(ID), SEPTEMBER);
    await recordBlocked(SEPTEMBER, generation);
    expect(pendingCount(await loadLedger())).toBe(0);

    await markDirty(SEPTEMBER);

    const ledger = await loadLedger();
    expect(isPending(ledger, SEPTEMBER)).toBe(true);
    expect(pendingKeys(ledger)).toEqual([SEPTEMBER]);
    expect(pendingCount(ledger)).toBe(1);
    // and still refused as far as the last run knows, so Settings can name it
    expect(ledger.blocked).toEqual([SEPTEMBER]);
    // nothing here claims it reached the server
    expect(ledger.digests[SEPTEMBER]).toBeUndefined();
  });

  it('goes quiet again when the retry is refused as well', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);
    await recordBlocked(SEPTEMBER, generationOf(await loadLedger(), SEPTEMBER));
    await markDirty(SEPTEMBER);

    const retry = generationOf(await loadLedger(), SEPTEMBER);
    await recordBlocked(SEPTEMBER, retry);

    const ledger = await loadLedger();
    expect(pendingCount(ledger)).toBe(0);
    expect(ledger.dirty[SEPTEMBER]).toBe(retry);
    expect(ledger.blocked).toEqual([SEPTEMBER]);
  });

  it('does not swallow an edit made while the refused push was in flight', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);
    const generation = generationOf(await loadLedgerFor(ID), SEPTEMBER);

    // somebody trims the month while the too-large version is still on the wire
    await markDirty(SEPTEMBER);
    await recordBlocked(SEPTEMBER, generation);

    // the version that was refused is not the version on the phone, so the
    // phone still has something to say
    expect(pendingCount(await loadLedger())).toBe(1);
  });

  it('never claims to have been refused a version this phone does not have', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);
    // a generation from nowhere must not silence every edit up to it
    await recordBlocked(SEPTEMBER, 99);
    await markDirty(SEPTEMBER);
    expect(pendingCount(await loadLedger())).toBe(1);
  });

  it('retries a refusal recorded before generations were kept', async () => {
    mockStored.set(
      '@monthly-planning/sync-ledger',
      JSON.stringify({
        binding: bindingFor(ID),
        dirty: { [AUGUST]: 4 },
        blocked: [AUGUST],
      })
    );
    // an upload that gets refused again costs one request; a phone that never
    // tries again costs somebody their history
    expect(pendingCount(await loadLedger())).toBe(1);
  });
});

/**
 * What a restore is allowed to say about the months it did not bring down.
 *
 * Seeding is the one call that hands out digests for documents this phone never
 * sent, so it is the one call that can talk a backup out of an upload it needs
 * to make. A code that holds fewer months than the phone is the ordinary case —
 * an old backup, a second phone — and every month on this side of that gap is a
 * month that exists nowhere else.
 */
describe('a phone that has just restored, and still holds more than the backup', () => {
  it('keeps a local-only month waiting when the restore did not cover it', async () => {
    await resetFor(ID);
    await markDirty(JANUARY);
    await markDirty(FEBRUARY);

    await seedPushed(ID, { [SEPTEMBER]: digestOf('september') }, [
      JANUARY,
      FEBRUARY,
      SEPTEMBER,
    ]);

    const ledger = await loadLedger();
    expect(pendingKeys(ledger)).toEqual([JANUARY, FEBRUARY]);
    // and no digest was invented for either of them
    expect(ledger.digests).toEqual({ [SEPTEMBER]: digestOf('september') });
  });

  it('starts a local-only month waiting even under a code it has never seen', async () => {
    await resetFor(OTHER_ID);
    await recordPushed(JANUARY, digestOf('january'), 0);
    await recordPushed(FEBRUARY, digestOf('february'), 0);

    // a code typed in on this phone that turns out to hold one month
    await seedPushed(ID, { [SEPTEMBER]: digestOf('september') }, [
      JANUARY,
      FEBRUARY,
      SEPTEMBER,
    ]);

    const ledger = await loadLedger();
    expect(ledger.binding).toBe(bindingFor(ID));
    // the digests from the old code are gone, and the months they described are
    // waiting rather than orphaned
    expect(ledger.digests).toEqual({ [SEPTEMBER]: digestOf('september') });
    expect(pendingKeys(ledger)).toEqual([JANUARY, FEBRUARY]);
  });

  it('keeps a dirty flag the seed does not account for', async () => {
    await resetFor(ID);
    await markDirty(AUGUST);
    await seedPushed(ID, { [SEPTEMBER]: digestOf('september') });
    expect((await loadLedger()).dirty[AUGUST]).toBe(1);
  });

  it('keeps a dirty flag for a document it did bring down', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);
    await seedPushed(ID, { [SEPTEMBER]: digestOf('september') }, [SEPTEMBER]);
    // writing the downloaded month to disk is best-effort like every other
    // store, so the flag stays until a run has read the file and agreed
    expect((await loadLedger()).dirty[SEPTEMBER]).toBe(1);
  });

  it('does not invent a flag for a key that could name a document elsewhere', async () => {
    await seedPushed(ID, {}, ['months/2026-09', '..', '']);
    expect((await loadLedger()).dirty).toEqual({});
  });
});

/**
 * A flag nobody is ever going to act on.
 *
 * Opening the planner on a month writes it to disk empty, and the backup steps
 * over an empty month that has never been sent rather than filing a document
 * that says nothing. The flag that edit set has to come down with it, or the
 * card in Settings counts a month that no run will ever send — and a number
 * that never goes down is not a status, it is a nag.
 */
describe('a document the backup has decided not to send', () => {
  it('stops being counted, without being called sent', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);

    const generation = generationOf(await loadLedgerFor(ID), SEPTEMBER);
    await recordSkipped(SEPTEMBER, generation);

    const ledger = await loadLedger();
    expect(ledger.dirty[SEPTEMBER]).toBeUndefined();
    expect(pendingCount(ledger)).toBe(0);
    // nothing was sent, so nothing here says anything about the server
    expect(ledger.digests[SEPTEMBER]).toBeUndefined();
    expect(ledger.lastPushAt).toBeNull();
  });

  it('leaves an edit made while the run was deciding', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);
    const generation = generationOf(await loadLedgerFor(ID), SEPTEMBER);

    // the month was empty when the run read it, and has content by now
    await markDirty(SEPTEMBER);
    await recordSkipped(SEPTEMBER, generation);

    const ledger = await loadLedger();
    expect(ledger.dirty[SEPTEMBER]).toBe(generation + 1);
    expect(pendingCount(ledger)).toBe(1);
  });

  it('stops calling a document refused once there is nothing to send', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);
    await recordBlocked(SEPTEMBER, 1);
    await recordSkipped(SEPTEMBER, 1);

    const ledger = await loadLedger();
    expect(ledger.blocked).toEqual([]);
    expect(pendingCount(ledger)).toBe(0);
  });
});

/**
 * The id, at rest.
 *
 * The backup code lives in the Keychain as `WHEN_UNLOCKED_THIS_DEVICE_ONLY`
 * precisely so it never reaches an iCloud device backup. AsyncStorage does, and
 * the backup id is enough on its own to overwrite or delete every document in
 * somebody's backup. So the id is not what gets written down here — a one-way
 * fingerprint of it is, which is all the "does this ledger belong to this code"
 * check has ever needed.
 */
describe('the id it does not write down', () => {
  it('keeps the backup id out of storage entirely', async () => {
    await resetFor(ID);
    await markDirty(SEPTEMBER);
    await recordPushed(SEPTEMBER, digestOf('september'), 1);

    const stored = mockStored.get('@monthly-planning/sync-ledger') ?? '';
    expect(stored).not.toContain(ID);
    expect(stored).toContain(bindingFor(ID));
  });

  it('does not write it down when seeding either', async () => {
    await seedPushed(ID, { [SEPTEMBER]: digestOf('september') }, [SEPTEMBER]);
    expect(mockStored.get('@monthly-planning/sync-ledger') ?? '').not.toContain(ID);
  });

  it('cannot be turned back into the id it came from', () => {
    expect(bindingFor(ID)).toMatch(/^[0-9a-f]{64}$/);
    expect(bindingFor(ID)).not.toBe(ID);
    // and it is not the digest of the id either, which would let anything that
    // hashes plaintext recognise it
    expect(bindingFor(ID)).not.toBe(digestOf(ID));
  });

  it('still tells two codes apart', async () => {
    expect(bindingFor(ID)).not.toBe(bindingFor(OTHER_ID));

    await resetFor(ID);
    await recordPushed(SEPTEMBER, digestOf('september'), 0);
    expect((await loadLedgerFor(OTHER_ID)).digests).toEqual({});
  });

  it('reads a record written for this code as belonging to it', async () => {
    await resetFor(ID);
    await recordPushed(SEPTEMBER, digestOf('september'), 0);
    const ledger = await loadLedgerFor(ID);
    expect(ledger.binding).toBe(bindingFor(ID));
    expect(ledger.digests[SEPTEMBER]).toBe(digestOf('september'));
  });

  it('refuses a binding that could not have come from bindingFor', async () => {
    mockStored.set(
      '@monthly-planning/sync-ledger',
      JSON.stringify({ binding: ID.toUpperCase(), digests: { [SEPTEMBER]: digestOf('s') } })
    );
    // unreadable binding means unknown backup, and an unknown backup is one
    // whose digests describe a server this phone may never have talked to
    expect((await loadLedger()).binding).toBeNull();
    await expect(loadLedgerFor(ID)).resolves.toEqual(emptyLedger(ID));
  });
});
