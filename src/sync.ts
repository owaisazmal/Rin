import { getAuth, signInAnonymously } from '@react-native-firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
} from '@react-native-firebase/firestore';
import {
  ReactNativeFirebaseAppCheckProvider,
  getToken,
  initializeAppCheck,
} from '@react-native-firebase/app-check';
import {
  MAX_MONTH_CT,
  MAX_TASKS_CT,
  Sealed,
  ciphertextChars,
  deriveBackupId,
  deriveKey,
  open,
  seal,
} from './backup';
import { MonthData, cardHasContent } from './types';
import { Task, loadTasks, readTasksVouched, saveTasks, vouchTasksValue } from './tasks';
import {
  listStoredMonths,
  readMonthVouched,
  readStoredMonths,
  saveMonth,
  vouchMonthValue,
} from './storage';
import {
  Ledger,
  clearBlocked,
  clearUnvouched,
  digestOf,
  generationOf,
  loadLedger,
  loadLedgerFor,
  recordBlocked,
  recordPushed,
  recordSkipped,
  resetFor,
  seedPushed,
} from './syncLedger';
import { monthDocKey } from './hooks/useMonthData';
import { taskShardKey } from './hooks/useTasks';

// The app's only network code: ciphertext under an id derived from the code, nothing personal.

type Collection = 'months' | 'tasks';

// the ciphertext caps firestore.rules enforces per collection
const CAP: Record<Collection, number> = { months: MAX_MONTH_CT, tasks: MAX_TASKS_CT };

// open deadlines; a finished one is filed under the year it was finished in
const CURRENT = 'current';
const YEAR = /^20[0-9]{2}$/;
// the task document ids firestore.rules accepts
const TASK_SHARD = /^(current|20[0-9]{2})$/;
const MONTH_DOC = /^\d{4}-(0[1-9]|1[0-2])$/;

function backupDoc(id: string, name: Collection, key: string) {
  return doc(getFirestore(), 'backups', id, name, key);
}

function backupCollection(id: string, name: Collection) {
  return collection(getFirestore(), 'backups', id, name);
}

let appCheck: Promise<void> | null = null;

// Started by the first request, so a phone that never backs up never contacts Google.
function startAppCheck(): Promise<void> {
  appCheck ??= (async () => {
    try {
      const provider = new ReactNativeFirebaseAppCheckProvider();
      provider.configure({
        android: { provider: __DEV__ ? 'debug' : 'playIntegrity' },
        apple: { provider: __DEV__ ? 'debug' : 'appAttest' },
      });
      const instance = initializeAppCheck(undefined, { provider, isTokenAutoRefreshEnabled: true });
      // queued behind the provider setup, so no request can overtake it
      await getToken(instance);
    } catch {
      // an install that can't attest simply won't be able to back up
    }
  })();
  return appCheck;
}

// The anonymous uid only carries App Check and rate limits; nothing is filed under it.
async function ready(): Promise<void> {
  await startAppCheck();
  const auth = getAuth();
  if (!auth.currentUser) await signInAnonymously(auth);
}

export type RestoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'offline' | 'rejected' | 'unreadable' | 'missing' };

// Only codes meaning the request never arrived are offline; anything else is the server saying no.
function reasonFor(error: unknown): 'offline' | 'rejected' {
  const code = String((error as { code?: string })?.code ?? '');
  const offline =
    code.includes('network-request-failed') ||
    code.includes('unavailable') ||
    code.includes('deadline-exceeded') ||
    code.includes('timeout');
  return offline ? 'offline' : 'rejected';
}

type SendResult = 'sent' | 'offline' | 'rejected' | 'too-large';

// Size is checked first: over the cap the server answers with a bare permission denial.
async function send(
  code: string,
  name: Collection,
  key: string,
  plaintext: string
): Promise<SendResult> {
  if (ciphertextChars(plaintext) > CAP[name]) return 'too-large';
  try {
    await ready();
    await setDoc(backupDoc(deriveBackupId(code), name, key), {
      ...seal(deriveKey(code), plaintext),
      updatedAt: serverTimestamp(),
    });
    return 'sent';
  } catch (error) {
    return reasonFor(error);
  }
}

