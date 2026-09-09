import type { BackupRun, BlockedDoc } from '../sync';
import { Ledger, pendingCount, pendingKeys, unvouchedKeys, unvouchedNote } from '../syncLedger';

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
 *   * **And does any of that outlive the app being closed?** It did not. All
 *     three of the answers above were facts about one process, so a phone that
 *     was refused and then shut sat down again knowing nothing: the park was
 *     off, the refused documents had no dirty flag of their own to raise, the
 *     ledger was bound and dated, and so nothing was waiting, nothing was
 *     stuck, and the card said everything was in the backup over documents
 *     that had never gone. It is the same silence the park produced, reached
 *     from the other side, and the answer is the same shape as the fix that
 *     caused it: not a per-document park, which is what could not go down
 *     again, but a count of what the last finished run was turned away from —
 *     `turnedAway` on `RunMemory`, written down by `backupRuns` and rewritten
 *     by the next finished run, whether that is up, down, or to nothing.
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

/**
 * A document this phone cannot read in full off its own disk.
 *
 * Deliberately not a `Refusal`, though the card will want to say something
 * about both, because the cause and the way out are opposites. A refusal is the
 * server saying no to bytes this phone was happy with, and it is fixed by
 * trying again — a smaller month, a fresh token, a network that works. This is
 * the phone's own copy being unreadable, which no amount of retrying touches:
 * what fixes it is a whole record, either the copy in the backup put back over
 * it or somebody rewriting the month by hand. Folding the two into one list
 * would have the card offering "try again" for the one thing trying again
 * cannot mend.
 */
export interface Damage {
  /** the document's name on the server: `2026-09`, `current`, `2024` */
  key: string;
  /**
   * What the voucher could not account for — `2 of 12 habits, 1 grid entry`.
   *
   * Absent rather than invented, exactly as `Refusal.reason` is: a record that
   * could not be read at all leaves nothing to count, and a note that outlived
   * the words it was written with is a note the card may name but not
   * describe.
   */
  lost?: string;
}

/** Everything the Settings card needs to describe the backup honestly */
export interface BackupStatus {
  /** documents this phone holds that the backup does not, refusals aside */
  waiting: string[];
  /** what the server turned down, with a reason where this launch has one */
  blocked: Refusal[];
  /**
   * Documents this phone has read and could not understand in full.
   *
   * Not a refusal, and not something waiting either: there is nothing here the
   * backup should be sent, because the only version of one of these documents
   * this phone holds is the part that survived the parse. It is on the card for
   * the opposite reason — the backup may well hold the whole thing, and until
   * this list existed there was no state in which the app ever offered it.
   */
  damaged: Damage[];
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
export const NOTHING: BackupStatus = {
  waiting: [],
  blocked: [],
  damaged: [],
  reconciled: false,
};

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
 * The ledger, plus what the runs know that the ledger cannot hold, as the card
 * reads it.
 *
 * It takes the whole `RunMemory` rather than the two or three fields it happens
 * to need, and that is on purpose. The card and the trigger have to agree about
 * whether this phone is behind, and the way they stopped agreeing last time was
 * a field added to one of two argument lists: `turnedAway` reached `shouldRun`
 * and never reached here, so the card went on saying everything was in the
 * backup about documents the run had just been refused. One argument cannot be
 * half passed.
 *
 * `memory.refusals` is why a document is stuck, which is deliberately not
 * written down anywhere: the ledger remembers the keys it parks across
 * launches, but a reason recorded weeks ago could easily be wrong now, so a
 * phone that has not run since it started says what it can see and leaves the
 * reason out.
 */
export function statusOf(ledger: Ledger, memory: RunMemory): BackupStatus {
  const { refusals, accounted } = memory;
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

  /**
   * What the phone has said about its own copies, read straight off the ledger.
   *
   * It comes from the ledger rather than from a run because that is the entire
   * point of putting it there. A month damaged on disk has not changed, so no
   * run ever picks it up, so no run has anything to say about it — which is how
   * a phone with an unreadable September sat here reading as fully reconciled.
   * The screens write these notes down as they read the records, so the card
   * knows without a run, without a request, and without a sign-in.
   */
  const damaged: Damage[] = unvouchedKeys(ledger).map((key) => {
    const lost = unvouchedNote(ledger, key);
    // an empty phrase is a record nothing survived of, so there is nothing to
    // name and the field is left off rather than filled with an empty string
    return lost ? { key, lost } : { key };
  });

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
    damaged,
    /**
     * Three questions now, and the phone has to pass all of them before the
     * card may say the backup holds everything.
     *
     * `isReconciled` is the older one: has anything ever *looked*? The count is
     * the newer one and it is about a phone that has been looked at and told
     * no. On the launch the refusal happened in, the list above says so out
     * loud and the wording leads with it; on the launch after, all that
     * survives is the count, and without this line the card would fall through
     * to "everything on this phone is in the backup" over exactly the documents
     * that did not go. It says less than it could — it cannot name them, since
     * naming them across launches is the park that could not be lifted — but
     * what it says is true, and a run is usually seconds away from replacing it
     * with something better.
     *
     * And the third is the damage, which is the newest and the plainest. "This
     * phone holds a record it cannot read" and "everything on this phone is in
     * the backup" cannot both be said, and until now the second one was said
     * anyway — over a September with a habit missing, on a card that offered
     * nothing to do about it. The claim is what this withholds, and only the
     * claim: a run is unaffected, because `shouldRun` reads `isReconciled`
     * rather than this and a damaged month is not something to send. What
     * changes is that the card can now name it, and offer the copy in the
     * backup while there is still one to offer.
     */
    reconciled: memory.turnedAway === 0 && damaged.length === 0 && isReconciled(ledger, accounted),
  };
}

