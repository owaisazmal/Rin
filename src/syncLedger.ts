import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/ciphers/utils.js';

// What the server holds and what changed since. Every failure errs toward an extra upload.

const LEDGER_KEY = '@monthly-planning/sync-ledger';

// a fingerprint, never the id: the id can overwrite a backup, and this file is in device backups
const BINDING_INFO = 'monthly-planning/sync-ledger/binding/v1\n';

const HEX64 = /^[0-9a-f]{64}$/;
const DOC_KEY = /^[A-Za-z0-9._-]{1,64}$/;
// the voucher's phrases stay under 60 characters; a longer one is dropped rather than truncated
const MAX_LOST_LENGTH = 120;

export interface Ledger {
  // fingerprint of the backup id this ledger describes, null before this phone has a code
  binding: string | null;
  // doc key -> sha256 of the plaintext last sent (not the ciphertext: every seal has a fresh nonce)
  digests: Record<string, string>;
  // doc key -> generation counter, bumped once per local change
  dirty: Record<string, number>;
  // doc keys the server refused, e.g. a month over the size cap in the rules
  blocked: string[];
  // doc key -> generation the refusal was recorded at; an edit past it makes the doc pending again
  blockedAt: Record<string, number>;
  // doc key -> what this phone could not read of its own copy; '' means nothing could be named
  unvouched: Record<string, string>;
  // when bytes last actually landed on the server, epoch milliseconds
  lastPushAt: number | null;
}

function bindingFor(backupId: string): string {
  return digestOf(BINDING_INFO + backupId);
}

export function emptyLedger(backupId: string | null = null): Ledger {
  return {
    binding: backupId === null ? null : bindingFor(backupId),
    digests: {},
    dirty: {},
    blocked: [],
    blockedAt: {},
    unvouched: {},
    lastPushAt: null,
  };
}

// must be able to name a Firestore document: no slashes, no `.` or `..`, bounded length
function isDocKey(key: string): boolean {
  return DOC_KEY.test(key) && key !== '.' && key !== '..';
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw);
}

function entriesOf(raw: unknown): [string, unknown][] {
  return isRecord(raw) ? Object.entries(raw) : [];
}

// a digest digestOf could not have produced is dropped, which only costs an upload
function parseDigests(raw: unknown): Record<string, string> {
  const digests: Record<string, string> = {};
  for (const [key, value] of entriesOf(raw)) {
    if (isDocKey(key) && typeof value === 'string' && HEX64.test(value)) digests[key] = value;
  }
  return digests;
}

