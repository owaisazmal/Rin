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
import { MonthData } from './types';
import { Task, loadTasks, readTasksVouched, saveTasks, vouchTasksValue } from './tasks';
import type { VouchedValue } from './tasks';
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

/**
 * Carrying a backup to another phone, and nothing else.
 *
 * This is the only code in the app that touches a network. What it sends is
 * ciphertext and an opaque id; what it never sends is a name, an email, an
 * address book, an identifier that outlives an install, or anything about how
 * the app is used. There is no telemetry here and no room for any: every
 * function takes a backup code and does exactly one thing with it.
 *
 * The anonymous sign-in below is not an account. It creates a throwaway uid
 * that exists so requests carry an App Check token — proof they came from a
 * real install of this app rather than a script — and so Firebase applies its
 * own rate limits. Nothing is filed under that uid, and signing in again on a
 * new phone produces a different one. What identifies a backup is the code,
 * which never leaves the device.
 *
 * A whole-phone backup used to be a loop that re-sealed and re-sent every
 * stored month, and stopped dead at the first thing that went wrong. Three
 * things changed, and they are what most of this file now is:
 *
 *   * **It sends what changed.** `syncLedger.ts` remembers the digest of the
 *     plaintext last put on the wire under each document name, so a month
 *     nobody has touched is recognised before it is even read off the disk.
 *     Three years of history that nobody edited this morning costs no writes.
 *
 *   * **The deadline archive is split by year.** Open deadlines travel in
 *     `tasks/current`; a finished one is filed under the year it was finished
 *     in. A past year is written once and then never again, where one document
 *     for every deadline ever ticked off grew without limit and was re-sent
 *     every time somebody wrote down something new.
 *
 *   * **Nothing this phone cannot vouch for is ever sent.** Both local stores
 *     answer a read they could not make with an empty value — `loadMonth` gives
 *     back an empty month, `loadTasks` an empty list — and both answer a record
 *     they could only half read with the half that survived, because every
 *     other caller wants a screen to draw rather than an exception. This one
 *     does not. Sealing that emptiness and putting it on the wire is how a
 *     backup comes to say somebody deleted a year of their own history; sealing
 *     the survivors is the same thing said more quietly, because a month that
 *     parsed to *less* than it holds is not empty and slips past every check
 *     for emptiness there has ever been here, straight over the complete copy
 *     on the server.
 *
 *     So nothing on this path is read through those loaders at all.
 *     `readMonthVouched` and `readTasksVouched` are the only way in, and they
 *     say whether the bytes on disk parsed with nothing dropped. Absence means
 *     empty and is taken at its word only where nothing on record contradicts
 *     it; partial never is at all. A document this phone cannot
 *     vouch for as whole is named rather than sent, and an empty document — the
 *     one thing that carries a deletion — is only ever written for a record
 *     this phone can prove it read in full.
 *
 *   * **One bad document no longer takes the rest with it.** Sizes are checked
 *     against the caps in `firestore.rules` before anything is sealed, so an
 *     oversized month is named rather than sent and refused; and a document the
 *     server turns down is recorded and stepped over instead of ending the run.
 *     Losing the connection still stops everything, because the next thirty
 *     requests down a dead line would fail the same way.
 *
 * Every call is best-effort and returns a result rather than throwing: a
 * backup that fails should say so on the screen that asked for it, never
 * interrupt someone's morning.
 */

/** Months are filed by calendar month, which is what the rules will accept */
function monthDoc(id: string, year: number, month: number) {
  return doc(getFirestore(), 'backups', id, 'months', monthDocKey(year, month));
}

type DocRef = ReturnType<typeof monthDoc>;

/** Where the open deadlines live; a finished one goes to its year instead */
const CURRENT = 'current';

/** The task document ids the rules accept: `current`, or a year in this century */
const YEAR = /^20[0-9]{2}$/;
const TASK_SHARD = /^(current|20[0-9]{2})$/;

/**
 * A month document's name, as `monthDocKey` writes it.
 *
 * Only the ledger's own keys are ever tested against this, and it is there to
 * tell a flag naming a month from a flag naming a task shard — on a record that
 * has been on disk across upgrades and could have been edited by hand, so the
 * two sets are separated by what a key looks like rather than by what wrote it.
 */
const MONTH_DOC = /^\d{4}-(0[1-9]|1[0-2])$/;

function tasksDoc(id: string, key: string) {
  return doc(getFirestore(), 'backups', id, 'tasks', key);
}

/** Signs in anonymously if this install hasn't already. Idempotent. */
async function ready(): Promise<void> {
  const instance = getAuth();
  if (!instance.currentUser) await signInAnonymously(instance);
}

/**
 * Turns on App Check, which is what stops the backend being a free key-value
 * store for anyone who read this repo. Called once at startup; failing to
 * activate should not take the app down, since everything except backup works
 * without a network.
 */
export function startAppCheck(): void {
  try {
    const provider = new ReactNativeFirebaseAppCheckProvider();
    provider.configure({
      android: { provider: __DEV__ ? 'debug' : 'playIntegrity' },
      apple: { provider: __DEV__ ? 'debug' : 'appAttest' },
    });
    initializeAppCheck(undefined, { provider, isTokenAutoRefreshEnabled: true });
  } catch {
    // an install that can't attest simply won't be able to back up
  }
}

/**
 * What a caller gets back: it worked, or it didn't and here is roughly why.
 *
 * `too-large` is the one refusal that never reaches the server. It is here
 * rather than folded into `rejected` because it is the only one somebody can
 * actually do something about, and `detail` says what to do it to.
 */
export type SyncResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'offline' | 'rejected' | 'unreadable' | 'too-large';
      detail?: string;
    };

export type RestoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'offline' | 'rejected' | 'unreadable' | 'missing' };

/**
 * Firebase's error codes, reduced to the two things a screen can say.
 *
 * The default is deliberately "rejected" rather than "offline": an error that
 * carries a Firebase code is one the server answered, so blaming the network
 * would send someone to check their wifi over a refusal that will still be
 * there afterwards. Only the codes that genuinely mean the request never
 * arrived are treated as offline.
 *
 * Both halves matter here. Sign-in runs before any read or write, so an auth
 * code — the anonymous provider switched off, App Check refusing the app — is
 * the first thing that can fail, and `firestore/` codes never appear for it.
 */
