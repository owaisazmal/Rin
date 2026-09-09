import { loadCode } from '../backupState';
import { BackupRun, backupEverything } from '../sync';
import { Ledger, clearBlocked, loadLedger } from '../syncLedger';
import { Moment, NO_RUNS, RunMemory, aftermath, dirtyStamp, turnedAway } from './autoBackupPolicy';

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
 * None of it is written to disk. The ledger remembers *which* documents are
 * stuck across launches, because that survives being turned off overnight, but
 * a reason recorded weeks ago could easily be wrong now — and whether a run has
 * finished is a fact about this process, since a phone updated from a version
 * that had no ledger looks on disk exactly like a phone that has sent
 * everything.
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

/** What the runs so far have established, for the decisions that read it */
export function launchMemory(): RunMemory {
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
export function launchMoment(): Omit<Moment, 'ledger' | 'seen'> {
  return {
    accounted: memory.accounted,
    settled: memory.settled,
    attempted: memory.attempted,
    setbacks: memory.setbacks,
    /**
     * What the last finished run was refused by the server rather than about
     * the document. The ledger cannot hold it — the park comes off precisely so
     * that one bad afternoon does not become permanent — so for a document that
     * did not go and has no dirty flag of its own, this launch's memory of the
     * run is the only place the refusal exists at all.
     */
    turnedAway: turnedAway([...memory.refusals.values()]).length,
    // What the throttles count is when a run was last *attempted*, not when one
    // last worked.
    since: Date.now() - lastAttemptAt,
  };
}

/**
 * Forget this launch's account of itself.
 *
 * For the phone that has just been told to forget its code: the setbacks, the
 * refusals and the claim to have been checked are all statements about a backup
 * this phone no longer has, and carrying them into the next one would describe
 * somebody else's. A test is a launch too, which is the second reason this is
 * exported rather than kept private.
 */
export function forgetLaunch(): void {
  inFlight = null;
  lastAttemptAt = 0;
  memory = NO_RUNS;
  accountedFor = null;
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
  const after = await loadLedger();
  if (result !== null && result === accountedFor) return { dated: false, ledger: after };
  accountedFor = result;

  const outcome = aftermath(memory, result, dirtyStamp(after));
  memory = outcome.memory;

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
 */
export async function runAndSettle(): Promise<Settled | null> {
  const mine = inFlight === null;
  const result = await run();
  return mine ? await settle(result) : null;
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
 * my end has been fixed. So the parks come off — every one of them, whatever
 * put it there — the climbing floor starts again from nothing, and the run goes
 * without asking `shouldRun` a thing.
 *
 * Nothing here can lose anything. Un-parking a document that really is too
 * large costs one refused request, after which the run parks it again and the
 * card says the same thing it said before.
 */
export async function retryEverything(): Promise<Settled | null> {
  const ledger = await loadLedger();
  for (const key of ledger.blocked) await clearBlocked(key);
  memory = { ...memory, setbacks: 0, refusals: new Map() };
  return runAndSettle();
}
