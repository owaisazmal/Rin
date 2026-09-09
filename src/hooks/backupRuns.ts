import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadCode } from '../backupState';
import { BackupRun, backupEverything } from '../sync';
import { Ledger, clearBlocked, loadLedger } from '../syncLedger';
import { Moment, NO_RUNS, RunMemory, aftermath, dirtyStamp } from './autoBackupPolicy';

/**
 * The runs this launch makes against the one backup this phone has, and what
 * each of them turned out to mean.
 *
 * None of it is hook machinery, and that is why it is here rather than in
 * `useAutoBackup`. There is one backup on this phone, so there is one sequence
 * of attempts against it — the timer's, the app coming back, and the button on
 * the backup screen are three ways of joining the same sequence, not three
 * sequences. Holding it in a module rather than in a hook is what makes that
 * true; holding it in a file with no React in it is what makes it reachable
 * from the test suite, which the hook is not.
 *
 * The bug this file exists to end: the button did not come through here at all.
 * It called `backupEverything` and printed the result, so the one run somebody
 * actually watches was the one run nothing was learned from — no aftermath, no
 * setback count, and, the part that mattered, no park taken off the documents
 * the server had turned away. A single tap during an expired App Check token
 * left every document on the phone individually parked, nothing counted as
 * waiting, and no trigger with any reason to start: a backup that had stopped
 * for good, under a card saying everything was fine. A manual run and an
 * automatic one may not disagree about what happened, so there is one door.
 */

// --- what this launch has established ---------------------------------------

/**
 * The run in flight, if there is one.
 *
 * `backupEverything` guards itself as well, and that guard is the one that
 * makes a second run harmless. This one makes it unnecessary, and it is also
 * what decides which caller does the bookkeeping afterwards — something the
 * sync side has no way to know.
 */
let inFlight: Promise<BackupRun | null> | null = null;

/** When a run was last *attempted*, which is what the throttles count, not when one worked */
let lastAttemptAt = 0;

/**
 * What the runs this launch has made add up to.
 *
 * `autoBackupPolicy.aftermath` decides every field of it, so what is left here
 * is the assignment — which matters, because the bug that suppressed a whole
 * morning of edits was one field being written outside the guard that governed
 * the rest of them.
 *
 * One field of it is written to disk and the rest is not. The ledger remembers
 * *which* documents are stuck across launches, because that survives being
 * turned off overnight, but a reason recorded weeks ago could easily be wrong
 * now — and whether a run has finished is a fact about this process, since a
 * phone updated from a version that had no ledger looks on disk exactly like a
 * phone that has sent everything. `turnedAway` is the exception, and the
 * `Turnaway` record below is where it goes and why.
 */
let memory: RunMemory = NO_RUNS;

/**
 * The run this launch has already worked out the meaning of.
 *
 * Two callers can be handed the same run — the button sends under the code this
 * phone already holds, so `backupEverything` gives it whatever run the idle
 * timer has in the air rather than starting a second one — and what a run means
 * may only be counted once, or one stalled attempt would climb two rungs of the
 * setback floor. Compared by identity, because two runs that come back looking
 * identical are still two runs.
 */
let accountedFor: BackupRun | null = null;

// --- the one thing a run leaves on disk --------------------------------------

const TURNED_AWAY_KEY = '@monthly-planning/backup-turned-away';