function reasonFor(error: unknown): 'offline' | 'rejected' {
  const code = String((error as { code?: string })?.code ?? '');
  const offline =
    code.includes('network-request-failed') ||
    code.includes('unavailable') ||
    code.includes('deadline-exceeded') ||
    code.includes('timeout');
  return offline ? 'offline' : 'rejected';
}

/**
 * Seals one plaintext and writes it. The plaintext never leaves this function,
 * and neither does the key: both callers hand over a string and a place to put
 * it, and get back a result rather than an exception.
 */
async function pushDoc(
  code: string,
  reference: (id: string) => DocRef,
  plaintext: string
): Promise<SyncResult> {
  try {
    await ready();
    const sealed = seal(deriveKey(code), plaintext);
    await setDoc(reference(deriveBackupId(code)), {
      ...sealed,
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

/**
 * Which part of a month is the reason it will not fit.
 *
 * A refusal that says "this month is too big" is a symptom; the thing somebody
 * can act on is that it is the notes, or the grid. Four `JSON.stringify` calls
 * on an object already in memory is a rounding error next to the encryption
 * that is about to be skipped, and it is only reached when a month has already
 * failed the size check, so it costs nothing on the path everybody takes.
 */
function largestSection(data: MonthData): string {
  const sections: [string, unknown][] = [
    ['observations', data.observations],
    ['grid', data.grid],
    ['habits', data.habits],
    ['keyGoals', data.keyGoals],
  ];
  let name = sections[0][0];
  let largest = -1;
  for (const [section, value] of sections) {
    const size = JSON.stringify(value)?.length ?? 0;
    if (size > largest) {
      largest = size;
      name = section;
    }
  }
  return name;
}

/**
 * One month, already stringified by whoever needed its digest.
 *
 * The size is measured before anything is sealed, because a record one
 * character over the cap in `firestore.rules` comes back as a plain permission
 * denial — indistinguishable from being offline, unauthenticated or blocked by
 * App Check. Checking here means the app can say which month, and which part of
 * it, instead of guessing at the whole run.
 */
async function sendMonth(
  code: string,
  year: number,
  month: number,
  data: MonthData,
  plaintext: string
): Promise<SyncResult> {
  if (ciphertextChars(plaintext) > MAX_MONTH_CT) {
    return { ok: false, reason: 'too-large', detail: largestSection(data) };
  }
  return pushDoc(code, (id) => monthDoc(id, year, month), plaintext);
}

/** One task document — `current` or a year — with the same preflight */
async function sendTaskShard(
  code: string,
  key: string,
  plaintext: string
): Promise<SyncResult> {
  if (ciphertextChars(plaintext) > MAX_TASKS_CT) return { ok: false, reason: 'too-large' };
  return pushDoc(code, (id) => tasksDoc(id, key), plaintext);
}

/** Writes one month, encrypted. The plaintext never leaves this function. */
export async function pushMonth(
  code: string,
  year: number,
  month: number,
  data: MonthData
): Promise<SyncResult> {
  return sendMonth(code, year, month, data, JSON.stringify(data));
}

/**
 * Reads one month back.
 *
 * What comes off the wire is decrypted and then vouched by the same function
 * that guards AsyncStorage, which is the whole of the difference between this
 * and the version that used to parse and hand over whatever survived.
 *
 * That version was the outbound bug read backwards, and the copy it destroyed
 * was the one on this phone. `parseMonthData` is deliberately lossy — a month
 * whose habit list is half garbage comes back as the habits that survived — so
 * a document that decrypts but only half parses, because a newer build wrote
 * it or the server holds a corrupted write or the transfer was truncated, came
 * back looking like an ordinary month and went straight to `restoreEverything`,
 * which wrote it to disk over whatever was there. A month with two of its
 * habits missing overwriting the complete one is the same silent deletion as
 * sealing the survivors and sending them, in the other direction.
 *
 * So: `complete` is the only answer that is handed back. `partial` and
 * `unreadable` come back as `unreadable`, which is what they both are from
 * here — a document this phone cannot say it read whole, and therefore one it
 * must not write over anything. The caller counts it exactly as it counts a
 * month that would not decrypt, because the consequence of writing it is the
 * same and the local copy is left standing either way.
 */
export async function pullMonth(
  code: string,
  year: number,
  month: number
): Promise<RestoreResult<MonthData>> {
  try {
    await ready();
    const snapshot = await getDoc(monthDoc(deriveBackupId(code), year, month));
    if (!snapshot.exists()) return { ok: false, reason: 'missing' };
    const plaintext = open(deriveKey(code), snapshot.data() as Sealed);
    if (plaintext === null) return { ok: false, reason: 'unreadable' };
    const record = vouchMonthValue(JSON.parse(plaintext));
    if (record.status !== 'complete') return { ok: false, reason: 'unreadable' };
    return { ok: true, value: record.data };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

// --- the deadline archive ---------------------------------------------------

/**
 * Which document a deadline travels in.
 *
 * `taskShardKey` is the app's answer and this defers to it, so a dirty flag set
 * by the deadline screen names the document this file will actually write. It
 * goes one step further in one case the hook deliberately leaves alone: a task
 * ticked off before completion times were recorded, which `tasks.ts` describes
 * as "finished, time unknown". The hook keeps those in the open list because it
 * has no year for them; here there is nowhere else for them to accumulate, so
 * the day they were *due* stands in for the day they were finished. It is a
 * guess, but a bounded one — those tasks are a fixed set left over from an
 * older version, they are finished either way, and the alternative is an open
 * list that carries them forever.
 *
 * A year outside `20xx` falls back to `current` whichever route it took, since
 * the rules would refuse the document and the task would be lost.
 */
function shardKeyFor(task: Task): string {
  const key = taskShardKey(task);
  if (key !== CURRENT || !task.done || !Number.isFinite(task.due)) return key;
  const year = String(new Date(task.due).getFullYear());
  return YEAR.test(year) ? year : CURRENT;
}

/** The one flat list on the phone, split the way it travels */
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

/**
 * Writes the whole deadline list, one document per shard.
 *
 * Local storage is untouched by any of this: the phone keeps one flat list at
 * one key, exactly as it always has. Only the wire is sharded, and only because
 * a year that is over never needs sending again.
 */
export async function pushTasks(code: string, tasks: Task[]): Promise<SyncResult> {
  for (const [key, group] of shardTasks(tasks)) {
    const result = await sendTaskShard(code, key, JSON.stringify(group));
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** One task document as it came back: which shard it was, and what was in it */
interface TaskShard {
  key: string;
  tasks: Task[];
}

/**
 * Every task document the backup holds, and how much of it arrived.
 *
 * The count is the whole reason this is a record rather than a bare array. A
 * shard that will not open is stepped over below, which is right for reading
 * and catastrophic for writing: `restoreEverything` replaces the phone's one
 * flat list with whatever came down, so "three documents, two opened" and
 * "two documents, both opened" produce the same array and one of them is
 * missing a year of somebody's deadlines. Nothing could tell them apart, so
 * nothing did.
 */
interface TaskArchive {
  shards: TaskShard[];
  /**
   * Documents that were listed and did not come back whole: they would not
   * decrypt, they were not JSON, or they parsed to fewer deadlines than they
   * hold.
   *
   * The third of those is here because leaving it out was the same bug as the
   * first two wearing better clothes. A shard that decrypts to a perfectly good
   * array from which `parseTasks` silently drops rows — a newer build's fields,
   * a hand-edited document — used not to be counted at all, so a restore
   * replaced the phone's one flat list with fewer deadlines than the backup
   * holds and reported a clean success over the top of it.
   */
  incomplete: number;
}

/**
 * Every task document this backup holds, decrypted.
 *
 * The rules allow listing this collection precisely so a restore can find out
 * which years exist rather than probing ids one at a time or guessing a range.
 * A shard that will not decrypt is stepped over rather than ending the read —
 * one unreadable year costs that year, not the deadline list — but it is
 * counted on the way past, because a caller that overwrites the local list
 * needs to know it was handed less than the backup holds.
 *
 * A shard that opens and only half parses is counted the same way, and is the
 * quieter half of the same fault: nothing about it looks like a failure, since
 * what comes back is a well-formed array of deadlines. It is simply a shorter
 * one than the document holds. Its surviving rows still go into `shards`,
 * because this is the lossy view and `pullTasks` below is right to show
 * somebody most of their archive — the count is what stops a *write* being
 * decided from it.
 *
 * Order is fixed here — the open list, then the archive oldest first — so the
 * same backup always reassembles into the same list. Nothing downstream depends
 * on it, since every screen sorts deadlines by their due date, but a stable
 * answer is worth more than an arbitrary one.
 */
async function pullTaskShards(code: string): Promise<RestoreResult<TaskArchive>> {
  try {
    await ready();
    const listing = await getDocs(
      collection(getFirestore(), 'backups', deriveBackupId(code), 'tasks')
    );
    if (listing.docs.length === 0) return { ok: false, reason: 'missing' };

    const key = deriveKey(code);
    const order = (id: string) => (id === CURRENT ? '' : id);
    const shards: TaskShard[] = [];
    let incomplete = 0;
    for (const entry of [...listing.docs].sort((a, b) =>
      order(a.id).localeCompare(order(b.id))
    )) {
      const plaintext = open(key, entry.data() as Sealed);
      if (plaintext === null) {
        incomplete++;
        continue;
      }
      let record: VouchedValue<Task[]>;
      try {
        record = vouchTasksValue(JSON.parse(plaintext));
      } catch {
        // decrypted, but not JSON — the same dead end as a failed decryption
        incomplete++;
        continue;
      }
      // `unreadable` is a document that is not a deadline list at all, so there
      // is nothing to add; `partial` has rows worth showing and a shortfall
      // worth counting, and both of those are true at once.
      if (record.status === 'unreadable') {
        incomplete++;
        continue;
      }
      if (record.status === 'partial') incomplete++;
      shards.push({ key: entry.id, tasks: record.data });
    }
    if (shards.length === 0) return { ok: false, reason: 'unreadable' };
    return { ok: true, value: { shards, incomplete } };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

/**
 * The deadline list, reassembled from however many documents it arrived in.
 *
 * Deliberately the lossy view: it answers with the shards that opened and says
 * nothing about the ones that did not, because reading a backup to look at it
 * is better served by most of the list than by none of it. Nothing that
 * *writes* over the phone's own deadlines may use this — `restoreEverything`
 * reads the archive itself, for the count this one drops.
 */
export async function pullTasks(code: string): Promise<RestoreResult<Task[]>> {
  const archive = await pullTaskShards(code);
  if (!archive.ok) return archive;
  return { ok: true, value: archive.value.shards.flatMap((shard) => shard.tasks) };
}

/**
 * Which months a backup holds, newest first, without decrypting any of them.
 * Used by restore to know what it is about to pull.
 */
export async function listMonths(code: string): Promise<RestoreResult<string[]>> {
  try {
    await ready();
    const snapshot = await getDocs(
      collection(getFirestore(), 'backups', deriveBackupId(code), 'months')
    );
    return {
      ok: true,
      value: snapshot.docs.map((entry) => entry.id).sort().reverse(),
    };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

// --- the whole phone --------------------------------------------------------

/**
 * A document that did not go, and what stopped it.
 *
 * Two of the four never reached the server, because nothing was offered to it.
 * `unreadable` is the copy on this phone that could not be read at all, where
 * the only thing there was to send would have been an empty document over a
 * good one. `incomplete` is the quieter half of the same fault and the reason
 * this list has four entries rather than three: the bytes parsed, but not all
 * of them survived, so what there was to send was a month with two of its
 * habits missing or a deadline list with a row gone — a document that looks
 * perfectly well-formed on the wire and silently deletes whatever it does not
 * mention. `detail` says what was lost, in the same words the screens use.
 *
 * The other two happened at the far end.
 */
export interface BlockedDoc {
  /** the document's name on the server: `2026-09`, `current`, `2024` */
  key: string;
  reason: 'rejected' | 'too-large' | 'unreadable' | 'incomplete';
  /**
   * For a month that will not fit, which part of it is the bulk. For a record
   * this phone could only half read, what did not survive the read: `2 of 12
   * habits`, `3 grid entries`, `1 of 2 deadlines`.
   */
  detail?: string;
}

/**
 * What a whole-phone backup leaves behind.
 *
 * `months` counts the months the backup *holds* once the run is over, not the
 * ones it sent. A second run an hour later sends nothing and the history is no
 * less safe for it, and "0 months are safe" would be a lie about the backup
 * dressed up as a report on the run.
 *
 * The three counts beside it are about the run itself, and they exist because
 * one number could not tell a screen the difference between a quiet success and
 * a failure. A run that pushed two months and was refused a third used to come
 * back as a count and a non-empty `blocked`, and the card read "nothing is
 * reaching the backup" directly above "2 months are safe". Every document this
 * run considered is in exactly one of the four:
 *
 *   * `pushed` — bytes left this phone and the server took them;
 *   * `unchanged` — the server already had it, character for character;
 *   * `skipped` — deliberately not sent, because there is nothing in it;
 *   * `blocked` — named below, and not on the server in its current form.
 */
export type BackupRun =
  | {
      ok: true;
      months: number;
      /** documents whose bytes actually reached the server on this run */
      pushed: number;
      /** documents the server already held, so nothing went on the wire */
      unchanged: number;
      /** documents this run decided had nothing to say, and settled */
      skipped: number;
      blocked: BlockedDoc[];
    }
  | { ok: false; reason: 'offline' };

/** A month nobody has put anything in yet */
function isEmptyMonth(data: MonthData): boolean {
  return (
    data.habits.length === 0 &&
    Object.keys(data.grid).length === 0 &&
    data.observations.every((line) => line.trim() === '') &&
    data.keyGoals.every((goal) => goal.text.trim() === '' && !goal.done)
  );
}

/** A refusal, in the shape the caller reports it in */
function refused(key: string, result: { reason: string; detail?: string }): BlockedDoc {
  const reason = result.reason === 'too-large' ? 'too-large' : 'rejected';
  return result.detail ? { key, reason, detail: result.detail } : { key, reason };
}

/**
 * Every task document this run has any business writing: the ones the backup
 * already holds, and the ones something on this phone has reported an edit to.
 *
 * It exists for the one case where the shards cannot be computed. A deadline
 * list this phone cannot vouch for is not split into documents at all — that is
 * the whole safety of it — so there are no names to report, and they have to
 * come from what is on record instead.
 *
 * And on a first backup there is no record either. `loadLedgerFor` wipes and
 * re-keys the ledger before the run starts, so a phone backing up for the first
 * time has no digests, and it has no dirty flags unless somebody happened to
 * save a deadline since the code was generated. That left the worst case
 * reporting *nothing*: a list this phone could not read was blocked, no name
 * was found for it, and the run came back a clean, fully reconciled success
 * with somebody's deadlines still sitting on the phone. So the open list stands
 * in when there is nothing else — it is the document the deadlines would have
 * gone to, and a name a screen can put in a sentence. A backup that sends no
 * deadlines must never read as one that sent them.
 *
 * Sorted, so the same phone in the same state always reports the same thing.
 */
function taskDocsOf(ledger: Ledger): string[] {
  const named = [...Object.keys(ledger.digests), ...Object.keys(ledger.dirty)];
  const keys = [...new Set(named.filter((key) => TASK_SHARD.test(key)))].sort();
  return keys.length > 0 ? keys : [CURRENT];
}

/**
 * Everything this phone has that the backup does not, encrypted and sent.
 *
 * Months go one document at a time rather than as one blob, so a phone that
 * loses signal halfway leaves a partial backup that still restores. Newest
 * first, so a run cut short leaves the months somebody is actually using up to
 * date rather than three years of history nobody has opened.
 *
 * What gets sent is decided by the ledger. A month with a recorded digest and
 * no dirty flag against it is the document already sitting on the server, and
 * is stepped over without even being read off the disk — which is the whole
 * point, since reading and re-sealing thirty months was most of what the old
 * version of this function did. A month that is dirty is read and digested, and
 * even then only sent if the digest disagrees with what is recorded: an edit
 * that was undone before the backup ran is not a change.
 *
 * Failure is per-document, with one exception. A refusal or a month too big to
 * send is recorded against that document and the run carries on, because
 * otherwise one January that grew past the cap would silently block every month
 * behind it and the deadline list as well. Losing the connection still ends the
 * run: the next thirty requests would fail the same way, and whatever already
 * landed stays valid.
 */
async function runBackup(code: string): Promise<BackupRun> {
  let backupId: string;
  try {
    backupId = deriveBackupId(code);
  } catch {
    // Not a code, so no request was ever made and nothing reached a server —
    // which is what `offline` says. Unreachable from the app: both callers hand
    // over a code that has already been generated or normalised.
    return { ok: false, reason: 'offline' };
  }

  // The one call that enforces which backup this ledger describes. It comes
  // first and happens once: everything below reads digests out of this one
  // snapshot, and quotes generations back unchanged so an edit made mid-run
  // survives the push it arrived during.
  const ledger = await loadLedgerFor(backupId);
  const blocked: BlockedDoc[] = [];
  let held = 0;
  let pushed = 0;
  let unchanged = 0;
  let skipped = 0;

  /**
   * Null here means the store would not answer, which is not the same as a
   * phone with no months — and the sweep below turns that difference into
   * whether a pending flag is retired or kept. Reading it through the variant
   * that can say so is what stops one refused listing settling every month on
   * the phone as though it had been sent.
   */
  const listed = await readStoredMonths();
  const stored = listed ?? [];
  /**
   * Which month names this loop actually reached. The sweep after it needs to
   * tell a month the run considered and left alone from one it never saw at
   * all, and the listing is the only thing that decides which is which.
   */
  const walked = new Set<string>();
  for (const { year, month } of [...stored].reverse()) {
    const key = monthDocKey(year, month);
    walked.add(key);
    const recorded = ledger.digests[key];
    let generation = generationOf(ledger, key);

    if (generation === 0 && recorded) {
      /**
       * About to step over a month on the strength of a snapshot taken before
       * the run started — and a run is not instant, so somebody may have typed
       * into this very month while the months above it were being sealed and
       * sent. Skipping on the old answer would step over that edit, count it as
       * safe, and leave a run that reports nothing waiting; the next trigger
       * would then see a clean result and hold the edit back for half an hour.
       *
       * So the flag is re-read at the moment the decision is made. It costs one
       * small local read per settled month, which is the cheapest thing in this
       * loop and buys the one answer that has to be current.
       */
      generation = generationOf(await loadLedger(), key);
      if (generation === 0) {
        held++;
        unchanged++;
        continue;
      }
    }

    /**
     * The one read that says how much of the record it understood.
     *
     * `loadMonth` cannot, and that is the whole of the two branches below. It
     * answers a truncated file, a store that will not talk and a month with
     * nothing in it with the same empty month, and it answers a month whose
     * habit list is half garbage with the habits that survived — all of which
     * is right for a screen and none of which can be sealed and sent. The
     * partial answer is the dangerous one, because it is not empty: the digest
     * disagrees with the recorded one exactly as a real edit would, and the
     * survivors go up over the complete copy on the server with nothing
     * anywhere saying a word about it.
     */
    const record = await readMonthVouched(year, month);

    if (record.status === 'unreadable' || record.status === 'partial') {
      /**
       * Nothing is offered and nothing is refused: this is the phone saying it
       * cannot vouch for its own copy of the month. The flag is parked at the
       * generation this run picked the month up at, so the backup stops firing
       * every half hour over a record it cannot read and comes back the moment
       * somebody writes one it can — and the run carries on, because one bad
       * month is one month, not the year behind it.
       */
      await recordBlocked(key, generation);
      blocked.push(
        record.status === 'partial'
          ? { key, reason: 'incomplete', detail: record.lost }
          : { key, reason: 'unreadable' }
      );
      continue;
    }

    if (record.status === 'absent') {
      // Nothing is stored under that name at all. `listStoredMonths` saw the
      // key a moment ago, so this is a month deleted from the store while the
      // run was walking it — rare, and unambiguous either way: absence is not a
      // half-read record and there is nothing here to send. The flag comes down
      // rather than being carried forever by a month that no longer exists.
      if (generation > 0) await recordSkipped(key, generation);
      skipped++;
      continue;
    }

    const data = record.data;
    const plaintext = JSON.stringify(data);
    const digest = digestOf(plaintext);

    if (digest === recorded) {
      // Already up there, character for character — the digest is of the exact
      // string that would have been sealed. Nothing goes on the wire, but the
      // dirty flag comes down, since what set it has turned out to be no
      // change at all.
      if (generation > 0) await recordPushed(key, digest, generation);
      held++;
      unchanged++;
      continue;
    }

    if (isEmptyMonth(data) && !recorded) {
      // Opening the planner on a month writes it to disk whether or not
      // anything is typed into it, so paging back through last year
      // materialises twelve empty months. None of them has ever been sent and
      // none of them says anything, so nothing goes up and the flag is retired
      // — without a digest, since no bytes moved and this file never claims a
      // document is on the server when it is not.
      if (generation > 0) await recordSkipped(key, generation);
      skipped++;
      continue;
    }

    /**
     * A month that *was* sent and is empty now falls through to the send below,
     * which carries the deletion. That is a decision rather than an oversight,
     * and it replaces the one thing this file did that it could prove was
     * untrue.
     *
     * Three things used to look identical here — somebody clearing the month
     * out by hand, a stored month that would not parse, and a store that would
     * not answer — because `loadMonth` gives back the same empty month for all
     * three. The vouched read now catches the last two above and returns before
     * this line, so what is left is the first one alone: a record this phone
     * read with nothing dropped, and found empty. The old branch named it
     * `unreadable` anyway, so Settings said "Rin could not read September 2026
     * on this phone / this phone's copy looks damaged" about a month nothing
     * was wrong with, and the way out it offered — write in that month again —
     * would have un-emptied the month rather than backed it up. Declining to
     * carry a deletion is defensible; saying that about intact data is not.
     *
     * So it goes. Emptying a month in the planner is an ordinary edit that
     * saves like any other, a restore means "make this phone the other one",
     * and the deadline archive further down this file already carries exactly
     * this deletion for a year whose last deadline was deleted. A backup that
     * keeps resurrecting a month somebody cleared is not a safer backup, it is
     * a wrong one.
     *
     * What makes it safe to send is a pair of gates that were both already
     * here, and this is why it can be done now and could not be before:
     *
     *   * **The vouched read.** `unreadable` and `partial` returned two
     *     branches up, so the only way to this line is a record read in full.
     *     A local read failure still never overwrites anything, which is the
     *     rule the whole file is built on and is untouched.
     *   * **The dirty flag.** A month with a recorded digest and no reported
     *     edit is stepped over at the top of this loop without being read at
     *     all, so arriving here with `recorded` set means the generation is
     *     above zero — something on this phone said this month changed. An
     *     empty document goes over a full one on somebody's say-so, never on a
     *     digest that merely disagrees.
     */
    const result = await sendMonth(code, year, month, data, plaintext);
    if (result.ok) {
      await recordPushed(key, digest, generation);
      held++;
      pushed++;
      continue;
    }
    if (result.reason === 'offline') return { ok: false, reason: 'offline' };
    await recordBlocked(key, generation);
    blocked.push(refused(key, result));
  }

  /**
   * A month something reported an edit to that this phone has nothing stored
   * under, which no part of the loop above can reach.
   *
   * The loop walks `listStoredMonths`, so a name that is not in that listing is
   * never visited at all, and the `absent` branch inside it only ever fires for
   * one that was. Nothing else retires a month flag, so the count of what is
   * waiting never reaches zero again: the card reads "One month waiting" for
   * the life of the phone and a run starts every half hour to send a document
   * that does not exist. A number that cannot go down is not a status, it is a
   * nag — this is the counterpart of the sweep the task shards already have.
   *
   * It is reached without a byte of corruption. `saveMonth` is best-effort and
   * swallows whatever went wrong, while the call that reports the edit runs on
   * the next line regardless, so one failed write on a month nobody had stored
   * before strands a flag naming a month that was never written.
   *
   * Absence is empty and there is nothing here to send, exactly as in the
   * branch above: no digest is recorded, because no bytes moved and this file
   * never claims a document is on the server when it is not. Guarded by the
   * generation like every other retirement here, so a month written to disk
   * while the run was walking keeps its flag and goes next time.
   */
  if (listed !== null) {
    for (const key of Object.keys(ledger.dirty)) {
      if (!MONTH_DOC.test(key) || walked.has(key)) continue;
      await recordSkipped(key, generationOf(ledger, key));
      skipped++;
    }
  }

  /**
   * The deadline list, read the one way that tells the four answers apart.
   *
   * `loadTasks` gives back an empty list for a phone that has never saved a
   * deadline, for a file that will not parse and for a store that will not
   * answer, and the surviving rows for a file that half parses. Every screen is
   * right not to care. This is the one caller for which the difference is the
   * whole question, because it is the one that overwrites the other copy: the
   * first of those means there are no deadlines to hold on to and the other
   * three mean do not touch the archive. Even the first is only taken at its
   * word when the ledger has never heard of a task document, which is the
   * question asked immediately below.
   *
   * It happens before a single shard is computed, which is the point. A list
   * this phone cannot vouch for produces no shards at all, and a shard that
   * does not exist cannot be sealed, sent, or quietly emptied — where a guard
   * further down is one branch away from being stepped around.
   */
  const list = await readTasksVouched();

  /**
   * The fourth answer, and the one that has to be read against the ledger
   * rather than on its own.
   *
   * `absent` means nothing is stored under the key, and on a phone that has
   * never written a deadline that is the truth: no deadlines, an empty list, and
   * an empty list is legitimate. But the ledger remembers every task document
   * this phone has put on the server, and if any of them is on record then
   * deadlines *have* been written here — so nothing under the key now is the
   * local store having lost them, not the user having deleted them. Read as an
   * empty list, that turns every shard the ledger knows about into an orphan and
   * empties it, wiping years nobody has touched from the one copy that is not on
   * this phone. So it joins the other two: nothing is sent, and it is named.
   */
  const lostTheList =
    list.status === 'absent' &&
    Object.keys(ledger.digests).some((key) => TASK_SHARD.test(key));

  if (list.status === 'partial' || list.status === 'unreadable' || lostTheList) {
    /**
     * Nothing is offered and nothing is refused: this is the phone saying it
     * cannot account for its own deadlines. Every task document on record is
     * named — the ones the backup holds and the ones something here reported an
     * edit to — because a document nobody hears about is an archive quietly
     * going stale, and each one is parked in the ledger under the same
     * generation it is reported at, so what the run says is stuck and what the
     * ledger remembers as stuck are the same list. The flag comes back the
     * moment somebody writes a list this phone can read.
     */
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

  // Whatever reaches here is a list this phone can account for. `absent` is the
  // only status besides `complete` still standing, and the guard above has just
  // established that it is a phone which has never saved a deadline in its life
  // rather than one that lost the ones it had — an empty list and a legitimate
  // one, so it goes through everything below exactly as a list somebody emptied
  // by hand would.
  const shards = shardTasks(list.status === 'complete' ? list.data : []);

  /**
   * A task document the ledger knows about that the phone no longer fills is a
   * year whose last deadline was deleted. Sending an empty document is what
   * makes that deletion reach the backup, and it is also what would erase every
   * finished deadline anybody ever recorded, all at once, from the one copy
   * that is not on this phone — so the list it is decided from has to be one
   * this phone can vouch for, which is settled above and is why nothing here
   * needs to ask again.
   *
   * What is left is the second condition, and it fails the other way. Something
   * has to have reported that this particular document changed: deleting a
   * deadline is an edit, and every edit marks both the shard the task left and
   * the open list. A missing flag costs a year document left standing on the
   * server that could have been emptied, which the next restore shows as
   * deadlines coming back from the dead. That is worth saying out loud, and it
   * is still the better half of the trade against wiping the archive.
   */
  const orphans = Object.keys(ledger.digests).filter(
    (key) => TASK_SHARD.test(key) && !shards.has(key)
  );
  for (const key of orphans) {
    if (generationOf(ledger, key) > 0) shards.set(key, []);
  }

  /**
   * A task document something reported an edit to that this run has nothing
   * whatever to send under: no deadline on the phone belongs in it, and the
   * backup has never held one either, so it is not among the orphans just
   * added and no loop below will ever look at it.
   *
   * It is reached by an ordinary pair of taps. Ticking a deadline off files it
   * under the year it was finished in and marks that year as changed; un-ticking
   * it, or deleting it, before the next run leaves the year with nothing in it
   * and the flag still set. Nothing then retires it — a year that was never
   * pushed has no digest, so the orphan rule above cannot see it — and the
   * count of what is waiting never reaches zero again. That is the card in
   * Settings saying "your deadlines are waiting" for the life of the phone,
   * and a run starting every half hour to send a document that does not exist.
   * A number that cannot go down is not a status, it is a nag.
   *
   * Guarded by the generation like every other retirement here, so a deadline
   * written into that year while the run was walking it keeps its flag.
   */
  for (const key of Object.keys(ledger.dirty)) {
    if (!TASK_SHARD.test(key) || shards.has(key)) continue;
    await recordSkipped(key, generationOf(ledger, key));
  }

  /**
   * A task document parked in the ledger that this run has nothing to send
   * under and nothing to empty either — and which therefore nothing at all can
   * take the park off again.
   *
   * Both of the ways a park comes off need the document to be in `shards`: a
   * push lands under its name, or the "already up there" branch below clears a
   * stale one. The orphan rule above is what puts a vanished year back into
   * `shards`, and it deliberately will not do that at generation zero, because
   * emptying a year nobody reported an edit to is how an archive gets wiped by
   * a list that went thin without anybody touching it.
   *
   * A year parked at generation zero satisfies neither, and it is reached by an
   * ordinary sequence: the deadline list rots, so every document on record is
   * parked — a finished year at generation zero, since nothing has edited it
   * for months — and then the list is repaired without that year's deadline in
   * it. From there the card says "Deadlines you finished in 2024 is not
   * reaching the backup" for the life of the phone, which is wrong about the
   * cause and offers a remedy that cannot work. The same thing happens to
   * `current` on a first run, where it is parked as the only name there was.
   *
   * So the park comes off. Not the document: the server keeps whatever it holds
   * under that name, which is the same trade the orphan rule already makes and
   * says out loud — a year left standing that could have been emptied, rather
   * than a year emptied that should have been left standing. What is removed is
   * only this phone's claim that something is stuck, which nothing on it can
   * still support. If a deadline is filed under that year again, or anything
   * reports an edit to it, it is back in `shards` and decided afresh.
   */
  for (const key of ledger.blocked) {
    if (!TASK_SHARD.test(key) || shards.has(key)) continue;
    await clearBlocked(key);
  }

  for (const [key, group] of shards) {
    const plaintext = JSON.stringify(group);
    const digest = digestOf(plaintext);
    const generation = generationOf(ledger, key);

    if (digest === ledger.digests[key]) {
      if (generation > 0) await recordPushed(key, digest, generation);
      // The server already holds exactly these bytes, so no push will ever land
      // under this name to say the document is fine again — and a year refused
      // while the deadline list was unreadable has no dirty flag of its own to
      // revive it. Without this it would sit on the Settings card as stuck for
      // the life of the phone. Read from the snapshot, so the ordinary run
      // where nothing was ever refused writes nothing.
      else if (ledger.blocked.includes(key)) await clearBlocked(key);
      unchanged++;
      continue;
    }

    const result = await sendTaskShard(code, key, plaintext);
    if (result.ok) {
      await recordPushed(key, digest, generation);
      pushed++;
      continue;
    }
    if (result.reason === 'offline') return { ok: false, reason: 'offline' };
    await recordBlocked(key, generation);
    blocked.push(refused(key, result));
  }

  return { ok: true, months: held, pushed, unchanged, skipped, blocked };
}

// --- one run at a time ------------------------------------------------------

/**
 * The run in progress, if there is one.
 *
 * Module-level because what it guards is: there is one backup on this phone and
 * one ledger describing it, so two runs against it are two runs reading the
 * same digests, deciding the same documents need sending, and sending both
 * copies. `useAutoBackup` already keeps its own triggers from overlapping, but
 * the button in Settings does not go through it — tapping Back Up while the
 * idle timer's run is in the air doubles every write in it — so the guard
 * belongs here, where the thing being protected actually is.
 */
let inFlight: { code: string; run: Promise<BackupRun> } | null = null;

/**
 * The way in, and the only one: `runBackup` above is what it does.
 *
 * A second call for the same code joins the run already going rather than
 * starting another: it is the same work against the same ledger, and the answer
 * one of them computes is the answer for both. Anything the joiner changed
 * after that run read the ledger stays dirty and goes next time, which is what
 * the generation counter is for.
 *
 * A call for a *different* code waits instead of joining. Two codes are two
 * backups, and a ledger that belongs to one of them is wiped and re-keyed the
 * moment the other reads it, so running them across each other would have each
 * one deciding what to send from the other's digests.
 */
export function backupEverything(code: string): Promise<BackupRun> {
  if (inFlight?.code === code) return inFlight.run;

  const previous = inFlight;
  const run = (async () => {
    // a rejection can't reach here — `runBackup` returns its failures — but a
    // caught one keeps a bug in one run from taking the next one with it
    if (previous) await previous.run.catch(() => undefined);
    return runBackup(code);
  })();

  const started = { code, run };
  inFlight = started;
  const finish = () => {
    if (inFlight === started) inFlight = null;
  };
  run.then(finish, finish);
  return run;
}

/**
 * How the deadline list fared on the way down, which the months cannot say for
 * it: `none` is a backup that genuinely holds no deadlines and a local list
 * emptied to match, `unreadable` is task documents that would not decrypt and a
 * local list left exactly as it was, and `partial` is the archive arriving with
 * a hole in it — a document that would not open, or one that opened and gave
 * back fewer deadlines than it holds. That is the same answer as `unreadable`
 * for what was written, and a different sentence, because half a list arriving
 * is not nothing arriving.
 */
export type DeadlineRestore = 'restored' | 'none' | 'partial' | 'unreadable';

/**
 * What a restore leaves behind: the months it wrote, the ones it could not read
 * and stepped over, and what became of the deadlines.
 */
export type RestoreRun =
  | { ok: true; months: number; skipped: number; deadlines: DeadlineRestore }
  | { ok: false; reason: 'offline' | 'rejected' | 'missing' };

/**
 * Pulls a whole backup down onto this phone, overwriting what is here.
 *
 * Overwriting is the honest behaviour for a restore: someone typing a code
 * into a new phone means "make this phone the other one", and quietly merging
 * two months of the same name would invent a history that never happened. A
 * month that will not decrypt is skipped rather than written blank, so one bad
 * record costs one month instead of the lot.
 *
 * The ledger is seeded with what came down, so the first backup afterwards has
 * nothing to say instead of pushing the whole history straight back up. Each
 * digest is of what this phone would now send for that document, which is the
 * question the ledger is ever asked — and it is seeded only for documents that
 * actually arrived. A backup written by an older version keeps every completed
 * deadline in `current`; re-filing those by year here and then claiming the
 * year shards were already on the server would strand the archive on the phone.
 *
 * The other half of that is what the restore did *not* cover. A code holding
 * fewer documents than the phone is ordinary — an old backup, a second phone —
 * and anything already here that nothing came down for exists on this phone
 * alone, so it is named to the ledger as well and left waiting to be sent.
 */
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

  /**
   * The deadline list, and the five different things can happen to it. Four of
   * them used to share one silent branch — no seeds, no save, and a run that
   * still reported success — which is the worst bug this file has had: the
   * phone was told the restore worked, so the next ordinary backup pushed
   * whatever thin list was on it straight over the deadlines it had failed to
   * download, and the last copy of them was gone.
   *
   *   * `missing` is the only one that means what the silence claimed. The
   *     backup holds no task documents at all, so the phone it is being poured
   *     onto should hold none either — a restore is "make this phone the other
   *     one", and leaving a stray local list behind would invent a history
   *     neither phone had.
   *   * `unreadable` means the documents are there and none of them will open.
   *     Nothing is written locally, since there is nothing to write, and the
   *     run carries on: what is on the server is already lost, and the phone's
   *     own list is the better copy of the two.
   *   * **The archive arriving with a hole in it** is the same principle, and
   *     it went the other way for as long as the count did not exist. The phone
   *     keeps one flat list, so the save below is a replacement rather than a
   *     merge: pouring in what arrived deletes every deadline that did not,
   *     silently, on the phone that still had them. Two phones on one code are
   *     enough — the second on a newer build, so its records carry a `v` this
   *     one does not know and `open` answers null — and it costs a whole open
   *     list. A shard that opens and half parses does it more quietly still,
   *     since what comes back is a well-formed list that is merely shorter than
   *     the document; that one is counted here too, which is what stops a
   *     restore reporting a clean success over deadlines it never downloaded.
   *     What is on the server is already out of reach either way, and this
   *     phone's list is the better copy of the two, so it is left exactly as it
   *     is and reported.
   *   * `offline` and `rejected` mean the deadlines are still up there and this
   *     phone simply did not get them. That is a restore that did not happen,
   *     and it is reported as one. Nothing is seeded, so nothing on this phone
   *     is left claiming to be the backup's copy of anything.
   *
   * Nothing is seeded in any of the three that write nothing, which matters as
   * much as the save does. A seed is this phone saying "the server's copy of
   * that document is what I hold now", and after a restore that wrote no
   * deadlines it holds its own list instead. Left unseeded, every local shard
   * is named to the ledger below and waiting to be sent.
   */
  const archive = await pullTaskShards(code);
  let deadlines: DeadlineRestore;
  if (archive.ok && archive.value.incomplete > 0) {
    deadlines = 'partial';
  } else if (archive.ok) {
    const tasks: Task[] = [];
    for (const shard of archive.value.shards) {
      tasks.push(...shard.tasks);
      seeds[shard.key] = digestOf(JSON.stringify(shard.tasks));
    }
    await saveTasks(tasks);
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
    /**
     * Everything this phone holds once the writes above are done, named so the
     * ledger can tell what the restore covered from what it did not. A document
     * that came down is accounted for by its seed; one that was already here
     * and is in no seed exists on this phone and nowhere else, and saying so is
     * what leaves it waiting to be sent rather than sitting on disk with
     * nothing to trigger the run that would save it.
     */
    const local = [
      ...(await listStoredMonths()).map((m) => monthDocKey(m.year, m.month)),
      ...shardTasks(await loadTasks()).keys(),
    ];
    await seedPushed(deriveBackupId(code), seeds, local);
    /**
     * Every month that came down was written whole, so whatever this phone had
     * previously failed to read of it is gone along with the record it was
     * about. Restoring the same code onto the same phone is the existing way
     * out of a damaged month, and a note left standing here would have the card
     * still calling a month damaged that the restore had just replaced.
     */
    for (const key of Object.keys(seeds)) await clearUnvouched(key);
  } catch {
    // bookkeeping, after the data has already landed: a code that will not
    // derive never got past the listing above, and a lost seed costs one
    // needless upload rather than anything on this phone
  }

  return { ok: true, months: restored, skipped, deadlines };
}

/**
 * One month, pulled back down over the copy on this phone.
 *
 * This is the way out of the one trap the vouched read leaves behind, and it is
 * worth stating in full, because everything else in this file is built to stop
 * a write rather than to offer one. A month whose record went bad on disk is
 * drawn from the parts that survived and never sent, which is right: the server
 * may well still hold the whole thing. But somebody has to go on using the app,
 * so a deliberate edit to that month is allowed to save — and the moment it
 * does, the thinned month is a healthy record with nothing left anywhere to say
 * what it lost, and the next run carries it over the good copy. The card warns
 * about that and, until now, warned was all it did.
 *
 * So: instead of writing the damaged month outwards, write the good one
 * inwards. It is the same trade a whole restore makes, made about one document
 * — this phone's copy is replaced, and whatever was typed into that month since
 * the damage is replaced with it — which is why nothing here decides to do it.
 * The screen asks, having said so out loud.
 *
 * Three things make it safe, and only the last is new:
 *
 *   * **`pullMonth` vouches what arrives.** A document that will not decrypt,
 *     is not a month, or parses to less than it holds comes back `unreadable`
 *     and nothing is written. There is no second check here, deliberately: a
 *     second reading of the same question is a second answer to keep in step,
 *     and this one is already the answer the whole restore path trusts.
 *   * **Nothing is written for anything but a complete month.** `missing` is
 *     the backup not holding that month at all, and it is a perfectly ordinary
 *     answer — a month written after the last backup, or on a code from another
 *     phone. It costs nothing and takes nothing away.
 *   * **The ledger is told what landed.** Without it the restored month is a
 *     record whose digest disagrees with the recorded one exactly as an edit
 *     does, so the very next run would seal it and send it straight back over
 *     the document it was just copied from — a needless write, and a needless
 *     ciphertext of somebody's month on the wire.
 *
 * The dirty flag is deliberately left standing, exactly as `restoreEverything`
 * leaves it, and here it is load-bearing rather than merely harmless.
 * `saveMonth` is best-effort and swallows whatever went wrong, so the write
 * above is a belief and not a fact. With the flag standing the next run reads
 * the month, finds it matches the digest just recorded, and retires the flag
 * without sending a byte; if the write silently failed, that read finds the
 * damaged record still there and parks it again, which is the truth. Clearing
 * the flag here would instead skip the month unread from then on, and the card
 * would call a damaged month backed up.
 */
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
    /**
     * Read through the call that settles which backup this ledger describes, so
     * a record left over from another code is wiped before its digests are read
     * back — and merged rather than replaced, which is the one way this differs
     * from the whole-phone restore. `seedPushed` replaces the digest map because
     * a whole restore has just accounted for every document there is; one month
     * accounts for one document, and the rest of the map is still this phone's
     * belief about the same server. Dropping it would re-send the entire
     * history to fix a single month.
     */
    const ledger = await loadLedgerFor(backupId);
    const digest = digestOf(JSON.stringify(pulled.value));
    await seedPushed(backupId, { ...ledger.digests, [key]: digest });
    /**
     * And both marks come off. They were put on against bytes that are no
     * longer on this phone, and leaving either would have the card still
     * calling the month damaged after the damage had been replaced — the one
     * thing a way out must not do is fail to say it worked.
     *
     * The park and the damage note are separate on purpose, because a refusal
     * and an unreadable local copy are different problems with different
     * remedies. A restore is the one act that ends both at once, so it is the
     * one place that has to remember to say so twice.
     */
    await clearBlocked(key);
    await clearUnvouched(key);
  } catch {
    // bookkeeping, after the month has already landed. A code that will not
    // derive never got past `pullMonth`, and a lost seed costs one needless
    // upload rather than anything on this phone.
  }

  return pulled;
}


/**
 * Erase the backup itself, not just this phone's copy of the code.
 *
 * "Forget the code" was never this. It clears the keychain and leaves every
 * document standing, which is right for someone changing phones and wrong for
 * someone who wants out — until now there was no way to get data off the server
 * at all, which sits badly beside a promise this strong.
 *
 * What it removes is every month and every task document filed under the id the
 * code derives, and nothing else: no other backup is reachable, because the id
 * is the only way in and it is derived rather than listed. What stays is this
 * phone's own data, which is untouched. Deleting the backup is not deleting
 * your months.
 *
 * It is deliberately not "best effort, report success". A partial delete that
 * claimed to have finished would be the worst possible answer here, so the
 * count of what actually went is handed back and anything refused leaves the
 * whole thing reported as unfinished.
 */
export async function deleteBackup(
  code: string
): Promise<{ ok: true; deleted: number } | { ok: false; reason: 'offline' | 'rejected'; deleted: number }> {
  let deleted = 0;
  try {
    await ready();
    const id = deriveBackupId(code);
    const db = getFirestore();

    for (const name of ['months', 'tasks'] as const) {
      const listing = await getDocs(collection(db, 'backups', id, name));
      for (const entry of listing.docs) {
        await deleteDoc(doc(db, 'backups', id, name, entry.id));
        deleted++;
      }
    }

    /**
     * The ledger goes too. It is this phone's account of what the server holds,
     * and every word of it is now wrong — leaving it would have the next run
     * skip months whose digests it still recognises and quietly upload nothing.
     */
    await resetFor(id);
    return { ok: true, deleted };
  } catch (error) {
    return { ok: false, reason: reasonFor(error), deleted };
  }
}
