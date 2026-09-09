import type { BackupRun, BlockedDoc } from '../sync';
import { Ledger, pendingCount, pendingKeys } from '../syncLedger';

/**
 * When the phone backs up on its own, and what the card is allowed to say about it.
 *
 * All of it is decided here, away from `useAutoBackup`, and for one reason: the
 * hook is unreachable from the test suite. Everything in `src/__tests__` runs in
 * plain Node against pure modules, and a React hook needs a renderer, a mocked
 * `AppState` and a mocked Firestore before it can be asked a single question. So
 * the hook keeps what it must — a timer, a listener, three refs and the run in
 * flight — and every judgement it makes lives in this file as a function over
 * values, where a test can put the exact morning in front of it and read the
 * answer back.
 *
 * The judgements are worth naming, because each one was wrong in a way nobody
 * could see from inside the app:
 *
 *   * **Did anything actually go?** A run can come back a success having sent
 *     nothing at all — an edit that was undone before the run reached it, or a
 *     month with nothing in it. "Last sent today" hung off that answer, so the
 *     card told people their history was safe on the strength of a run that
 *     opened no connection.
 *   * **Is this worth a run?** The half-hour floor between attempts was meant
 *     to stop a phone with no signal retrying on every app switch. It was
 *     applied to every return instead, including a return with new edits
 *     waiting, which is precisely the moment Settings promises "Rin sends
 *     changes when you open it".
 *   * **Does the ledger know this phone?** An empty ledger is not a clean one.
 *     A phone that backed up under a version that had no ledger has nothing
 *     recorded, nothing dirty, and no reason to run — and the card read that
 *     silence as "everything on this phone is in the backup" about months
 *     nothing had ever checked.
 *   * **Did the run finish, or did it merely happen?** The hook kept one marker
 *     for both, and wrote it whether the run came back a success, came back
 *     offline, or never started because the Keychain gave nothing. A run that
 *     got nowhere therefore bought the same half hour of silence as one that
 *     had considered every document on the phone — so the edits made at five
 *     past nine sat there until half past, under a card promising they went the
 *     moment the app was opened. `settled` now means what its name says and
 *     only a finished run writes it; `attempted` and `setbacks` carry the rest.
 *   * **Was that refusal about the document, or about this phone?** Every one
 *     of them was parked in the ledger against the document, where only an edit
 *     to that document brings it back. That is exactly right for a month too
 *     big to send and exactly wrong for an App Check token that expired
 *     mid-run: one expired token refuses everything offered, and a phone that
 *     has already pushed once then has no edit to make and no run to start,
 *     which is a backup that silently stops for good. A refusal the *server*
 *     made is now the session's problem rather than the document's — see
 *     `turnedAway` — and it is retried on a climbing floor instead of parked.
 *     Taking the park off is only half of it, and the half that was missing is
 *     the half nobody could see: once the park is off, the ledger no longer
 *     knows those documents did not go, so a run that was refused everything
 *     may not be allowed to call this phone accounted for, and what it was
 *     refused has to be a reason to run in its own right. Both are below, and
 *     between them they are the difference between an install refused for an
 *     afternoon and one refused for good.
 */

/**
 * How long the phone has to sit still before a run. Long enough that a burst of
 * ticks, or a paragraph being typed into a month, costs one upload rather than
 * one per keystroke; short enough that putting the phone down counts as leaving.
 */
export const IDLE_MS = 30_000;

/**
 * The floor between a *finished* run and carrying the identical set again.
 *
 * A run that considered every document on the phone and left this exact set
 * behind has already had its answer about it — a month the rules will not take,
 * a record this phone cannot vouch for — and asking again on every return from
 * the background would be a request per app switch, all day, none of which can
 * say anything new.
 *
 * It is deliberately not a floor between attempts in general, and two things
 * step around it. Something newly edited has never been offered to anybody, so
 * nothing about the last run predicts what this one would do; and an attempt
 * that got *nowhere* settled nothing at all, so it earns the far shorter
 * `SETBACK_MS` below rather than this. Holding either of them back for half an
 * hour is the app quietly breaking the one promise it makes out loud.
 */
export const RETRY_MS = 30 * 60_000;