/**
 * What the last finished run was refused by the server, as it survives the app
 * being closed.
 *
 * The smallest true thing there is to keep, and deliberately not a list of
 * documents. A refusal about the *install* — an expired App Check token, a rate
 * limit, a project misconfigured for an afternoon — is parked against no
 * document on purpose, because parking it is what left a phone unable to back
 * up ever again after one bad token. But the moment the park is off, a document
 * that was refused without a dirty flag of its own leaves no trace anywhere on
 * this phone: the ledger is bound, dated, has nothing waiting and nothing
 * stuck, and reads exactly like a phone that has sent everything. That was fine
 * only for as long as the process lived. Closed and opened again, the phone had
 * no record that anything had ever been refused, started no run, and put a card
 * in front of somebody saying their history was in the backup when two
 * documents of it were not.
 *
 * So a count goes on disk, and a count is enough: it says the phone is behind
 * without saying which document is at fault, which is all either the card or
 * the trigger needs in order to do the right thing. It is also why this cannot
 * become the permanent silence it replaces. Every finished run writes the whole
 * record afresh from what that run was refused — up, down, or to nothing — so
 * there is no number here that can only climb, and nothing an edit or a
 * successful morning cannot clear.
 *
 * `at` is the date on that claim rather than a floor under the next run, and
 * the distinction matters. Nothing throttles on it: a wait inherited across a
 * relaunch would have to inherit the stamp the run left behind as well, and
 * that pair — a floor plus a set it applies to — is exactly the persisted state
 * that can leave a phone waiting for a moment that never comes. What it is for
 * is that a bare "two" cannot be told from a "two" written a year ago by anyone
 * reading this record back, here or in a bug report.
 */
interface Turnaway {
  /** how many documents the last finished run was turned away from */
  count: number;
  /** when that run was attempted, epoch milliseconds, 0 when unknown */
  at: number;
}

/** Nothing outstanding — a phone no run has been refused anything on */
const NEVER_TURNED_AWAY: Turnaway = { count: 0, at: 0 };

/**
 * Read the way every store in this app reads: anything that is not the shape
 * this file writes is treated as no record at all.
 *
 * A dropped record costs one run that was probably unnecessary, which is the
 * direction everything about backing up fails in. The other direction is a
 * phone that believes a number it made up about documents it never checked.
 */
function parseTurnaway(raw: unknown): Turnaway {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return NEVER_TURNED_AWAY;
  const record = raw as Record<string, unknown>;
  const { count, at } = record;
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
    return NEVER_TURNED_AWAY;
  }
  /**
   * A stamp from the future is a clock that has been put back since, so the
   * date is dropped and the count kept. The count is the part anything acts on
   * and it is still true; the date would only be a lie about when.
   */
  const dated = typeof at === 'number' && Number.isInteger(at) && at > 0 && at <= Date.now();
  return { count, at: dated ? at : 0 };
}

async function readTurnaway(): Promise<Turnaway> {
  try {
    const raw = await AsyncStorage.getItem(TURNED_AWAY_KEY);
    return raw ? parseTurnaway(JSON.parse(raw)) : NEVER_TURNED_AWAY;
  } catch {
    return NEVER_TURNED_AWAY;
  }
}

/**
 * Written rather than removed when there is nothing outstanding, because
 * "refused nothing" is a statement a finished run earned and a missing key is
 * only an absence. Best-effort like every other store here: a write that never
 * lands leaves the previous record standing, and the previous record can only
 * make the next launch try again.
 */
async function writeTurnaway(record: Turnaway): Promise<void> {
  try {
    await AsyncStorage.setItem(TURNED_AWAY_KEY, JSON.stringify(record));
  } catch {
    // best-effort persistence, matching the rest of the app's stores
  }
}

/**
 * The read of that record, done once and waited for by everything that could
 * act on it.
 *
 * It has to be waited for rather than kicked off and hoped about. The first
 * thing this hook does on a cold start is ask whether the moment is worth a
 * run, and a phone whose only reason to run is on disk would answer no if the
 * read had not landed — which is the bug, arriving a few milliseconds later.
 *
 * Memoised, so the disk is read once per launch and every caller after the
 * first waits on the same promise. `settle` waits on it too, before it touches
 * `memory` at all, which is what stops a read in flight from overwriting what a
 * run has since established.
 */
let established: Promise<void> | null = null;

