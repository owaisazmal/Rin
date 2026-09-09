import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/ciphers/utils.js';

/**
 * What the server already holds.
 *
 * Backing up writes one document per month, which was fine while it ran once on
 * a phone with three months on it. It is not fine now: `backupEverything`
 * re-seals and re-sends every stored month on every run, so ticking one cell in
 * September costs an upload of three years of history, on someone's data plan,
 * usually while they are doing something else. Nothing about this data justifies
 * that — a month that has not changed since it was sent is the document already
 * sitting on the server.
 *
 * So this file keeps a small local record of what was sent, and the backup
 * decides from it what it can skip. Two independent signals say a document needs
 * sending, and either one on its own is enough:
 *
 *   * a **digest** of the plaintext last put on the wire, which catches a change
 *     however it arrived — an edit, a restore, a migration, a hand-edited file;
 *   * a **dirty generation**, bumped by whoever saved the change, which catches
 *     a change made while a backup was already in flight.
 *
 * The digest is of the plaintext and never of the ciphertext. `seal` draws a
 * fresh nonce on every call, so the same month sealed twice is two unrelated
 * ciphertexts, and a digest of one would say "changed" every single time.
 *
 * The other half of the job is the count Settings reads, and it has a harder
 * standard to meet than the skipping does: it has to be true. A dirty flag that
 * no run will ever act on is a phone claiming a month is on its way when it is
 * not, so the two ways a flag can come down without bytes moving are both here,
 * and both are narrow. `recordSkipped` retires a flag the backup deliberately
 * decided not to send. `recordBlocked` parks one the server refused — and parks
 * it only until the next edit, because a refusal that outlived the version it
 * was about would leave the phone with nothing waiting, no run to start, and
 * therefore no way back.
 *
 * Best-effort like every other store here, and deliberately lopsided about how
 * it fails: the worst thing a lost or unreadable ledger can do is cause an
 * upload that wasn't needed. Every path through this file is written to fail in
 * that direction rather than the other one, where a document that changed is
 * mistaken for one already sent and quietly never leaves the phone.
 */

const LEDGER_KEY = '@monthly-planning/sync-ledger';

/**
 * How a stored ledger says which backup it describes.
 *
 * Not by holding the backup id. The id is half of what a backup code buys — it
 * is the whole address of somebody's history on the server, and anyone holding
 * it can overwrite or delete every document under it. The code itself lives in
 * the Keychain as `WHEN_UNLOCKED_THIS_DEVICE_ONLY` for exactly that reason:
 * that flag is what keeps it out of an iCloud or iTunes device backup. But
 * AsyncStorage is a plain file in the app container, and the container is in
 * that device backup, so an id written down here walks straight back out the
 * door the Keychain flag was chosen to close.
 *
 * The ledger never needs to *use* the id, only to answer one question: is this
 * record the one written for the code the phone is holding now? A one-way
 * fingerprint answers that and nothing else. Confidentiality of the months was
 * never at stake either way — the encryption key is a separate derivation from
 * the code and is never written anywhere — but being able to reach and erase
 * the backup was, and this closes it.
 *
 * The info string is a domain separator: it makes this hash unequal to the
 * digest of the same text anywhere else in the app, so a value from one of
 * these two worlds can never be mistaken for a value from the other.
 */
const BINDING_INFO = 'monthly-planning/sync-ledger/binding/v1\n';

/** The fingerprint a stored ledger carries in place of a backup id */
export function bindingFor(backupId: string): string {
  return bytesToHex(sha256(utf8ToBytes(BINDING_INFO + backupId)));
}