/**
 * The floor under any two attempts at all, new edits or not.
 *
 * This is the guard the half-hour throttle was doing a second job as. A cold
 * start is a mount and a foreground within a tick of each other; flicking
 * through the app switcher, or answering a notification and coming back,
 * produces a handful of returns in a couple of seconds. None of them is new
 * information, and a few seconds of quiet costs nothing anybody would notice.
 */
export const BURST_MS = 3_000;

/**
 * How long to wait after an attempt that got nothing through, by how many of
 * those have happened in a row.
 *
 * The list is short and it stops climbing, which is the whole design. An
 * attempt gets nowhere for reasons that are almost always somewhere else and
 * almost always brief — a tunnel, a captive portal, an App Check token that
 * expired between two writes, a minute of rate limiting — so the first retry is
 * soon. But "somewhere else" can also mean a project misconfigured for a week,
 * and a phone that keeps asking every two minutes for a week is a phone with a
 * flat battery, so the wait climbs and then settles at the ordinary half hour
 * and stays there. It never becomes never: that is the state this whole change
 * exists to make unreachable.
 */
export const SETBACK_MS = [2 * 60_000, 10 * 60_000, RETRY_MS] as const;

/**
 * How long a run has to wait after `setbacks` attempts in a row got nowhere.
 *
 * Zero for a phone whose last attempt finished, which makes this gate vanish
 * rather than needing to be skipped: nothing has gone wrong, so nothing here
 * has anything to say.
 */
export function setbackFloor(setbacks: number): number {
  if (setbacks <= 0) return 0;
  return SETBACK_MS[Math.min(setbacks, SETBACK_MS.length) - 1];
}

// --- what Settings is shown -------------------------------------------------

/**
 * A document the server would not take.
 *
 * `reason` is absent rather than guessed on a phone that hasn't tried since it
 * started: the ledger knows a January is stuck, and only a run this session can
 * say whether that is because it is too big or because the server turned the
 * whole install away. Those two want opposite things said to the user, so the
 * missing case is a third wording rather than a coin toss between them.
 */
export interface Refusal {
  /** the document's name on the server: `2026-09`, `current`, `2024` */
  key: string;
  reason?: BlockedDoc['reason'];
  /** for a month that will not fit, which part of it is the bulk */
  detail?: string;
}

/** Everything the Settings card needs to describe the backup honestly */
export interface BackupStatus {
  /** documents this phone holds that the backup does not, refusals aside */
  waiting: string[];
  /** what the server turned down, with a reason where this launch has one */
  blocked: Refusal[];
  /**
   * Whether anything has ever checked this phone against the backup.
   *
   * False is not a problem to report; it is permission withheld. The card may
   * say what is waiting and what is stuck whatever this reads, but it may only
   * assert that the phone and the backup agree when this is true. See
   * `isReconciled` for what earns it.
   */
  reconciled: boolean;
}

/** Stable identity for the state before anything is known, and for no code at all */
export const NOTHING: BackupStatus = { waiting: [], blocked: [], reconciled: false };

/**
 * Has anything ever accounted for this phone against the backup it holds a code
 * for?
 *
 * The question exists because an empty ledger reads exactly like a settled one:
 * nothing waiting, nothing stuck, nothing recorded. Those are the same silence
 * from a phone that has just been updated from a version with no ledger in it —
 * whose months may never have been sent — and from a phone that has genuinely
 * sent everything. The first must not be described as the second.
 *
 * Three things earn it, and each is a statement that something looked:
 *
 *   * a run finished during this launch, which is the strongest of them: a
 *     finished run has considered every document on the phone and put each one
 *     into pushed, unchanged, skipped or blocked, so even a phone with nothing
 *     on it is accounted for;
 *   * a digest, which is this phone saying what it believes is on the server
 *     under a named document;
 *   * a recorded push, which is the same claim with a date on it.
 *
 * A binding on its own earns nothing. `loadLedgerFor` writes one before the run
 * it belongs to has reached the network, so a first run that dies offline leaves
 * a ledger that is bound, empty, and knows nothing whatsoever.
 */
export function isReconciled(ledger: Ledger, accounted: boolean): boolean {
  if (accounted) return true;
  if (ledger.binding === null) return false;
  return ledger.lastPushAt !== null || Object.keys(ledger.digests).length > 0;
}