function establish(): Promise<void> {
  if (established === null) {
    const reading = readTurnaway().then((record) => {
      // A launch that ended while this read was in the air — a restore, or the
      // code being forgotten — is a launch this record describes nothing about,
      // and letting it land would put the old backup's count back on the new one.
      if (established === reading) memory = { ...memory, turnedAway: record.count };
    });
    established = reading;
  }
  return established;
}

/** What the runs so far have established, for the decisions that read it */
export async function launchMemory(): Promise<RunMemory> {
  await establish();
  return memory;
}

/**
 * Everything `shouldRun` needs that only this launch can say.
 *
 * The trigger supplies the other half — the ledger as it reads right now, and
 * the stamp the idle timer keeps for itself. Assembled here rather than in the
 * hook so that what a test asks and what the app asks are the same question:
 * the field that decides whether a refused install is ever offered again is
 * exactly the sort of thing that gets left out of one of two copies.
 */
export async function launchMoment(): Promise<Omit<Moment, 'ledger' | 'seen'>> {
  await establish();
  return {
    accounted: memory.accounted,
    settled: memory.settled,
    attempted: memory.attempted,
    setbacks: memory.setbacks,
    /**
     * What the last finished run was refused by the server rather than about
     * the document. The ledger cannot hold it — the park comes off precisely so
     * that one bad afternoon does not become permanent — so for a document that
     * did not go and has no dirty flag of its own, this count is the only place
     * the refusal exists at all, which is why it is the one thing here that
     * comes off disk rather than out of this process.
     */
    turnedAway: memory.turnedAway,
    /**
     * What the throttles count is when a run was last *attempted*, not when one
     * last worked — and a launch has attempted nothing, so the first look of
     * one is never held back. That is deliberate, and it is the other half of
     * the record above being kept: a phone that comes back knowing it was
     * refused has to be allowed to do something about it, and every floor here
     * is a guess about what the last attempt would say again, which a launch
     * with no last attempt has no business inheriting.
     */
    since: Date.now() - lastAttemptAt,
  };
}

/**
 * The process ending — nothing more, and nothing written down.
 *
 * This is what closing the app does, and it is a separate function from
 * `forgetLaunch` below because they are separate events that used to be one:
 * being closed, and being pointed at a different backup. Telling them apart is
 * the whole of this change. Everything above dies with the process on its own,
 * and the count of what was refused is exactly the thing that must not — so a
 * test that stages a restart has to be able to ask for this half and only this
 * half, or it would be proving that a record it had just deleted was missing.
 */
export function endLaunch(): void {
  inFlight = null;
  lastAttemptAt = 0;
  memory = NO_RUNS;
  accountedFor = null;
  // read again on the next question asked, since this is a different launch
  established = null;
}

/**
 * Forget this phone's account of itself, on disk as well.
 *
 * For the phone that has just been told to forget its code, or been pointed at
 * somebody else's backup by a restore: the setbacks, the refusals, the claim to
 * have been checked and the count of what was turned away are all statements
 * about a backup this phone no longer has, and carrying any of them into the
 * next one would describe the wrong server. The count especially, since it is
 * the half that would otherwise survive.
 *
 * Fire-and-forget at both call sites, exactly like `forgetCode` beside it, and
 * safe to leave unawaited because nothing here needs waiting for: the
 * in-process half is gone before the first `await`, and if the write never
 * lands the worst it can do is send the next launch to check a backup that is
 * already fine.
 */
export async function forgetLaunch(): Promise<void> {
  endLaunch();
  /**
   * Established as knowing nothing, before the write rather than after it. A
   * question asked while that write is in the air would otherwise re-read the
   * record this call exists to destroy and put the old count straight back.
   */
  established = Promise.resolve();
  await writeTurnaway(NEVER_TURNED_AWAY);
}

// --- one run at a time ------------------------------------------------------