const SECTIONS = ['observations', 'grid', 'habits', 'keyGoals', 'cards'] as const;

// Which part of an oversized month is the bulk, so the refusal names something to trim.
function largestSection(data: MonthData): string {
  const size = (section: (typeof SECTIONS)[number]) => JSON.stringify(data[section])?.length ?? 0;
  return SECTIONS.reduce((largest, section) => (size(section) > size(largest) ? section : largest));
}

// Null when the document won't decrypt or isn't JSON, so neither can throw past the caller.
function openVouched<T>(key: Uint8Array, sealed: Sealed, vouch: (raw: unknown) => T): T | null {
  const plaintext = open(key, sealed);
  if (plaintext === null) return null;
  try {
    return vouch(JSON.parse(plaintext));
  } catch {
    return null;
  }
}

// Only a month that parses whole is handed back: a partial one must never overwrite the local copy.
export async function pullMonth(
  code: string,
  year: number,
  month: number
): Promise<RestoreResult<MonthData>> {
  try {
    await ready();
    const snapshot = await getDoc(
      backupDoc(deriveBackupId(code), 'months', monthDocKey(year, month))
    );
    if (!snapshot.exists()) return { ok: false, reason: 'missing' };
    const record = openVouched(deriveKey(code), snapshot.data() as Sealed, vouchMonthValue);
    if (record?.status !== 'complete') return { ok: false, reason: 'unreadable' };
    return { ok: true, value: record.data };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

// Like taskShardKey, but a task finished with no completion time is filed under its due year.
function shardKeyFor(task: Task): string {
  const key = taskShardKey(task);
  if (key !== CURRENT || !task.done || !Number.isFinite(task.due)) return key;
  const year = String(new Date(task.due).getFullYear());
  return YEAR.test(year) ? year : CURRENT;
}

// The phone keeps one flat list; only the wire is split, so a finished year is sent once.
function shardTasks(tasks: Task[]): Map<string, Task[]> {
  const shards = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = shardKeyFor(task);
    const group = shards.get(key);
    if (group) group.push(task);
    else shards.set(key, [task]);
  }
  return shards;
}

interface TaskArchive {
  // only the documents read whole; the rest are counted, never handed back
  shards: { key: string; tasks: Task[] }[];
  // documents that would not decrypt, were not JSON, or parsed to fewer deadlines than they hold
  incomplete: number;
}

// Every task document, `current` first then years ascending, counting any not read whole.
async function pullTaskShards(code: string): Promise<RestoreResult<TaskArchive>> {
  try {
    await ready();
    const listing = await getDocs(backupCollection(deriveBackupId(code), 'tasks'));
    if (listing.docs.length === 0) return { ok: false, reason: 'missing' };

    const key = deriveKey(code);
    const order = (id: string) => (id === CURRENT ? '' : id);
    const sorted = [...listing.docs].sort((a, b) => order(a.id).localeCompare(order(b.id)));
    const shards: TaskArchive['shards'] = [];
    let incomplete = 0;
    let readable = 0;
    for (const entry of sorted) {
      const record = openVouched(key, entry.data() as Sealed, vouchTasksValue);
      if (record && record.status !== 'unreadable') readable++;
      if (record?.status === 'complete') shards.push({ key: entry.id, tasks: record.data });
      else incomplete++;
    }
    if (readable === 0) return { ok: false, reason: 'unreadable' };
    return { ok: true, value: { shards, incomplete } };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

// Which months a backup holds, newest first, without decrypting any of them.
export async function listMonths(code: string): Promise<RestoreResult<string[]>> {
  try {
    await ready();
    const snapshot = await getDocs(backupCollection(deriveBackupId(code), 'months'));
    return { ok: true, value: snapshot.docs.map((entry) => entry.id).sort().reverse() };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

export interface BlockedDoc {
  // the document's name on the server: `2026-09`, `current`, `2024`
  key: string;
  // `unreadable` and `incomplete` are this phone's own copy failing to read whole; nothing was sent
  reason: 'rejected' | 'too-large' | 'unreadable' | 'incomplete';
  // the bulkiest part of an oversized month, or what a partial read lost: `2 of 12 habits`
  detail?: string;
}

// Every document a run considers lands in exactly one of pushed, unchanged, skipped or blocked.
export type BackupRun =
  | {
      ok: true;
      // months the backup holds once the run is over, not months this run sent
      months: number;
      pushed: number;
      unchanged: number;
      skipped: number;
      blocked: BlockedDoc[];
    }
  | { ok: false; reason: 'offline' };

function isEmptyMonth(data: MonthData): boolean {
  return (
    data.habits.length === 0 &&
    Object.keys(data.grid).length === 0 &&
    data.observations.every((line) => line.trim() === '') &&
    data.keyGoals.every((goal) => goal.text.trim() === '' && !goal.done) &&
    (data.cards ?? []).every((card) => !cardHasContent(card.items))
  );
}

// Task docs to name when the list can't be read: those on record, or `current` on a first backup.
function taskDocsOf(ledger: Ledger): string[] {
  const named = [...Object.keys(ledger.digests), ...Object.keys(ledger.dirty)];
  const keys = [...new Set(named.filter((key) => TASK_SHARD.test(key)))].sort();
  return keys.length > 0 ? keys : [CURRENT];
}

// One run at a time is the caller's job: backupRuns is the only way in.
export async function backupEverything(code: string): Promise<BackupRun> {
  let backupId: string;
  try {
    backupId = deriveBackupId(code);
  } catch {
    // not a code, so no request was ever made
    return { ok: false, reason: 'offline' };
  }

  // One snapshot for the whole run; generations are quoted back so mid-run edits stay dirty.
  const ledger = await loadLedgerFor(backupId);
  const blocked: BlockedDoc[] = [];
  let held = 0;
  let pushed = 0;
  let unchanged = 0;
  let skipped = 0;

  // null means the store would not answer, which must not settle any month flag below
  const listed = await readStoredMonths();
  const walked = new Set<string>();
  // newest first, so a run cut short leaves the months in use up to date
  for (const { year, month } of [...(listed ?? [])].reverse()) {
    const key = monthDocKey(year, month);
    walked.add(key);
    const recorded = ledger.digests[key];
    let generation = generationOf(ledger, key);

    if (generation === 0 && recorded) {
      // re-read the flag now: the month may have been edited since the snapshot
      generation = generationOf(await loadLedger(), key);
      if (generation === 0) {
        held++;
        unchanged++;
        continue;
      }
    }

    // Never loadMonth here: it answers a damaged or partial record with something sendable.
    const record = await readMonthVouched(year, month);

    if (record.status === 'unreadable' || record.status === 'partial') {
      // parked until the next edit; one bad month doesn't stop the rest
      await recordBlocked(key, generation);
      blocked.push(
        record.status === 'partial'
          ? { key, reason: 'incomplete', detail: record.lost }
          : { key, reason: 'unreadable' }
      );
      continue;
    }

    if (record.status === 'absent') {
      // deleted from the store mid-run: nothing to send
      if (generation > 0) await recordSkipped(key, generation);
      skipped++;
      continue;
    }

    const data = record.data;
    const plaintext = JSON.stringify(data);
    const digest = digestOf(plaintext);

    if (digest === recorded) {
      if (generation > 0) await recordPushed(key, digest, generation);
      held++;
      unchanged++;
      continue;
    }

    if (isEmptyMonth(data) && !recorded) {
      // opened but never written in, and never sent; no digest since no bytes moved
      if (generation > 0) await recordSkipped(key, generation);
      skipped++;
      continue;
    }

    // A sent month that is empty now does go: it was read whole and something marked it dirty.
    const sent = await send(code, 'months', key, plaintext);
    if (sent === 'sent') {
      await recordPushed(key, digest, generation);
      held++;
      pushed++;
      continue;
    }
    if (sent === 'offline') return { ok: false, reason: 'offline' };
    await recordBlocked(key, generation);
    blocked.push(
      sent === 'too-large'
        ? { key, reason: sent, detail: largestSection(data) }
        : { key, reason: sent }
    );
  }

  // a flagged month with nothing stored under it (a failed save) would otherwise wait forever
  if (listed !== null) {
    for (const key of Object.keys(ledger.dirty)) {
      if (!MONTH_DOC.test(key) || walked.has(key)) continue;
      await recordSkipped(key, generationOf(ledger, key));
      skipped++;
    }
  }

  // Read before any shard exists, so a list this phone can't vouch for is never sent or emptied.
  const list = await readTasksVouched();
  // absent after task docs were sent means the store lost the list, not that it was emptied
  const lostTheList =
    list.status === 'absent' && Object.keys(ledger.digests).some((key) => TASK_SHARD.test(key));

  if (list.status === 'partial' || list.status === 'unreadable' || lostTheList) {
    for (const key of taskDocsOf(ledger)) {
      await recordBlocked(key, generationOf(ledger, key));
      blocked.push(
        list.status === 'partial'
          ? { key, reason: 'incomplete', detail: list.lost }
          : { key, reason: 'unreadable' }
      );
    }
    return { ok: true, months: held, pushed, unchanged, skipped, blocked };
  }

  // `absent` here is a phone that has never saved a deadline
  const shards = shardTasks(list.status === 'complete' ? list.data : []);

  // a vanished year is emptied on the server only if something marked it dirty
  for (const key of Object.keys(ledger.digests)) {
    if (TASK_SHARD.test(key) && !shards.has(key) && generationOf(ledger, key) > 0) {
      shards.set(key, []);
    }
  }

  // dirty, nothing to send, and never on the server: retire the flag
  for (const key of Object.keys(ledger.dirty)) {
    if (TASK_SHARD.test(key) && !shards.has(key)) {
      await recordSkipped(key, generationOf(ledger, key));
    }
  }

  // a parked doc outside the shards has nothing left that could ever unpark it
  for (const key of ledger.blocked) {
    if (TASK_SHARD.test(key) && !shards.has(key)) await clearBlocked(key);
  }

  for (const [key, group] of shards) {
    const plaintext = JSON.stringify(group);
    const digest = digestOf(plaintext);
    const generation = generationOf(ledger, key);

    if (digest === ledger.digests[key]) {
      if (generation > 0) await recordPushed(key, digest, generation);
      // no push will land to unpark a doc the server already holds
      else if (ledger.blocked.includes(key)) await clearBlocked(key);
      unchanged++;
      continue;
    }

    const sent = await send(code, 'tasks', key, plaintext);
    if (sent === 'sent') {
      await recordPushed(key, digest, generation);
      pushed++;
      continue;
    }
    if (sent === 'offline') return { ok: false, reason: 'offline' };
    await recordBlocked(key, generation);
    blocked.push({ key, reason: sent });
  }

  return { ok: true, months: held, pushed, unchanged, skipped, blocked };
}

// `partial` and `unreadable` both leave the local list exactly as it was.
export type DeadlineRestore = 'restored' | 'none' | 'partial' | 'unreadable';

export type RestoreRun =
  | { ok: true; months: number; skipped: number; deadlines: DeadlineRestore }
  | { ok: false; reason: 'offline' | 'rejected' | 'missing' };

// Overwrites this phone with the backup, and seeds the ledger only with what actually arrived.
export async function restoreEverything(code: string): Promise<RestoreRun> {
  const listed = await listMonths(code);
  if (!listed.ok) return { ok: false, reason: listed.reason === 'rejected' ? 'rejected' : 'offline' };
  if (listed.value.length === 0) return { ok: false, reason: 'missing' };

  const seeds: Record<string, string> = {};
  let restored = 0;
  let skipped = 0;
  for (const key of listed.value) {
    const [year, month] = key.split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(month)) {
      skipped++;
      continue;
    }
    const pulled = await pullMonth(code, year, month - 1);
    if (pulled.ok) {
      await saveMonth(year, month - 1, pulled.value);
      seeds[key] = digestOf(JSON.stringify(pulled.value));
      restored++;
    } else if (pulled.reason === 'offline' || pulled.reason === 'rejected') {
      return { ok: false, reason: pulled.reason };
    } else {
      skipped++;
    }
  }

  // The save replaces the local list rather than merging, so only a whole archive is written.
  const archive = await pullTaskShards(code);
  let deadlines: DeadlineRestore;
  if (archive.ok && archive.value.incomplete > 0) {
    deadlines = 'partial';
  } else if (archive.ok) {
    const { shards } = archive.value;
    for (const shard of shards) seeds[shard.key] = digestOf(JSON.stringify(shard.tasks));
    await saveTasks(shards.flatMap((shard) => shard.tasks));
    deadlines = 'restored';
  } else if (archive.reason === 'missing') {
    await saveTasks([]);
    deadlines = 'none';
  } else if (archive.reason === 'unreadable') {
    deadlines = 'unreadable';
  } else {
    return { ok: false, reason: archive.reason };
  }

  try {
    // local docs no seed covers exist only on this phone, so the ledger marks them waiting
    const local = [
      ...(await listStoredMonths()).map((m) => monthDocKey(m.year, m.month)),
      ...shardTasks(await loadTasks()).keys(),
    ];
    await seedPushed(deriveBackupId(code), seeds, local);
    // everything that came down was written whole, so old damage notes no longer apply
    for (const key of Object.keys(seeds)) await clearUnvouched(key);
  } catch {
    // bookkeeping after the data landed; a lost seed costs one needless upload
  }

  return { ok: true, months: restored, skipped, deadlines };
}

// Pulls one month over a damaged local copy; the dirty flag stays so the next run checks it landed.
export async function restoreMonth(
  code: string,
  year: number,
  month: number
): Promise<RestoreResult<MonthData>> {
  const pulled = await pullMonth(code, year, month);
  if (!pulled.ok) return pulled;

  await saveMonth(year, month, pulled.value);

  const key = monthDocKey(year, month);
  try {
    const backupId = deriveBackupId(code);
    // merged rather than replaced: the other digests still describe this server
    const ledger = await loadLedgerFor(backupId);
    const digest = digestOf(JSON.stringify(pulled.value));
    await seedPushed(backupId, { ...ledger.digests, [key]: digest });
    await clearBlocked(key);
    await clearUnvouched(key);
  } catch {
    // bookkeeping after the month landed; a lost seed costs one needless upload
  }

  return pulled;
}

// Erases every document under this code's id. A partial delete is reported as unfinished.
export async function deleteBackup(
  code: string
): Promise<{ ok: true; deleted: number } | { ok: false; reason: 'offline' | 'rejected'; deleted: number }> {
  let deleted = 0;
  let id: string | null = null;
  try {
    await ready();
    id = deriveBackupId(code);
    for (const name of ['months', 'tasks'] as const) {
      const listing = await getDocs(backupCollection(id, name));
      for (const entry of listing.docs) {
        await deleteDoc(backupDoc(id, name, entry.id));
        deleted++;
      }
    }
    // the ledger described documents that are gone
    await resetFor(id);
    return { ok: true, deleted };
  } catch (error) {
    // a half-finished delete must not leave the ledger vouching for removed documents
    if (id !== null && deleted > 0) await resetFor(id).catch(() => {});
    return { ok: false, reason: reasonFor(error), deleted };
  }
}