export interface Ledger {
  /**
   * `bindingFor` the backup id this ledger describes, null before this phone
   * has a code. Deliberately not the id: see `BINDING_INFO` above.
   */
  binding: string | null;
  /** doc key -> sha256 of the plaintext last sent under it */
  digests: Record<string, string>;
  /** doc key -> generation counter, bumped once per local change */
  dirty: Record<string, number>;
  /** doc keys the server refused, e.g. a month over the size cap in the rules */
  blocked: string[];
  /**
   * doc key -> the dirty generation the refusal in `blocked` was recorded at.
   *
   * This is what lets a refusal expire. A blocked document stops being counted
   * as waiting, and only the generation moving past this number brings it back
   * — which is to say, only somebody editing the document the server would not
   * take. That edit is the whole point: trimming an oversized month is how a
   * person fixes "too large", and without this the phone would never try again.
   */
  blockedAt: Record<string, number>;
  /** when bytes last actually landed on the server, epoch milliseconds */
  lastPushAt: number | null;
}

/**
 * A ledger that knows nothing, which is what every failure here returns.
 *
 * Takes the backup id rather than its fingerprint, because every caller has the
 * id and none of them should have to think about how the binding is made.
 */
export function emptyLedger(backupId: string | null = null): Ledger {
  return {
    binding: backupId === null ? null : bindingFor(backupId),
    digests: {},
    dirty: {},
    blocked: [],
    blockedAt: {},
    lastPushAt: null,
  };
}

// --- what a doc key may be --------------------------------------------------

/**
 * A doc key is the name of a document on the server — `2026-09` for a month,
 * `current` or a year shard like `2024` for tasks — so the check here is not
 * about which of those it is, which will grow, but about whether it could name
 * a document at all. A key holding a slash would address something in another
 * collection entirely; `.` and `..` are not legal Firestore ids; and a key
 * arriving from a hand-edited record has no business being unbounded.
 */
const MAX_KEY_LENGTH = 64;

function isDocKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  if (key === '.' || key === '..') return false;
  return /^[A-Za-z0-9._-]+$/.test(key);
}

// --- reading what is on disk ------------------------------------------------

/**
 * Only entries that look like something this file wrote. A digest that isn't 64
 * hex characters was never produced by `digestOf`, and dropping it costs one
 * upload — which is the safe direction, so there is no reason to keep it.
 */
function parseDigests(raw: unknown): Record<string, string> {
  const digests: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return digests;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isDocKey(key)) continue;
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) continue;
    digests[key] = value;
  }
  return digests;
}

/**
 * Dirty flags are read the other way round from digests: a generation that
 * isn't a usable counter becomes 1 rather than being dropped, because a flag
 * nobody can read is still a flag somebody set. Dropping it would mark a
 * changed document clean, which is the one outcome this file exists to prevent.
 */
function parseDirty(raw: unknown): Record<string, number> {
  const dirty: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return dirty;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isDocKey(key)) continue;
    dirty[key] = typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
  }
  return dirty;
}

function parseBlocked(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const blocked = raw.filter((key): key is string => typeof key === 'string' && isDocKey(key));
  return [...new Set(blocked)];
}

/**
 * Read the other way round from dirty flags, and for the mirror-image reason: a
 * generation that cannot be read leaves the refusal with no expiry date, and a
 * refusal that never expires is a document that never goes again. Dropping the
 * entry makes the key count as waiting, which costs one request the server will
 * probably refuse again — and the refusal that follows writes a generation this
 * file can read, so it costs it once.
 *
 * Entries for keys that are not blocked are dropped as well. They are not wrong,
 * only meaningless, and leaving them would let the record grow a stale generation
 * for every month that was ever refused and then sent.
 */
function parseBlockedAt(raw: unknown, blocked: readonly string[]): Record<string, number> {
  const blockedAt: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return blockedAt;
  const refused = new Set(blocked);
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!refused.has(key)) continue;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) continue;
    blockedAt[key] = value;
  }
  return blockedAt;
}