/** Two statuses that stamp the same say the same thing, so the card need not re-render */
export function stampOf(status: BackupStatus): string {
  const blocked = status.blocked.map(
    (doc) => `${doc.key}:${doc.reason ?? ''}:${doc.detail ?? ''}`
  );
  // the phrase is in here as well as the key, because a month that was read
  // again and found to have lost more of itself is a card that has to change
  const damaged = status.damaged.map((doc) => `${doc.key}:${doc.lost ?? ''}`);
  return `${status.waiting.join(',')}|${blocked.join(',')}|${damaged.join(',')}|${status.reconciled}`;
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
 * Almost none of it is written down, and the exception is the last field.
 * `settled` and `attempted` are facts about this process, and `refusals` is
 * deliberately not persisted — the ledger remembers *which* documents are stuck
 * across launches, because that survives being turned off overnight, but a
 * reason recorded weeks ago could easily be wrong now.
 *
 * `turnedAway` is the one thing here that has to survive the process, because
 * for a document the server refused it is the only record anywhere that the
 * document did not go. See its own note, and `backupRuns` for where it is kept.
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
  /**
   * How many documents the last finished run was turned away from by the
   * server, and the only field here that is written down.
   *
   * It has to be, because for one of those documents there is nothing else. The
   * park comes off — that is what stops one expired token being permanent — and
   * a document refused without a dirty flag of its own then leaves no trace on
   * disk at all: the ledger reads exactly like a phone that has sent
   * everything. Keeping it in the process meant the phone forgot at the first
   * restart and went quiet for good, which is the same silence the park caused.
   *
   * A count rather than the keys, and that is the whole of why it is safe. It
   * says the phone is behind without saying which document is at fault, which
   * is all either the card or the trigger needs, and it cannot become the
   * per-document silence it replaces: every *finished* run replaces it with
   * what that run was refused, and a finished run refused nothing sets it to
   * zero. It can go down, and it goes down on its own.
   */
  turnedAway: number;
}

/** The state before anything has been attempted */
export const NO_RUNS: RunMemory = {
  settled: '',
  attempted: '',
  setbacks: 0,
  refusals: new Map(),
  accounted: false,
  turnedAway: 0,
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
  /**
   * Whether this run got a real answer, and so may replace what the phone has
   * written down about being turned away.
   *
   * Only a finished run may. An attempt that never got out learned nothing
   * about which documents are on the server, so overwriting the record with its
   * silence would erase the one thing standing between this phone and a backup
   * it never makes again — the same erasure `retryEverything` was written to
   * stop doing before the run.
   */
  answered: boolean;
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
      // Replaced outright by a run that got an answer, and left alone by one
      // that did not. Outright rather than added to: this is what the last
      // finished run was refused, not a tally of every refusal there has ever
      // been, so a server that comes back to its senses takes it to zero in one
      // run and a status that could only climb never exists.
      turnedAway: finished ? unpark.length : before.turnedAway,
    },
    unpark,
    dated: sentAnything(result),
    answered: finished,
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
   * How many documents the phone knows the server turned this install away
   * from.
   *
   * It is here because the ledger cannot hold the answer. A refusal about the
   * session is deliberately not parked against the document — parking it is
   * what left a phone unable to back up after one expired token — so once the
   * run is over the ledger has nothing to say about those documents at all. For
   * one that was dirty that is fine, since it is waiting again and counted
   * below; for one that was never dirty, this count is the only place the
   * refusal exists, and without it the phone would sit there reconciled, with
   * nothing waiting, over documents that did not go.
   *
   * Which is why it is the one thing about a run that is written down. It used
   * to be this launch's memory alone, and a memory is gone by the time somebody
   * opens the app again — so the phone recovered from an expired token only if
   * it was never closed in between, which is not how anybody uses a phone.
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