/**
 * The ledger, plus what this launch knows that the ledger cannot hold, as the
 * card reads it.
 *
 * `refusals` is why a document is stuck, which the ledger deliberately does not
 * store: it remembers the keys across launches, but a reason recorded weeks ago
 * could easily be wrong now, so a phone that has not run since it started says
 * what it can see and leaves the reason out.
 */
export function statusOf(
  ledger: Ledger,
  refusals: ReadonlyMap<string, BlockedDoc>,
  accounted: boolean
): BackupStatus {
  /**
   * Two lists, and the second one is why this is not simply `ledger.blocked`.
   *
   * A document the *server* turned away is deliberately not parked in the
   * ledger any more — parking it is what left a phone unable to back up ever
   * again after one expired token — so it is waiting again the moment the run
   * is over and the ledger has nothing to say about it. It still did not go,
   * and the card is the only place anybody will ever hear that, so this launch's
   * memory of the refusal puts it back on the list the ledger no longer holds.
   * Order matters only in that the ledger's own list leads, since those are the
   * refusals that outlive the process.
   */
  const turnedAside = [...refusals.values()]
    .filter((doc) => doc.reason === 'rejected' && !ledger.blocked.includes(doc.key))
    .map((doc) => doc.key);

  return {
    /**
     * Exactly what the trigger below counts, from the same snapshot, so the
     * card cannot reassure somebody about a backup this hook privately knows is
     * behind. It is not the same as "dirty and not blocked": a month edited
     * since the server refused it is waiting again, because the bytes that were
     * turned down are no longer the bytes on the phone.
     */
    waiting: pendingKeys(ledger),
    /**
     * The refusals stand until a run says otherwise, including for a document
     * that is waiting again. The two lists answer different questions — what
     * the last run was refused, and what the next one will carry — and a
     * document can honestly be in both.
     */
    blocked: [...ledger.blocked, ...turnedAside].map((key) => refusals.get(key) ?? { key }),
    reconciled: isReconciled(ledger, accounted),
  };
}

/** Two statuses that stamp the same say the same thing, so the card need not re-render */
export function stampOf(status: BackupStatus): string {
  const blocked = status.blocked.map(
    (doc) => `${doc.key}:${doc.reason ?? ''}:${doc.detail ?? ''}`
  );
  return `${status.waiting.join(',')}|${blocked.join(',')}|${status.reconciled}`;
}

/**
 * Everything the phone has edited, generations and all.
 *
 * The generation is in here rather than just the key because two edits to the
 * same month are two edits: without it, typing all morning into September would
 * look identical on every tick, read as thirty seconds of quiet, and send a
 * half-written month.
 */
export function dirtyStamp(ledger: Ledger): string {
  return Object.entries(ledger.dirty)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, generation]) => `${key}:${generation}`)
    .join(',');
}

// --- did anything actually go? ----------------------------------------------

/**
 * Did this run put bytes on the server?
 *
 * The only thing allowed to move the "last sent" date, and a narrower question
 * than "did the run succeed". A run that finds an edit was undone before it got
 * there, or that steps over a month nobody has written in, is a complete
 * success that opened no connection and changed nothing on the server. Dating
 * the backup from it says the whole phone went up this morning on the strength
 * of a run that sent nothing.
 *
 * A partial run does count. Bytes reaching the server is bytes reaching the
 * server, whatever else was refused alongside — and the card leads with what is
 * stuck rather than with the date, so there is no reading in which this quietly
 * covers a refusal.
 */
export function sentAnything(result: BackupRun | null): boolean {
  return result !== null && result.ok && result.pushed > 0;
}

// --- what the run was refused, and by whom -----------------------------------

/**
 * The documents a run reported stuck that were refused by the *server* rather
 * than judged by this phone.
 *
 * This distinction is the whole of the second fix, and it is a distinction about
 * who said no and what would change the answer. `too-large` is a fact about the
 * bytes: that month is over the cap in the rules and every run will be told so
 * until somebody shortens it. `unreadable` and `incomplete` never reached a
 * server at all — this phone read its own copy, could not vouch for it, and
 * declined to put it on the wire. All three are properly parked against the
 * document, because the document is what has to change.
 *
 * `rejected` is none of that. It is the server declining to talk to this
 * install: an App Check token that expired between two writes, a rate limit, a
 * project misconfigured for an afternoon. Nothing about the month is wrong and
 * no edit to it makes any difference — and one of those answers arrives for
 * every document the run offers, not for one of them. Parked, that is a phone
 * with every document individually stuck, nothing counted as waiting, no run to
 * start, and therefore no way back short of editing every month by hand. So the
 * park comes off these, and the climbing floor in `SETBACK_MS` takes over.
 */
