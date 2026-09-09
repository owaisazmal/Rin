import { getAuth, signInAnonymously } from '@react-native-firebase/auth';
import {
  collection,
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
import { Task, loadTasks, parseTasks, readTasksVouched, saveTasks } from './tasks';
import { listStoredMonths, parseMonthData, readMonthVouched, saveMonth } from './storage';
import {
  Ledger,
  clearBlocked,
  digestOf,
  generationOf,
  loadLedger,
  loadLedgerFor,
  recordBlocked,
  recordPushed,
  recordSkipped,
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
 * What comes off the wire is decrypted and then handed to the same parser that
 * guards AsyncStorage, so a record that decrypts but says something the app
 * doesn't understand — an older format, a hand-edited document, a corrupted
 * write — becomes an empty month rather than a crash.
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
    return { ok: true, value: parseMonthData(JSON.parse(plaintext)) };
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
 * Every task document this backup holds, decrypted.
 *
 * The rules allow listing this collection precisely so a restore can find out
 * which years exist rather than probing ids one at a time or guessing a range.
 * A shard that will not decrypt is stepped over: one unreadable year costs that
 * year, not the deadline list.
 *
 * Order is fixed here — the open list, then the archive oldest first — so the
 * same backup always reassembles into the same list. Nothing downstream depends
 * on it, since every screen sorts deadlines by their due date, but a stable
 * answer is worth more than an arbitrary one.
 */
async function pullTaskShards(code: string): Promise<RestoreResult<TaskShard[]>> {
  try {
    await ready();
    const listing = await getDocs(
      collection(getFirestore(), 'backups', deriveBackupId(code), 'tasks')
    );
    if (listing.docs.length === 0) return { ok: false, reason: 'missing' };

    const key = deriveKey(code);
    const order = (id: string) => (id === CURRENT ? '' : id);
    const shards: TaskShard[] = [];
    for (const entry of [...listing.docs].sort((a, b) =>
      order(a.id).localeCompare(order(b.id))
    )) {
      const plaintext = open(key, entry.data() as Sealed);
      if (plaintext === null) continue;
      try {
        shards.push({ key: entry.id, tasks: parseTasks(JSON.parse(plaintext)) });
      } catch {
        // decrypted, but not JSON — the same dead end as a failed decryption
      }
    }
    if (shards.length === 0) return { ok: false, reason: 'unreadable' };
    return { ok: true, value: shards };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

/** The deadline list, reassembled from however many documents it arrived in */
export async function pullTasks(code: string): Promise<RestoreResult<Task[]>> {
  const shards = await pullTaskShards(code);
  if (!shards.ok) return shards;
  return { ok: true, value: shards.value.flatMap((shard) => shard.tasks) };
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

  const stored = await listStoredMonths();
  for (const { year, month } of [...stored].reverse()) {
    const key = monthDocKey(year, month);
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

    if (isEmptyMonth(data)) {
      // Opening the planner on a month writes it to disk whether or not
      // anything is typed into it, so paging back through last year
      // materialises twelve empty months. None of them has ever been sent and
      // none of them says anything, so nothing goes up and the flag is retired
      // — without a digest, since no bytes moved and this file never claims a
      // document is on the server when it is not.
      if (!recorded) {
        if (generation > 0) await recordSkipped(key, generation);
        skipped++;
        continue;
      }

      /**
       * The backup holds a month with something in it, and this phone holds a
       * month with nothing in it. Three things used to look exactly like that —
       * somebody clearing the month out by hand, a stored month that would not
       * parse, and a store that would not answer — because `loadMonth` gives
       * back the same empty month for all three. Two of them are now caught
       * above by the vouched read and never reach here, so this branch is the
       * first one alone: a record this phone read in full and found empty.
       *
       * It is still not sent. Sending is what carries a deletion to the backup,
       * and carrying the deletion of a whole month is a decision nothing here
       * has been asked to make; it is also the only one on this path that
       * cannot be taken back, since the document being overwritten is the last
       * copy of that month there is. So it is named instead, and the cost is
       * that a month emptied on purpose reads as stuck until something is
       * written into it again.
       *
       * That is now a wrong thing said out loud about a case this file can
       * finally identify, which makes it the next thing to fix rather than a
       * trade — see `BlockedDoc` for the vocabulary a screen would need.
       */
      await recordBlocked(key, generation);
      blocked.push({ key, reason: 'unreadable' });
      continue;
    }

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
 * local list left exactly as it was.
 */
export type DeadlineRestore = 'restored' | 'none' | 'unreadable';

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
   * The deadline list, and the four different things "no shards came back" can
   * mean. They used to share one silent branch — no seeds, no save, and a run
   * that still reported success — which is the worst bug this file has had: the
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
   *   * `offline` and `rejected` mean the deadlines are still up there and this
   *     phone simply did not get them. That is a restore that did not happen,
   *     and it is reported as one. Nothing is seeded, so nothing on this phone
   *     is left claiming to be the backup's copy of anything.
   */
  const shards = await pullTaskShards(code);
  let deadlines: DeadlineRestore;
  if (shards.ok) {
    const tasks: Task[] = [];
    for (const shard of shards.value) {
      tasks.push(...shard.tasks);
      seeds[shard.key] = digestOf(JSON.stringify(shard.tasks));
    }
    await saveTasks(tasks);
    deadlines = 'restored';
  } else if (shards.reason === 'missing') {
    await saveTasks([]);
    deadlines = 'none';
  } else if (shards.reason === 'unreadable') {
    deadlines = 'unreadable';
  } else {
    return { ok: false, reason: shards.reason };
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
  } catch {
    // bookkeeping, after the data has already landed: a code that will not
    // derive never got past the listing above, and a lost seed costs one
    // needless upload rather than anything on this phone
  }

  return { ok: true, months: restored, skipped, deadlines };
}