function parseLedger(raw: unknown): Ledger {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyLedger();
  const r = raw as Record<string, unknown>;
  const blocked = parseBlocked(r.blocked);
  return {
    // anything that is not the shape `bindingFor` produces was not written by
    // this file, and a record that cannot say which backup it belongs to is a
    // record whose digests might describe a server this phone never used
    binding: typeof r.binding === 'string' && /^[0-9a-f]{64}$/.test(r.binding) ? r.binding : null,
    digests: parseDigests(r.digests),
    dirty: parseDirty(r.dirty),
    blocked,
    blockedAt: parseBlockedAt(r.blockedAt, blocked),
    lastPushAt:
      typeof r.lastPushAt === 'number' && Number.isFinite(r.lastPushAt) ? r.lastPushAt : null,
  };
}

async function read(): Promise<Ledger> {
  try {
    const raw = await AsyncStorage.getItem(LEDGER_KEY);
    return raw ? parseLedger(JSON.parse(raw)) : emptyLedger();
  } catch {
    return emptyLedger();
  }
}

/**
 * Swallowed like the rest of the app's stores, and harmless here for the same
 * reason everything else is: a write that never landed leaves the previous
 * record in place, and the next backup re-sends whatever it can no longer
 * account for.
 */
async function write(ledger: Ledger): Promise<void> {
  try {
    await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // best-effort persistence, matching the rest of the app's stores
  }
}

// --- one writer at a time ---------------------------------------------------

/**
 * Every mutation is a read-modify-write of a single record, and the callers are
 * spread across the app: saving a month, saving the task list, and a backup
 * recording what it sent can all happen in the same tick. Left alone they would
 * each read the same record and the last one to finish would write the others
 * out of existence — a dirty flag silently dropped, which is exactly the bug
 * this file was written to close.
 *
 * So they queue. The chain is module-level because the record is: there is one
 * ledger on the phone, so there is one writer for it.
 */
let queue: Promise<void> = Promise.resolve();