/** Signs in, seals, sends. Never throws: a failed backup is not an app crash. */
async function attempt(): Promise<BackupRun | null> {
  lastAttemptAt = Date.now();
  try {
    const code = await loadCode();
    return code ? await backupEverything(code) : null;
  } catch {
    // The Keychain refused, or something under the run did. Either way the next
    // trigger tries again, and nothing on this phone has been lost.
    return null;
  }
}

/** The run in progress, starting one if there isn't one */
function run(): Promise<BackupRun | null> {
  if (!inFlight) {
    const started = attempt();
    inFlight = started;
    const finish = () => {
      if (inFlight === started) inFlight = null;
    };
    started.then(finish, finish);
  }
  return inFlight;
}

// --- what a run turned out to mean ------------------------------------------

/** What a settled run leaves for the screen: the date it earned, and the ledger to draw */
export interface Settled {
  /** whether bytes reached the server, which is the only thing that dates a backup */
  dated: boolean;
  /** the ledger as it reads once the parks are off, which is what the card is shown */
  ledger: Ledger;
}

/**
 * Everything that has to happen once a run is over, wherever the run came from.
 *
 * Counted once per run: a second caller handed the same run gets the ledger and
 * nothing else, because the run has already been accounted for and counting it
 * twice would climb the setback floor twice for one refusal.
 */
async function settle(result: BackupRun | null): Promise<Settled> {
  // Before `memory` is read, let alone written: a launch that has not finished
  // reading what the last one was refused would otherwise start from a count of
  // nothing, and an attempt that got nowhere would then carry that nothing
  // forward as though it were an answer.
  await establish();

  const after = await loadLedger();
  if (result !== null && result === accountedFor) return { dated: false, ledger: after };
  accountedFor = result;

  const outcome = aftermath(memory, result, dirtyStamp(after));
  memory = outcome.memory;

  /**
   * The count goes down on disk here as readily as it goes up, and only a run
   * that got a real answer may move it at all. A finished run refused nothing
   * writes the empty record, which is what makes a good morning after a bad one
   * enough on its own; a run that never got out writes nothing, because it
   * learned nothing, and erasing the record with its silence is precisely the
   * mistake `retryEverything` was rewritten to stop making.
   */
  if (outcome.answered) {
    await writeTurnaway(
      memory.turnedAway === 0 ? NEVER_TURNED_AWAY : { count: memory.turnedAway, at: lastAttemptAt }
    );
  }

  /**
   * The park comes off every document the server turned away, and `sync` put it
   * on a moment ago: from where that code stands a refusal is a refusal, and it
   * is right to record one. It is this side that knows the difference between a
   * document the server judged and a session it declined, and a park is only
   * ever the first of those. Left on, one expired App Check token would leave
   * every document individually stuck, nothing counted as waiting, and no run
   * to start — a phone that never backs up again and never says so.
   */
  for (const key of outcome.unpark) await clearBlocked(key);

  // The dirty flags are untouched by un-parking, so what a trigger reads is the
  // same either way; the card is not, and has to see the parks come off.
  const ledger = outcome.unpark.length > 0 ? await loadLedger() : after;
  return { dated: outcome.dated, ledger };
}

/**
 * Start a run under this phone's own code, or fall in behind one already going,
 * and account for it if this call is the one that started it.
 *
 * Null when it is not: whoever started the run does the bookkeeping, which is
 * decided before the first `await` and so cannot be decided twice — two
 * triggers landing together would otherwise both stamp the date and both
 * re-publish.
 *
 * The run itself comes back alongside what settling it established, because one
 * caller needs both. `runAndSettle` below is this without the run, which is all
 * the triggers have ever wanted; `retryEverything` is the caller that has to
 * know whether anything reported back at all, and what it said.
 */
async function runSettled(): Promise<{ result: BackupRun | null; settled: Settled } | null> {
  const mine = inFlight === null;
  const result = await run();
  return mine ? { result, settled: await settle(result) } : null;
}