export function turnedAway(blocked: readonly BlockedDoc[]): string[] {
  return blocked.filter((doc) => doc.reason === 'rejected').map((doc) => doc.key);
}

// --- what a run leaves behind -----------------------------------------------

/**
 * What the hook remembers between runs.
 *
 * None of it is written down. `settled` and `attempted` are facts about this
 * process, and `refusals` is deliberately not persisted — the ledger remembers
 * *which* documents are stuck across launches, because that survives being
 * turned off overnight, but a reason recorded weeks ago could easily be wrong
 * now.
 */
export interface RunMemory {
  /**
   * The dirty stamp the last *finished* run left behind, empty before any run
   * has finished. A finished run is one that got a real answer about everything
   * it offered — see `aftermath` for why a run the server turned away is not
   * one, however cleanly it came back.
   */
  settled: string;
  /** The dirty stamp the last attempt of any kind left behind, finished or not */
  attempted: string;
  /** How many attempts in a row have got nothing through at the far end */
  setbacks: number;
  /** Why each document is stuck, as far as this launch knows */
  refusals: ReadonlyMap<string, BlockedDoc>;
  /**
   * Whether a run has finished and accounted for every document on this phone.
   *
   * A run the server turned away does not earn it, however cleanly it came
   * back, and that is the difference between recovering from an expired token
   * and never backing up again. `accounted` is what lets `isReconciled` say a
   * phone with an empty ledger has been checked — so a first backup that was
   * refused everything would otherwise leave a ledger that knows nothing, a
   * launch that claims to have checked it, and no reason to ever run again.
   */
  accounted: boolean;
}

/** The state before anything has been attempted */
export const NO_RUNS: RunMemory = {
  settled: '',
  attempted: '',
  setbacks: 0,
  refusals: new Map(),
  accounted: false,
};

/** Everything the hook does once a run is over, decided as a value */
export interface Aftermath {
  memory: RunMemory;
  /**
   * Documents to take the park off in the ledger, because the refusal was about
   * this install and not about them. See `turnedAway`.
   */
  unpark: string[];
  /** Whether bytes reached the server, which is the only thing that dates a backup */
  dated: boolean;
}

/**
 * What the hook should remember, now that the run is over.
 *
 * A value rather than five assignments in the hook, because the bug this closes
 * was one of those assignments sitting outside the guard that governed the
 * other four: a run that never got out still wrote the marker that says "this
 * exact set has been considered", and so bought half an hour of silence for
 * edits nothing had looked at.
 *
 * So the guard is spelled out once, here, and it is narrower than `ok`. A run
 * that came back a success having had every document it offered turned away by
 * the server has considered nothing and settled nothing; it is the same
 * setback as never having got out, and it is treated as one. What `ok` does
 * still earn on its own is `accounted` — every document on the phone really was
 * looked at and sorted — and the refusal list the card reads.
 *
 * `stamp` is the dirty stamp of the ledger as it reads once the run is over.
 */
export function aftermath(
  before: RunMemory,
  result: BackupRun | null,
  stamp: string
): Aftermath {
  const finished = result !== null && result.ok;
  const unpark = finished ? turnedAway(result.blocked) : [];
  /**
   * Nothing was gained at the far end: either the run never got out, or it got
   * out and was refused everything it offered. Both leave every question this
   * run was asked still open, and both are worth trying again long before half
   * an hour is up.
   */
  const stalled = !finished || unpark.length > 0;

  return {
    memory: {
      settled: stalled ? before.settled : stamp,
      // Written whatever happened, because it is a fact about what happened:
      // this exact set was carried to the point of an answer, or to the point
      // of failing to get one. It is what keeps a phone with no signal from
      // trying again on every flick through the app switcher.
      attempted: stamp,
      setbacks: stalled ? Math.min(before.setbacks + 1, SETBACK_MS.length) : 0,
      // A failed run knows nothing new about why anything is stuck, so what the
      // last finished one found out stands until something replaces it.
      refusals: finished ? new Map(result.blocked.map((doc) => [doc.key, doc])) : before.refusals,
      // Once something has accounted for this phone it stays accounted for. A
      // later run that dies offline has not un-checked anything — and a run
      // that was turned away has not checked anything either, which is the same
      // `stalled` the two lines above are governed by and for the same reason.
      accounted: before.accounted || !stalled,
    },
    unpark,
    dated: sentAnything(result),
  };
}