// an unreadable generation becomes 1: a flag somebody set must never read as clean
function parseDirty(raw: unknown): Record<string, number> {
  const dirty: Record<string, number> = {};
  for (const [key, value] of entriesOf(raw)) {
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

// an unreadable generation is dropped, so the refusal expires instead of lasting forever
function parseBlockedAt(raw: unknown, blocked: readonly string[]): Record<string, number> {
  const blockedAt: Record<string, number> = {};
  for (const [key, value] of entriesOf(raw)) {
    if (!blocked.includes(key)) continue;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) continue;
    blockedAt[key] = value;
  }
  return blockedAt;
}

// an unusable phrase keeps its key: the damage is still real even if its description is not
function parseUnvouched(raw: unknown): Record<string, string> {
  const unvouched: Record<string, string> = {};
  for (const [key, value] of entriesOf(raw)) {
    if (!isDocKey(key)) continue;
    unvouched[key] = typeof value === 'string' && value.length <= MAX_LOST_LENGTH ? value : '';
  }
  return unvouched;
}

function parseLedger(raw: unknown): Ledger {
  if (!isRecord(raw)) return emptyLedger();
  const blocked = parseBlocked(raw.blocked);
  return {
    binding: typeof raw.binding === 'string' && HEX64.test(raw.binding) ? raw.binding : null,
    digests: parseDigests(raw.digests),
    dirty: parseDirty(raw.dirty),
    blocked,
    blockedAt: parseBlockedAt(raw.blockedAt, blocked),
    unvouched: parseUnvouched(raw.unvouched),
    lastPushAt:
      typeof raw.lastPushAt === 'number' && Number.isFinite(raw.lastPushAt) ? raw.lastPushAt : null,
  };
}

// Whatever is stored, without asking which backup it belongs to.
export async function loadLedger(): Promise<Ledger> {
  try {
    const raw = await AsyncStorage.getItem(LEDGER_KEY);
    return raw ? parseLedger(JSON.parse(raw)) : emptyLedger();
  } catch {
    return emptyLedger();
  }
}

async function write(ledger: Ledger): Promise<void> {
  try {
    await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // best-effort; the next backup re-sends whatever it can no longer account for
  }
}

// One read-modify-write at a time, or concurrent saves would drop each other's dirty flags.
let queue: Promise<void> = Promise.resolve();

// returned by a change with nothing to do, so the record is not rewritten identical
const UNCHANGED = Symbol('nothing to write');

function update(change: (ledger: Ledger) => Ledger | typeof UNCHANGED): Promise<Ledger> {
  const next = queue.then(async () => {
    const before = await loadLedger();
    try {
      const after = change(before);
      if (after === UNCHANGED) return before;
      await write(after);
      return after;
    } catch {
      // a change that throws is a bug; leave the record as it was
      return before;
    }
  });
  queue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function unblock(ledger: Ledger, key: string): void {
  ledger.blocked = ledger.blocked.filter((blocked) => blocked !== key);
  delete ledger.blockedAt[key];
}

// A record for another code is wiped, or its digests would skip uploads to an empty tree.
export function loadLedgerFor(backupId: string): Promise<Ledger> {
  return update((ledger) =>
    ledger.binding === bindingFor(backupId) ? UNCHANGED : emptyLedger(backupId)
  );
}

// Zero means no change reported since the doc was last settled. A key like `toString` must read 0.
export function generationOf(ledger: Ledger, key: string): number {
  const generation = ledger.dirty[key];
  return typeof generation === 'number' ? generation : 0;
}

export async function markDirty(key: string): Promise<void> {
  await update((ledger) => {
    if (isDocKey(key)) ledger.dirty[key] = generationOf(ledger, key) + 1;
    return ledger;
  });
}

// The flag clears only if the generation hasn't moved since the run picked the doc up.
export async function recordPushed(
  key: string,
  digest: string,
  generation: number
): Promise<void> {
  await update((ledger) => {
    if (!isDocKey(key)) return ledger;
    ledger.digests[key] = digest;
    if (generationOf(ledger, key) === generation) delete ledger.dirty[key];
    unblock(ledger, key);
    ledger.lastPushAt = Date.now();
    return ledger;
  });
}

// Parks a refused doc until its next edit, so it stops counting as waiting without being lost.
export async function recordBlocked(key: string, generation?: number): Promise<void> {
  await update((ledger) => {
    if (!isDocKey(key)) return ledger;
    if (!ledger.blocked.includes(key)) ledger.blocked.push(key);
    // never claim a refusal of a version newer than the one this phone holds
    const current = generationOf(ledger, key);
    ledger.blockedAt[key] = generation === undefined ? current : Math.min(generation, current);
    return ledger;
  });
}

export async function clearBlocked(key: string): Promise<void> {
  await update((ledger) => {
    unblock(ledger, key);
    return ledger;
  });
}

// '' is a damaged doc with nothing to name; null is a doc nobody has complained about.
export function unvouchedNote(ledger: Ledger, key: string): string | null {
  const note = ledger.unvouched[key];
  return typeof note === 'string' ? note : null;
}

export function unvouchedKeys(ledger: Ledger): string[] {
  return Object.keys(ledger.unvouched)
    .filter((key) => unvouchedNote(ledger, key) !== null)
    .sort();
}

// Deliberately neither dirty nor blocked: a doc this phone can't read whole is never sent.
export async function recordUnvouched(key: string, lost: string): Promise<void> {
  await update((ledger) => {
    if (!isDocKey(key)) return UNCHANGED;
    const named = lost.length <= MAX_LOST_LENGTH ? lost : '';
    if (unvouchedNote(ledger, key) === named) return UNCHANGED;
    ledger.unvouched[key] = named;
    return ledger;
  });
}

export async function clearUnvouched(key: string): Promise<void> {
  await update((ledger) => {
    if (unvouchedNote(ledger, key) === null) return UNCHANGED;
    delete ledger.unvouched[key];
    return ledger;
  });
}

// Retires a flag the run decided not to send; no digest, since no bytes moved.
export async function recordSkipped(key: string, generation: number): Promise<void> {
  await update((ledger) => {
    if (!isDocKey(key)) return ledger;
    if (generationOf(ledger, key) !== generation) return ledger;
    delete ledger.dirty[key];
    unblock(ledger, key);
    return ledger;
  });
}

export async function resetFor(backupId: string): Promise<void> {
  await update(() => emptyLedger(backupId));
}

// Digests become exactly what came down; local docs it missed wait, and dirty flags survive.
export async function seedPushed(
  backupId: string,
  entries: Record<string, string>,
  localKeys: readonly string[] = []
): Promise<void> {
  await update((ledger) => {
    const binding = bindingFor(backupId);
    const before = ledger.binding === binding ? ledger : emptyLedger(backupId);
    const digests = parseDigests(entries);
    for (const key of localKeys) {
      if (isDocKey(key) && typeof digests[key] !== 'string') {
        before.dirty[key] = generationOf(before, key) || 1;
      }
    }
    return { ...before, binding, digests };
  });
}

// Dirty and not parked; a refusal with no generation counts as expired.
function isPending(ledger: Ledger, key: string): boolean {
  const generation = generationOf(ledger, key);
  if (generation === 0) return false;
  if (!ledger.blocked.includes(key)) return true;
  const refusedAt = ledger.blockedAt[key];
  return typeof refusedAt !== 'number' || generation > refusedAt;
}

export function pendingKeys(ledger: Ledger): string[] {
  return Object.keys(ledger.dirty)
    .filter((key) => isPending(ledger, key))
    .sort();
}

export function pendingCount(ledger: Ledger): number {
  return pendingKeys(ledger).length;
}

// The sha256 of some plaintext, hex. Never call this on a sealed record.
export function digestOf(plaintext: string): string {
  return bytesToHex(sha256(utf8ToBytes(plaintext)));
}