function update(change: (ledger: Ledger) => Ledger): Promise<Ledger> {
  const next = queue.then(async () => {
    const before = await read();
    try {
      const after = change(before);
      await write(after);
      return after;
    } catch {
      // a change that throws is a bug rather than anything the user did; leave
      // the record as it was and let the next backup work it out from digests
      return before;
    }
  });
  queue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

// --- the ledger -------------------------------------------------------------

/** Whatever is stored, without asking which backup it belongs to */
export function loadLedger(): Promise<Ledger> {
  return read();
}

/**
 * The ledger for one backup id, and nothing from any other.
 *
 * This is the most dangerous line in the file. Tapping NEW CODE points the phone
 * at a fresh, empty server tree, and a digest map that survived that would say
 * every month is already up there: the next backup would skip all of them,
 * report success, and leave an empty backup behind a code someone has written
 * down and now trusts. So a mismatch is not merged, not partially kept, and not
 * merely hidden from the caller — the stored record is wiped and re-keyed here,
 * before anything else can read it back.
 *
 * The dirty flags go with it, which costs a few uploads that were possibly
 * unnecessary and loses nothing: with no digests, every document is unaccounted
 * for and gets sent anyway.
 */
export function loadLedgerFor(backupId: string): Promise<Ledger> {
  return update((ledger) =>
    ledger.binding === bindingFor(backupId) ? ledger : emptyLedger(backupId)
  );
}

/**
 * The generation a push must quote back, captured before it starts. Zero means
 * nobody has reported a change to this document since it was last settled.
 *
 * A number rather than merely something: a document called `toString` would
 * otherwise find a function waiting on `Object.prototype` and read as a
 * generation nobody set, which is a flag this file did not raise and cannot
 * clear.
 */
export function generationOf(ledger: Ledger, key: string): number {
  const generation = ledger.dirty[key];
  return typeof generation === 'number' ? generation : 0;
}

/** Somebody changed this document locally. Called on every save, backup or not. */
export async function markDirty(key: string): Promise<void> {
  await update((ledger) => {
    if (isDocKey(key)) ledger.dirty[key] = generationOf(ledger, key) + 1;
    return ledger;
  });
}

/**
 * Bytes for `key` landed on the server, and this is the digest of what was in
 * them.
 *
 * `generation` is what `generationOf` said when the run picked this document up,
 * and the flag is cleared only if it hasn't moved since. If it has, someone
 * edited the month while it was in the air: the copy on the server is the older
 * one, so it stays dirty and goes again next time. Clearing it here on the
 * grounds that a push succeeded would cover that edit with a digest for the
 * version that was sent, mark it clean forever, and lose the last thing anyone
 * wrote before backing up — the precise failure the generation counter is for.
 *
 * The digest is recorded either way, because it is a statement about the server
 * rather than about the phone: that ciphertext really is what is up there now.
 */
export async function recordPushed(
  key: string,
  digest: string,
  generation: number
): Promise<void> {
  await update((ledger) => {
    if (!isDocKey(key)) return ledger;
    ledger.digests[key] = digest;
    if (generationOf(ledger, key) === generation) delete ledger.dirty[key];
    // whatever the server refused before, it has just accepted
    ledger.blocked = ledger.blocked.filter((blocked) => blocked !== key);
    delete ledger.blockedAt[key];
    ledger.lastPushAt = Date.now();
    return ledger;
  });
}

/**
 * The server refused this document, and would refuse the same bytes again — a
 * month grown past the ciphertext cap in `firestore.rules`, say. It stays
 * dirty, since the phone still holds something the backup does not, but it
 * stops being counted as waiting: a number that never goes down is not a
 * status, it is a nag. Settings can say what is stuck by reading `blocked`.
 *
 * What stops being counted is *this version* of the document, which is why the
 * generation is recorded beside it. Nothing else in this file ever clears
 * `blocked` unless a push lands, and a push only happens inside a run, and a
 * run only starts when something is waiting — so a refusal that silenced a
 * document permanently would silence the whole backup with it, on a phone whose
 * owner is being told everything is fine. The way out is the edit: change the
 * month the server would not take and it is waiting again, which is precisely
 * the moment it is worth another request.
 *
 * `generation` is what the run quoted when it picked the document up. It is
 * optional only so that a caller with nothing to quote still records something
 * true — the version on the phone right now — rather than nothing at all.
 */
export async function recordBlocked(key: string, generation?: number): Promise<void> {
  await update((ledger) => {
    if (!isDocKey(key)) return ledger;
    if (!ledger.blocked.includes(key)) ledger.blocked.push(key);
    // never claim to have been refused a version newer than the one this phone
    // holds: that would silence edits that have not been offered to the server
    // yet, including any made while the refused bytes were still in the air
    const current = generationOf(ledger, key);
    ledger.blockedAt[key] = generation === undefined ? current : Math.min(generation, current);
    return ledger;
  });
}

/** Worth another try — the document shrank, or the rules changed under it */
export async function clearBlocked(key: string): Promise<void> {
  await update((ledger) => {
    ledger.blocked = ledger.blocked.filter((blocked) => blocked !== key);
    delete ledger.blockedAt[key];
    return ledger;
  });
}

/**
 * The run looked at this document and decided, deliberately, that there is
 * nothing to send — an empty month that has never been sent is the case this
 * exists for. No bytes went anywhere, so no digest is recorded and nothing here
 * says a word about the server; what comes down is only the flag saying the
 * phone is holding something the backup has not seen, because after this run it
 * is not.
 *
 * Guarded by the generation exactly like `recordPushed`, and for the same
 * reason: the month may have gone from empty to written while the run was
 * reading it, and a decision taken about the empty version must not retire the
 * flag the writing set.
 */
export async function recordSkipped(key: string, generation: number): Promise<void> {
  await update((ledger) => {
    if (!isDocKey(key)) return ledger;
    if (generationOf(ledger, key) !== generation) return ledger;
    delete ledger.dirty[key];
    // there is nothing waiting to be refused any more, so nothing is stuck
    ledger.blocked = ledger.blocked.filter((blocked) => blocked !== key);
    delete ledger.blockedAt[key];
    return ledger;
  });
}

/** Forgets everything and points at a different backup */
export async function resetFor(backupId: string): Promise<void> {
  await update(() => emptyLedger(backupId));
}

/**
 * What a restore leaves behind.
 *
 * `entries` is what actually came down, keyed by document name and digested as
 * this phone would now send it, so the first backup afterwards recognises those
 * documents as already up there instead of pushing the whole history straight
 * back. That is the only claim this call is allowed to make, and it is why the
 * digests replace the stored ones rather than joining them: a digest recorded
 * before the restore describes either another server or a document this restore
 * has just overwritten, and neither is something to skip an upload over.
 *
 * `localKeys` is the other half, and skipping it is how a restore loses months.
 * A code holding fewer documents than the phone is the ordinary case — an old
 * backup, a second phone, a code someone kept from last year — and every local
 * document the restore did not cover exists nowhere but this phone. Naming them
 * here leaves them waiting; leaving them out would leave them sitting on disk
 * with no digest, no flag, and nothing to trigger the run that would save them.
 *
 * Existing dirty flags survive, including for documents that did come down. A
 * restore writes each month to disk through the same best-effort store as
 * everything else, so "the server's copy is on this phone now" is a belief, not
 * a fact; the flag costs one local read on the next run, which reads the file,
 * finds it matches, and retires the flag without sending anything. If it does
 * not match, the flag is the only thing standing between the file and silence.
 *
 * `lastPushAt` is not touched. Nothing was pushed here — the bytes went the
 * other way — and the field means what it says.
 */
export async function seedPushed(
  backupId: string,
  entries: Record<string, string>,
  localKeys: readonly string[] = []
): Promise<void> {
  await update((ledger) => {
    const binding = bindingFor(backupId);
    // a record written under another code describes another server, so nothing
    // in it is true here: the same wipe `loadLedgerFor` does, for the same reason
    const before = ledger.binding === binding ? ledger : emptyLedger(backupId);
    const digests = parseDigests(entries);
    for (const key of localKeys) {
      if (!isDocKey(key)) continue;
      if (typeof digests[key] === 'string') continue;
      // unaccounted for by anything that came down, so it is this phone's alone
      before.dirty[key] = generationOf(before, key) || 1;
    }
    return { ...before, binding, digests };
  });
}

/**
 * Is this document waiting to go?
 *
 * Two things have to be true. Something changed it locally — that is the dirty
 * flag — and there is a point in trying, which is where a refusal comes in: a
 * document the server turned down is not waiting, it is stuck, right up until
 * somebody edits it. From that edit on it is waiting again, because the bytes
 * that were refused are no longer the bytes on the phone.
 *
 * A refusal with no generation beside it is treated as expired rather than
 * eternal. That is the direction that costs a request, and the other direction
 * costs a backup.
 */
export function isPending(ledger: Ledger, key: string): boolean {
  const generation = generationOf(ledger, key);
  if (generation === 0) return false;
  if (!ledger.blocked.includes(key)) return true;
  const refusedAt = ledger.blockedAt[key];
  return typeof refusedAt !== 'number' || generation > refusedAt;
}

/** Everything waiting to go, sorted so the same ledger always reads the same */
export function pendingKeys(ledger: Ledger): string[] {
  return Object.keys(ledger.dirty)
    .filter((key) => isPending(ledger, key))
    .sort();
}

/** How many documents are waiting to go, for the line in Settings */
export function pendingCount(ledger: Ledger): number {
  return pendingKeys(ledger).length;
}

/** The sha256 of some plaintext, hex. Never call this on a sealed record. */
export function digestOf(plaintext: string): string {
  return bytesToHex(sha256(utf8ToBytes(plaintext)));
}