// --- is this worth a run? ---------------------------------------------------

/**
 * What started the question.
 *
 * `opened` is the app being brought back — a mount, or a return from the
 * background. It is a person arriving, so it is allowed to interrupt nothing
 * and to wait for nothing.
 *
 * `idle` is the timer: the phone lying on a desk with the app still on screen.
 * It has to decide for itself whether the moment is quiet, which is what `seen`
 * is for.
 */
export type Trigger = 'opened' | 'idle';

/** Everything the decision below is allowed to look at */
export interface Moment {
  /** the ledger as it reads right now */
  ledger: Ledger;
  /** whether a run has finished and accounted for this phone since launch */
  accounted: boolean;
  /** the dirty stamp at the previous look, which only the idle timer keeps */
  seen: string;
  /** the dirty stamp the last finished run left behind, empty before any run */
  settled: string;
  /** the dirty stamp the last attempt left behind, whether or not it finished */
  attempted: string;
  /** how many attempts in a row have got nothing through at the far end */
  setbacks: number;
  /**
   * How many documents this launch knows the server turned this install away
   * from.
   *
   * It is here because the ledger cannot hold the answer. A refusal about the
   * session is deliberately not parked against the document — parking it is
   * what left a phone unable to back up after one expired token — so once the
   * run is over the ledger has nothing to say about those documents at all. For
   * one that was dirty that is fine, since it is waiting again and counted
   * below; for one that was never dirty, this launch's memory of the run is the
   * only place the refusal exists, and without it the phone would sit there
   * reconciled, with nothing waiting, over documents that did not go.
   */
  turnedAway: number;
  /** how long ago a run was last attempted, in milliseconds */
  since: number;
}

/**
 * Should this trigger start a run?
 *
 * In order, and the order matters:
 *
 *   1. A phone with nothing waiting, whose ledger can account for what is on
 *      it, is the ordinary case and has to cost nothing at all — no request, no
 *      anonymous sign-in, not even a code read out of the Keychain. Everything
 *      below this line assumes there is a reason to be here. A document the
 *      server turned this install away from is such a reason even though the
 *      ledger no longer names it: nothing about it has been answered, and it is
 *      the only thing standing between "one expired token" and a phone that has
 *      quietly stopped backing up.
 *   2. A couple of seconds of quiet between any two attempts, which is all the
 *      protection a burst of app-switcher returns needs.
 *   3. The idle timer only fires into stillness. A stamp that moved since the
 *      last look is somebody mid-sentence, and the next tick will ask again.
 *   4. Half an hour before carrying the identical set a second time, once a run
 *      has finished and left that exact set behind. A set that has changed is
 *      new information and goes immediately, whichever trigger is asking — that
 *      is the promise Settings makes about opening the app.
 *   5. And when the last attempt got nowhere, a floor of its own, which starts
 *      at two minutes and climbs. This used to be step 4 doing a second job it
 *      was far too slow for: a run that died offline at six minutes past nine
 *      left the marker saying the set had been considered, so the edits made a
 *      minute earlier sat on the phone until half past, while the card in front
 *      of somebody said Rin sends changes when you open it.
 */
export function shouldRun(trigger: Trigger, moment: Moment): boolean {
  const nothingWaiting = pendingCount(moment.ledger) === 0 && moment.turnedAway === 0;
  if (nothingWaiting && isReconciled(moment.ledger, moment.accounted)) return false;

  if (moment.since < BURST_MS) return false;

  const stamp = dirtyStamp(moment.ledger);
  if (trigger === 'idle' && stamp !== moment.seen) return false;

  if (stamp === moment.settled && moment.since < RETRY_MS) return false;

  // Nothing here has been answered yet — the last attempt left this exact set
  // behind without settling it — so the wait is the short, climbing one rather
  // than the half hour a considered answer earns. `setbackFloor` is zero when
  // the last attempt finished, which is what makes this line disappear on the
  // ordinary path instead of having to be reasoned around.
  if (stamp === moment.attempted && moment.since < setbackFloor(moment.setbacks)) return false;

  return true;
}