/** The run this launch is making, settled — the way in for both triggers */
export async function runAndSettle(): Promise<Settled | null> {
  const outcome = await runSettled();
  return outcome === null ? null : outcome.settled;
}

/**
 * Back this phone up now, under a code the caller names.
 *
 * The way in for the backup screen, which cannot use the triggers: it sends
 * under the code on the screen, which on a first backup is one this phone has
 * not saved yet. Everything after the run is the same as for a run nobody asked
 * for, which is the whole point of it being here.
 *
 * The result comes back unchanged so the screen can say what the run did. What
 * a screen may not do is decide what the run *meant*; that is settled above,
 * once, in the same place the phone's own runs settle it.
 */
export async function backupNow(code: string): Promise<BackupRun> {
  lastAttemptAt = Date.now();
  const result = await backupEverything(code);
  await settle(result);
  return result;
}

/**
 * Try everything again, now, because somebody asked.
 *
 * The throttles and the parks in the ledger are all guesses about whether
 * anything has changed since the last answer, and every one of them is a guess
 * this can see past: a person pressing "try again" knows they have just trimmed
 * the month, or walked out of the tunnel, or that the thing that was wrong at
 * my end has been fixed. So the climbing floor starts again from nothing, the
 * run goes without asking `shouldRun` a thing, and the parks come off — every
 * one of them, whatever put it there.
 *
 * They come off *afterwards*, though, and that is the whole of this function.
 * They used to come off first, along with this launch's memory of why each
 * document was refused, and nothing put either back when the run then got
 * nowhere. A refusal the server made lives in `memory.refusals` and nowhere
 * else — the park is deliberately lifted so that one expired token is not
 * permanent — so a tap answered by a dead connection erased the only record
 * that anything was stuck: an empty blocked list, nothing counted as waiting,
 * no refusal remembered, no trigger with a reason to start, and a card reading
 * "everything on this phone is in the backup" over months that had never gone.
 * That is worse than not tapping at all, and it is the exact state the whole
 * `turnedAway` mechanism exists to make unreachable. So nothing is forgotten
 * until a run has come back and said what is still stuck, and a run that never
 * reports leaves the phone knowing precisely what it knew before the tap.
 *
 * Waiting costs nothing, because a park has never held a document back from
 * being offered: `runBackup` walks every month on disk and every shard the
 * deadlines make whatever the blocked list says, and it is the card and the
 * triggers that read that list. What clearing does buy is the park a run steps
 * over in silence — a document already on the server character for character,
 * which no push and no skip will ever take one off — and those come off here
 * the moment a finished run has failed to name them. Anything it was refused
 * again stays exactly where the run has just put it.
 */
export async function retryEverything(): Promise<Settled | null> {
  const parked = (await loadLedger()).blocked;
  /**
   * The one thing that is safe to give up before the run, because forgetting it
   * can only make this phone try sooner: the climbing floor is a guess about how
   * long there is no point in asking, and somebody asking is better information
   * than the guess.
   */
  memory = { ...memory, setbacks: 0 };

  const outcome = await runSettled();
  if (outcome === null) return null;
  const { result, settled } = outcome;

  /**
   * Nothing came back to say what is still stuck — the connection died, or the
   * Keychain would not give up the code — so nothing here knows any more than it
   * did before the tap, and every park stands. `aftermath` leaves this launch's
   * refusals alone for the same reason, which is what makes the two halves of
   * the record recover together instead of one of them outliving the other.
   */
  if (result === null || !result.ok) return settled;

  const stillStuck = new Set(result.blocked.map((doc) => doc.key));
  const stale = parked.filter((key) => !stillStuck.has(key));
  for (const key of stale) await clearBlocked(key);

  // The card is shown the ledger, so it has to see the parks come off — and on
  // the ordinary retry, where none of them did, there is nothing to re-read.
  return stale.length === 0 ? settled : { ...settled, ledger: await loadLedger() };
}
