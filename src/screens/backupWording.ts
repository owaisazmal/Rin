import type { BackupRun, BlockedDoc, RestoreRun } from '../sync';
import type { BackupStatus, Damage } from '../hooks/autoBackupPolicy';

/**
 * What the two backup screens are allowed to say, and the words for saying it.
 *
 * This lives outside the screens for the same reason `autoBackupPolicy.ts` lives
 * outside its hook: the suite runs in plain Node, a screen needs a renderer, and
 * every bug this file exists to stop was a sentence rather than a layout. There
 * is nothing to draw in here — it takes a run, or the ledger's account of one,
 * and gives back the lines to put on the card.
 *
 * The bugs are worth naming, because each of them was the app telling somebody
 * something it had no way of knowing:
 *
 *   * **Two months sent, one refused.** Settings said "The backup server turned
 *     this phone away / Nothing new is reaching the backup" while two months
 *     were reaching it perfectly well, and the backup screen printed "nothing
 *     was sent" directly above "2 months are safe". One transient rejection, or
 *     an App Check token expiring halfway through a run, was all it took. A
 *     refusal is now named as the one document it was, and nothing here claims
 *     anything about the documents it was not.
 *   * **"Everything on this phone matches the backup"** was said on the strength
 *     of a ledger with nothing in it, which is also what a phone updated from a
 *     version that had no ledger looks like. That sentence now needs
 *     `reconciled`, and there is a quieter one for the phone that has not been
 *     checked yet.
 *   * **A stuck document was named and then abandoned.** Being told January will
 *     not go up is only half of it; the other half is that writing in January
 *     again is what sends it, which is true of every refusal here and was said
 *     nowhere.
 *   * **A month damaged on the disk was never mentioned at all.** Everything
 *     above is about a document a *run* looked at, and a run only looks at
 *     months whose contents have changed. A September that went bad where it
 *     lay is therefore never offered, never refused, and never named — so the
 *     card said "Everything on this phone is in the backup" over a month it
 *     could not read, while the planner was telling the same person that
 *     writing in it lets go of the part that did not survive. The ledger now
 *     carries what the screens found when they read those records, and
 *     `damagedCard` is where that is said out loud and where the way out is
 *     offered while there is still a whole copy to offer.
 */

// --- the names people use for their own data --------------------------------

/** The document names the backup uses, which is all the ledger records */
const MONTH_KEY = /^\d{4}-\d{2}$/;
const TASK_KEY = /^(current|20\d{2})$/;

/** `2026-09` as somebody would say it out loud; anything else stays as it is */
function monthName(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return key;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

/** A document, by the name the person who wrote what is in it would use */
export function nameOf(key: string): string {
  if (key === 'current') return 'Your open deadlines';
  if (/^20\d{2}$/.test(key)) return `Deadlines you finished in ${key}`;
  return monthName(key);
}

/**
 * "is" or "are" for a name from `nameOf`.
 *
 * Two of the three names it can return are plural — "Your open deadlines" and
 * "Deadlines you finished in 2024" — and a month is not. Every sentence here
 * that puts a name in front of a verb had "is" written into it, so a stuck
 * archive read "Deadlines you finished in 2026 is not reaching the backup".
 * The agreement follows the key rather than the words, because the key is what
 * decides which of the three names came back.
 */
function verbFor(key: string): string {
  return plural(key) ? 'are' : 'is';
}

/** The same agreement in the past tense, for a document the server turned down */
function pastVerbFor(key: string): string {
  return plural(key) ? 'were' : 'was';
}

function plural(key: string): boolean {
  return key === 'current' || /^20\d{2}$/.test(key);
}

/**
 * The same name where it lands part-way through a sentence.
 *
 * Two of the three names above are prose rather than a proper noun — "Your open
 * deadlines" reads as a heading and is written as one — and every sentence that
 * puts one after a verb had it in mid-air: "Rin could not read Your open
 * deadlines on this phone". A month is a proper noun and keeps its capital
 * wherever it falls, which is why this turns on the key rather than on the
 * letter.
 */
function nameWithin(key: string): string {
  const name = nameOf(key);
  return TASK_KEY.test(key) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

/** Which part of a month `sync` blamed, in the words the app uses for it */
const SECTION: Record<string, string> = {
  observations: 'the notes',
  grid: 'the grid',
  habits: 'the habit list',
  keyGoals: 'the goals',
};

// --- one refusal, four things worth saying about it --------------------------

/**
 * A document that did not go.
 *
 * The reason is optional because the ledger remembers *which* documents are
 * stuck across launches and deliberately not why: a reason recorded weeks ago
 * could easily be wrong now. So a phone that has not run since it started says
 * what it can see and leaves the reason out, which is a fourth thing to say
 * rather than a coin toss between the other three.
 */
interface Refused {
  key: string;
  reason?: BlockedDoc['reason'];
  detail?: string;
}

/**
 * Which refusal to lead with when several are stuck at once.
 *
 * The one somebody can act on comes first. A month that will not fit is a
 * sentence with an instruction in it; a rejection is a fault at my end and
 * nothing anybody deletes will help, so leading with that would send somebody
 * off to shorten a month for no reason at all.
 */
const RANK: Record<string, number> = {
  'too-large': 0,
  unreadable: 1,
  // Beside `unreadable` rather than behind `rejected`, because it is the same
  // kind of thing: nothing was refused, because nothing was offered. Left out
  // of this map it sorted last, behind the one refusal nobody can do anything
  // about, and a phone whose September was half readable led with an unrelated
  // rejection instead.
  incomplete: 1,
  rejected: 2,
};

function leading(blocked: readonly Refused[]): Refused {
  // stable, so equally actionable refusals stay in the order the run found them
  return [...blocked].sort((a, b) => (RANK[a.reason ?? ''] ?? 3) - (RANK[b.reason ?? ''] ?? 3))[0];
}

/** The others, counted rather than listed, and never claimed to share a cause */
function alsoStuck(count: number): string {
  if (count === 1) return ' One more is stuck as well.';
  return count > 1 ? ` ${count} more are stuck as well.` : '';
}

/**
 * What somebody can actually do about a document that will not fit.
 *
 * `subject` is only ever "it" or "that month", and it is a parameter because the
 * sentence lands in two places: straight after the month has been named, where
 * "it" is obvious, and under a card title that named it a line earlier, where
 * "it" has drifted far enough to be worth saying again.
 */
function shorten(key: string, detail: string | undefined, subject = 'it'): string {
  // not "finished deadlines": the open list carries its own weight, and a year
  // that will not fit is finished deadlines by definition
  if (TASK_KEY.test(key)) return 'Deleting deadlines you no longer need will let it through.';
  const bulk = SECTION[detail ?? ''];
  return bulk
    ? `Shortening ${bulk} in ${subject} will let it through.`
    : `Fewer notes in ${subject} will let it through.`;
}

/**
 * What brings a stuck document back into the queue.
 *
 * This is the half that used to be missing. A refusal is remembered against the
 * generation it happened at, so the document stays quiet while it is the same
 * bytes that were turned down and is waiting again from the next edit onwards —
 * which means the way out of a refusal is to change the thing that was refused.
 * Nobody could have guessed that from a card that only named it.
 */
function revive(key: string): string {
  return TASK_KEY.test(key)
    ? 'Changing a deadline will send the list again.'
    : 'Writing in that month again will send it.';
}

/**
 * The way out of a damaged month that does not cost the good copy.
 *
 * `revive` above is the other one, and it is the trap this exists to open. A
 * month this phone could not read in full is drawn from the survivors and never
 * sent, which keeps the whole copy safe on the server — right up until somebody
 * takes the card's advice and writes in the month, at which point the thinned
 * version is an ordinary healthy record and the next run carries it over the
 * better one. Pulling the month back down is the same repair made in the
 * direction that keeps the data.
 *
 * It says what it costs in the same breath as what it does. A restore is a
 * replacement — that is the whole of what a restore is — so anything typed into
 * that month since the record went bad goes with the record, and somebody
 * choosing between the two ways out has to be told that before they choose.
 */
function pullBack(): string {
  return "Restoring that month puts the backup's copy on this phone in place of the damaged one, and anything written in it since the damage goes with it.";
}

/**
 * The same month when there is nothing to pull back.
 *
 * A backup that has never held that month cannot repair it, and offering a
 * restore that would answer `missing` is worse than offering nothing. What is
 * true instead is bleaker and has to be said anyway: the damaged copy is the
 * only copy there is, so the write the planner allows is not a risk to weigh
 * against a better option — it is the only way forward.
 */
function onlyCopy(): string {
  return "The backup does not hold that month, so this phone's copy is the only one there is. Writing in it again is the only way forward: that saves what is on screen and lets go of the rest.";
}

/**
 * What a record this phone could not vouch for actually lost, named.
 *
 * `detail` arrives from the vouched read already in the words somebody would
 * use — `2 of 12 habits`, `1 grid entry`, `1 of 2 deadlines`, several of them
 * joined by commas when dropping a habit dropped its marks with it. The fallback
 * is for a refusal remembered from a run this launch never saw, where the reason
 * survived and the detail did not.
 */
function lost(detail: string | undefined): string {
  return detail ? `${detail} did not survive` : 'part of it did not survive';
}

// --- what the planner says over a record it must not write back --------------

/** The two records a screen both draws and saves, in the words for saying so */
export type DamagedRecord = 'month' | 'deadlines';

/**
 * The line shown over a month or a deadline list this phone could not read in
 * full.
 *
 * It belongs beside the sentences above rather than in the planner because it
 * is the same sentence at the other end of the same rule: a record that only
 * half survived being read is not written back, so the parts that did not
 * survive stay on the disk where a later version might yet make sense of them.
 * The cost is that typing into that month does nothing, and the one thing an
 * app may not do is take what somebody writes and quietly drop it.
 *
 * Nothing here mentions the backup unless there is something to be done about
 * it. The damage is on this phone whether or not a backup exists, so the
 * default says nothing about one — but a caller that knows the backup holds
 * this month knows the one thing that changes what the sentence below is advice
 * to do, and staying quiet would leave somebody typing over a record they could
 * have had back whole. `restorable` is that knowledge, and it is a parameter
 * rather than something read here because the planner is the screen that has
 * it.
 *
 * One clause and no more when it is set. This notice sits over somebody's
 * month, above the grid they opened the app to look at; the case for pulling
 * the month back, and the price of doing it, belong on the card in Settings
 * where there is room to make them properly.
 */
export function damagedNotice(record: DamagedRecord, restorable = false): string {
  const subject = record === 'month' ? 'all of this month' : 'all of your deadlines';
  const it = record === 'month' ? 'this month' : 'this list';
  /**
   * Months alone. There is no way to pull one deadline list down over another —
   * the archive travels as several documents and arrives as one flat list — so
   * a deadline notice carrying this would point at a door that is not there.
   */
  const back =
    record === 'month' && restorable
      ? " Settings can put the backup's copy of this month back instead."
      : '';
  // Says what the app actually does, which changed when the write guard moved
  // from "is this record damaged" to "did a person ask for this write". Merely
  // opening the record leaves the disk alone; typing in it saves, because a
  // record nobody can edit is a record nobody can rescue, and the backup card
  // sends people here to do exactly that. What it must not do is let someone
  // type over the rest of it without knowing that is what they are doing.
  return `Rin could not read ${subject} on this phone, so what you see is only the part that survived. Opening ${it} changes nothing on the disk, but writing in it saves what is on screen — which also lets go of the part that did not.${back}`;
}

// --- the card in Settings ----------------------------------------------------

export interface Card {
  title: string;
  body: string;
  /**
   * Something needs looking at. The reassuring states are deliberately quiet —
   * this is the one that should not be, or it would read as more of the same.
   */
  attention: boolean;
  /**
   * Whether the card should offer to try the whole thing again now.
   *
   * True whenever something is stuck, and it is not a duplicate of the button
   * beside it. Every sentence below names an edit as the way back, because an
   * edit is what un-parks a document in the ledger — but two of the four
   * refusals are not fixed by editing anything. A server that turned this
   * install away is fixed by asking again later, and a month that was too large
   * this morning may have been shortened by hand or by deleting a photo-length
   * paragraph the app never saw as an edit. Without this the only way out of
   * either was to type something into a month for the sake of typing it.
   */
  retry: boolean;
  /**
   * The month to offer to pull back down from the backup, by its document name,
   * or null when there is nothing to offer.
   *
   * Only ever set for a month this phone could not read in full *and* that the
   * backup is known to hold, which is exactly the state in which the advice
   * beside it — write in the month again — costs somebody the better copy. It
   * is a key rather than a flag because whoever draws the card has to name the
   * document when they ask for it.
   */
  restore: string | null;
}

/**
 * The document names the backup is known to hold, or null when nothing has
 * looked.
 *
 * The three cases are three different sentences on the card, and the difference
 * between the last two is the whole reason this is not simply a list. A name
 * that is missing from a list somebody actually compiled means the backup does
 * not hold that month, and the card says so out loud and withdraws the offer; a
 * name missing because nothing has checked means nothing at all, and a card
 * that treated the two alike would tell somebody their month exists nowhere but
 * this phone on the strength of never having asked.
 *
 * So null is the answer for a caller that has not looked, and an empty list is
 * a claim that the backup holds nothing. Any caller passing a list is asserting
 * it is complete.
 */
export type BackupHolds = readonly string[] | null;

/**
 * Whether the stuck document can be pulled back down instead of written over.
 *
 * `unknown` is the state everything was in before this existed, and it is what
 * a deadline list gets in every case: the archive travels as several documents
 * and lands as one flat list, so there is no such thing as restoring one of
 * them over the copy on this phone, and the way out stays the edit.
 */
type WayOut = 'restore' | 'only-copy' | 'unknown';

function wayOut(key: string, holds: BackupHolds): WayOut {
  if (holds === null || !MONTH_KEY.test(key)) return 'unknown';
  return holds.includes(key) ? 'restore' : 'only-copy';
}

/**
 * How long ago, said in a way that keeps meaning something.
 *
 * This used to stop counting after a week and fall back to a bare date, which
 * made a backup from 2019 read exactly as calmly as one from Tuesday — the one
 * case where the number is the whole point. So the count carries on to two
 * months, and past that the date comes with the count beside it: the date is a
 * fact, the elapsed time is what somebody needs to notice.
 */
export function whenBackedUp(at: number): string {
  const then = new Date(at);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.floor((midnight.getTime() - then.getTime()) / 86_400_000) + 1;
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 60) return `${days} days ago`;
  const date = then.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${date} (${days} days ago)`;
}

/**
 * Something is stuck, so name it and say what would fix it.
 *
 * What this may not do is describe the rest of the phone. The ledger's blocked
 * list is what the last run was refused and says nothing whatsoever about what
 * that run sent, so "nothing new is reaching the backup" was a guess — and on
 * the ordinary partial run, where two months went up and a third did not, it was
 * simply false. Every sentence below is about the named document or about this
 * phone, which are the two things the card can actually see.
 */
function blockedCard(blocked: readonly Refused[], holds: BackupHolds): Card {
  const lead = leading(blocked);
  const name = nameOf(lead.key);
  // the same name for the titles that put it after a verb rather than first
  const within = nameWithin(lead.key);
  const also = alsoStuck(blocked.length - 1);
  const out = wayOut(lead.key, holds);

  if (lead.reason === 'too-large') {
    return {
      title: `${name} ${verbFor(lead.key)} too large to back up`,
      body: `${shorten(lead.key, lead.detail, 'that month')} Nothing on this phone has been lost.${also}`,
      attention: true,
      retry: true,
      // A month the server would not take is not a damaged one. Everything on
      // this phone is intact and readable, so pulling the backup's copy down
      // over it would delete perfectly good data to fix nothing.
      restore: null,
    };
  }

  /**
   * Nothing was refused here, because nothing was offered: this phone could not
   * read its own copy, so it sent none of it rather than sending an empty
   * document over a good one. Saying "backing up again will say what stopped it"
   * about that would be a promise that the next run says exactly the same thing.
   *
   * The tone is the other half of it, and it took a second pass to get right.
   * This is the app protecting somebody's history, not failing to do its job:
   * the copy in the backup is the good one, and it is still there precisely
   * because this refused to write over it with a damaged one. A card that only
   * reports the damage reads as data already lost, which is the opposite of
   * what has happened.
   *
   * It says "damaged" flatly because it is now only ever true. `sync.ts` used
   * to report a month somebody had deliberately emptied under this same reason,
   * so the card described intact data as damaged and then advised writing in
   * the month again — which would have un-emptied it. That month is carried to
   * the backup now and never arrives here, so the four reasons mean exactly
   * what they say: `unreadable` is a record this phone could not read at all,
   * `incomplete` one it could only half read, and the other two are the server.
   */
  if (lead.reason === 'unreadable') {
    /**
     * Three endings, and they are three different situations rather than three
     * ways of putting one. With a copy in the backup there is a repair that
     * keeps the data and it is offered; with the backup known not to hold the
     * month there is no repair at all and pretending otherwise would send
     * somebody looking for a button that must not exist; and with nothing
     * having looked, the edit is still the honest advice it always was.
     */
    const ending =
      out === 'restore' ? pullBack() : out === 'only-copy' ? onlyCopy() : revive(lead.key);
    return {
      title: `Rin could not read ${within} on this phone`,
      body:
        out === 'only-copy'
          ? `This phone's copy looks damaged, so nothing was sent. ${ending}${also}`
          : `This phone's copy looks damaged, so nothing was sent and the copy in the backup is untouched — Rin is holding on to the good one rather than writing over it with this. ${ending}${also}`,
      attention: true,
      retry: true,
      restore: out === 'restore' ? lead.key : null,
    };
  }

  // The quieter half of the same thing, and the one that needed saying most:
  // the record read perfectly well, it just did not all arrive. What there was
  // to send would have looked entirely healthy on the wire while deleting
  // whatever it had stopped mentioning, which is why naming the loss is the
  // sentence rather than an aside.
  if (lead.reason === 'incomplete') {
    return {
      title: `Rin could only read part of ${within}`,
      body:
        out === 'only-copy'
          ? // The sentence about the backup losing the rest is dropped here
            // rather than reworded, because with no copy up there it is simply
            // not what would have happened: sending the survivors would have
            // put a thin month on a server that held nothing, not deleted a
            // whole one. Still not sent, and for the same reason — a backup
            // made from this would hold no more than this phone can read.
            `Reading it here, ${lost(lead.detail)} — so nothing was sent. ${onlyCopy()}${also}`
          : `Reading it here, ${lost(lead.detail)} — so nothing was sent and the copy in the backup is untouched. Sending what was left would have dropped the rest from the backup too, without a word. ${out === 'restore' ? pullBack() : revive(lead.key)}${also}`,
      attention: true,
      retry: true,
      restore: out === 'restore' ? lead.key : null,
    };
  }

  if (lead.reason === 'rejected') {
    return {
      title: `${name} ${verbFor(lead.key)} not reaching the backup`,
      body: `The server turned it down, which is a fault at my end rather than anything you did. Everything is still here on this phone, Rin will keep trying this on its own, and backing up again will try it again now.${also}`,
      attention: true,
      retry: true,
      // Nothing on this phone is damaged; the server declined to take a
      // perfectly readable month. There is nothing here to repair.
      restore: null,
    };
  }

  // No run since this phone started, so the ledger's memory of what is stuck is
  // all there is. It is worth showing — it outlives the process, which is the
  // point of writing it down — but the reason is a question only a run answers.
  return {
    title: `${name} ${verbFor(lead.key)} not reaching the backup`,
    body: `Everything is still here on this phone. Backing up now will say what stopped it.${also}`,
    attention: true,
    retry: true,
    // Whether this is damage or a refusal is the question a run answers, and
    // until one has, offering to overwrite the month would be offering to
    // delete a good one on a guess.
    restore: null,
  };
}

// --- the card for a record this phone cannot read off its own disk -----------

/**
 * Which damaged document to lead with when more than one is.
 *
 * The one with a way out comes first, for the same reason `RANK` puts the
 * oversized month ahead of the rejection: the card has room for one document,
 * and leading with the one nothing can be done about buries the only offer on
 * the screen. Stable otherwise, so the ledger's own order — which is sorted,
 * so oldest month first — decides between two that are equally answerable.
 */
function leadDamaged(damaged: readonly Damage[], holds: BackupHolds): Damage {
  return [...damaged].sort(
    (a, b) =>
      (wayOut(a.key, holds) === 'restore' ? 0 : 1) - (wayOut(b.key, holds) === 'restore' ? 0 : 1)
  )[0];
}

/**
 * This phone is holding a record it cannot read in full, and no run said so.
 *
 * Deliberately its own card rather than a fifth reason on `blockedCard`, and
 * the difference is what the card is allowed to offer. A refusal is something
 * the server and this phone are still working out, and every one of them ends
 * with "try it again" being worth a press. This is the phone's own copy being
 * short, which no run can mend and no retry can touch: the next run reads the
 * same damaged record and declines to send it for the same reason it declined
 * last time. Offering a retry here would be offering a remedy that cannot work.
 *
 * What it says is the one thing this state actually knows, and it is more
 * reassuring than it sounds. Nothing damaged is ever put on the wire, so
 * whatever the backup holds of that month, it did not come from this. That is
 * not a claim that the copy up there is better — it may be a month older, and
 * nothing here has opened it — only that it is not the copy in front of you,
 * which is exactly the fact that makes pulling it down worth offering.
 */
function damagedCard(
  damaged: readonly Damage[],
  blocked: readonly Refused[],
  holds: BackupHolds
): Card {
  const lead = leadDamaged(damaged, holds);
  // both titles put the name after a verb, so both want the mid-sentence form
  const name = nameWithin(lead.key);
  const out = wayOut(lead.key, holds);
  /**
   * Everything else in trouble, counted by document rather than by entry. The
   * same September can honestly be on both lists — the planner found it on the
   * disk and a run found it on the way to the server — and adding the lists
   * together would tell somebody a second month was in trouble when there is
   * only the one they are reading about.
   */
  const others = new Set([...damaged, ...blocked].map((doc) => doc.key));
  others.delete(lead.key);
  const also = alsoStuck(others.size);

  /**
   * A phrase or no phrase, and they are two different findings rather than one
   * with a gap in it. A note that names what went is a record that parsed and
   * came back short; a note with nothing in it is a record that could not be
   * read at all, or one whose account of itself was too long to keep. Inventing
   * "part of it" for the second would be describing damage nobody measured.
   */
  const opening = lead.lost
    ? `This phone's copy is damaged — ${lead.lost} did not survive.`
    : "This phone's copy is damaged.";

  return {
    title: lead.lost
      ? `Rin could only read part of ${name}`
      : `Rin could not read ${name} on this phone`,
    /**
     * Three endings, and what changes with them is how much the card is
     * entitled to say about the backup. With a listing in hand there is a copy
     * up there and it may say so outright. With nothing having looked it may
     * not, so it says the half that is true either way: whatever the backup
     * holds, it did not come from this. With a listing that came back without
     * the month, there is no copy to talk about at all and the sentence goes.
     *
     * None of the three claims the copy up there is better. It may be a month
     * older, and nothing here has opened it. What makes it worth pulling down
     * is only that it is not this one.
     */
    body:
      out === 'restore'
        ? `${opening} The backup is holding a copy of its own, and it did not come from this one — Rin has never sent a record it could not read. ${pullBack()}${also}`
        : out === 'only-copy'
          ? `${opening} ${onlyCopy()}${also}`
          : `${opening} Rin has never sent a record it could not read, so nothing in the backup came from this damaged copy. ${revive(lead.key)}${also}`,
    attention: true,
    /**
     * Not for the damage, which is what the note above is about — but the
     * button takes the park off everything at once, and if something else on
     * this phone is genuinely stuck then there is something here a retry can
     * still do. The sentence counting it is in the body directly above.
     */
    retry: blocked.length > 0,
    restore: out === 'restore' ? lead.key : null,
  };
}

/**
 * The state of the backup, in one title and one line.
 *
 * Read off the ledger rather than off "a code exists, and here is a date",
 * which is what it used to be and what made it lie. A phone that has just
 * restored had never sent anything, and saying "last saved today" about the
 * moment somebody discovered a five-month-old backup is the worst version of
 * that.
 *
 * The order below is what the card leads with, and it is deliberate: something
 * stuck outranks something waiting, because one of them needs a person and the
 * other only needs a minute. The state nobody had thought about comes last —
 * a ledger that knows nothing is not the same as a phone with nothing to send,
 * and until something has checked, the card says so instead of guessing.
 *
 * Damage leads over all of it, and that is the newest of these decisions. Every
 * refusal below ends by saying everything is still here on this phone, which is
 * true of a refusal and is the one thing that is not true of this; and the
 * advice the refusals give — write in that month again — is what destroys the
 * only remedy a damaged month has. A phone with a rejected August and an
 * unreadable September led with August, counted September nowhere, and so never
 * offered the rescue at all. The document somebody can lose data over comes
 * first.
 */
export function backupCard(
  status: BackupStatus,
  lastBackupAt: number | null,
  holds: BackupHolds = null
): Card {
  if (status.damaged.length > 0) return damagedCard(status.damaged, status.blocked, holds);
  if (status.blocked.length > 0) return blockedCard(status.blocked, holds);

  const sent = lastBackupAt ? ` Last sent ${whenBackedUp(lastBackupAt)}.` : '';

  if (status.waiting.length > 0) {
    const months = status.waiting.filter((key) => MONTH_KEY.test(key)).length;
    return {
      title:
        months === 0
          ? 'Your deadlines are waiting'
          : months === 1
            ? 'One month waiting'
            : `${months} months waiting`,
      body: `Rin sends changes when you open it.${sent}`,
      attention: true,
      retry: false,
      restore: null,
    };
  }

  /**
   * Nothing waiting, nothing stuck, and nothing has ever compared this phone to
   * the backup — which is exactly what a phone updated from a version with no
   * ledger looks like, and what the first frames of any launch look like before
   * the ledger read lands. The months on it may never have been sent. So this
   * says the one true thing there is to say and leaves the reassurance to the
   * run that earns it, which is usually seconds away.
   */
  if (!status.reconciled) {
    return {
      title: 'Backup is on',
      body: `Rin has not checked this phone against the backup yet. It does that when you open the app.${sent}`,
      attention: false,
      retry: false,
      restore: null,
    };
  }

  return {
    title: 'Backed up',
    body: lastBackupAt
      ? `Everything on this phone is in the backup.${sent}`
      : // Nothing has gone from *this* phone — it restored what is up there and
        // has changed nothing since. A date here would be somebody else's.
        'Everything on this phone matches the backup.',
    attention: false,
    retry: false,
    restore: null,
  };
}

// --- what the card needs to be asked before it can be drawn ------------------

/**
 * Is what the backup holds worth a question?
 *
 * Finding out costs a listing — one read, an anonymous sign-in, and the code
 * out of the Keychain — and the rule this app has held to every round is that a
 * phone that is opened and not edited costs none of those. So the answer is
 * fetched for the states whose wording actually turns on it and for no others,
 * and this is the one place that decision is written down: the root effect that
 * does the fetching reads this rather than a condition of its own, because the
 * last time those were two conditions they drifted.
 *
 * Two states qualify, and they are the two ways this phone finds out it cannot
 * read one of its own records — a run that read it on the way to the server,
 * and a screen that read it on the way to the grid. It is deliberately no
 * narrower than "something is stuck": the refusals whose wording ignores the
 * answer are a handful of extra reads on a phone that already has a problem,
 * and a condition that enumerated reasons would be a fourth thing to keep in
 * step with `blockedCard`. It is deliberately no wider either. Nothing waiting,
 * nothing stuck and nothing damaged is the ordinary phone, and it asks nothing.
 */
export function needsHolds(status: BackupStatus): boolean {
  return status.damaged.length > 0 || status.blocked.length > 0;
}

/**
 * The document the card is offering to pull back down, or null when it is
 * offering nothing.
 *
 * Asked of the card itself rather than worked out again beside it, and the
 * throwaway strings are the price of that. Two functions answering "is there a
 * way out of this one" is exactly the shape of every bug in the header above —
 * one of them learns about a case and the other does not — and this one is read
 * on a different screen entirely, so a disagreement would show up as a planner
 * pointing at a button Settings is not drawing.
 *
 * `lastBackupAt` is nothing to do with it: every branch that dates itself is a
 * branch with nothing to restore.
 */
/** Why a single-month restore did not happen, in the words the caller gets back */
export type RestoreFailure = 'offline' | 'rejected' | 'missing' | 'unreadable';

/**
 * What to say when the way out did not work.
 *
 * The card cannot answer this itself: it is read from the ledger, and a restore
 * that never landed leaves the ledger exactly as it was, so the screen redraws
 * unchanged and the tap reads as a button that does nothing. Each of these says
 * what happened and whether waiting will help, because "it failed" on its own
 * would leave somebody pressing it again at a wall.
 */
export function restoreFailure(reason: RestoreFailure): string {
  switch (reason) {
    case 'offline':
      return 'Rin could not reach the backup. Your damaged copy is untouched, so this is safe to try again when you have a connection.';
    case 'rejected':
      return 'The backup server turned this phone away, so nothing was replaced. Rin will keep trying on its own.';
    case 'missing':
      return 'The backup does not hold that month after all, so there was nothing to put back. Your copy is untouched.';
    case 'unreadable':
      return 'The copy in the backup could not be read in full either, so Rin left your copy alone rather than replacing it with less.';
  }
}

export function restoreOffer(status: BackupStatus, holds: BackupHolds = null): string | null {
  return backupCard(status, null, holds).restore;
}

// --- what the backup screen says after a run ---------------------------------

/**
 * The two lines under the button, which have to agree with each other.
 *
 * They are two rather than one because they are read differently: `problem` is
 * the warning above the button and `progress` is the quiet line under it, and a
 * run that half worked genuinely has one of each to say. What they may never do
 * is contradict — "nothing was sent" over "2 months are safe" was one screen
 * saying both halves of an argument it was having with itself.
 */
export interface RunReport {
  /** what the backup holds now, or nothing when saying it would ring hollow */
  progress: string | null;
  /** what is stuck and what to do about it, or nothing when all is well */
  problem: string | null;
}

/** What is stuck, in one sentence, for a run that knows why */
function stuckSentence(blocked: readonly BlockedDoc[], pushed: number): string {
  /**
   * The whole install turned away: every document offered came back refused and
   * not one byte reached the server. This is the only shape that earns "nothing
   * was sent", and checking `pushed` is what stops a single transient rejection
   * from claiming it on behalf of the months that went up beside it.
   */
  if (pushed === 0 && blocked.every((doc) => doc.reason === 'rejected')) {
    return 'The backup server turned this app away, so nothing was sent. That is a setup problem at my end, not yours — nothing on this phone was lost, and what is already in the backup is untouched.';
  }

  const lead = leading(blocked);
  const name = nameOf(lead.key);
  const within = nameWithin(lead.key);
  const also = alsoStuck(blocked.length - 1);
  const bulk = SECTION[lead.detail ?? ''];

  if (lead.reason === 'too-large') {
    // "most of it is the notes" rather than "the notes is most of it", which is
    // what the sentence used to say for two of the four sections it names
    return `${name} ${verbFor(lead.key)} too large to back up${bulk ? `, and most of it is ${bulk}` : ''}. ${shorten(lead.key, lead.detail)}${also}`;
  }
  if (lead.reason === 'unreadable') {
    return `Rin could not read ${within} on this phone, so it was not sent and the copy in the backup is untouched. ${revive(lead.key)}${also}`;
  }
  // Without this the sentence fell through to the line below and told somebody
  // the server had turned down a document the server was never offered.
  if (lead.reason === 'incomplete') {
    return `Rin could only read part of ${within} on this phone — ${lost(lead.detail)} — so it was not sent and the copy in the backup is untouched. ${revive(lead.key)}${also}`;
  }
  return `${name} ${pastVerbFor(lead.key)} turned down by the server. Backing up again will try it again.${also}`;
}

/**
 * What a run did, in the words the screen prints.
 *
 * `months` is what the backup *holds* once the run is over rather than what it
 * sent, so a second run an hour later says the same number instead of "0 months
 * are safe" — and that is also why the count is withheld in the one case where
 * it would read as a boast: a run that put nothing on the wire and was refused
 * everything it offered has no business quoting a total next to the refusal.
 */
export function runReport(run: Extract<BackupRun, { ok: true }>): RunReport {
  const held = run.months === 1 ? 'One month is' : `${run.months} months are`;

  if (run.blocked.length === 0) {
    return {
      progress:
        run.months === 0
          ? 'This phone is backed up. Rin sends new changes whenever you open it.'
          : `${held} safe. Rin sends new changes whenever you open it.`,
      problem: null,
    };
  }

  const silent = run.pushed === 0 && run.blocked.every((doc) => doc.reason === 'rejected');
  return {
    progress: silent || run.months === 0 ? null : `${held} safe.`,
    problem: stuckSentence(run.blocked, run.pushed),
  };
}

/**
 * What a restore did, in the same two lines.
 *
 * A restore that quietly drops things is the same fault in the other direction:
 * a month that would not decrypt and a deadline list that would not open were
 * both stepped over in silence under "3 months are back", which reads as the
 * whole backup arriving. Neither costs anything on this phone — the local copy
 * is left exactly as it was — and both are worth a sentence.
 */
export function restoreReport(run: Extract<RestoreRun, { ok: true }>): RunReport {
  const notes: string[] = [];

  if (run.months === 0 && run.skipped > 0) {
    notes.push('None of the months in this backup could be opened, so no month on this phone was replaced.');
  } else if (run.skipped === 1) {
    notes.push('One month in this backup could not be opened, so it was left out.');
  } else if (run.skipped > 1) {
    notes.push(`${run.skipped} months in this backup could not be opened, so they were left out.`);
  }

  if (run.deadlines === 'unreadable') {
    notes.push('The deadline list in this backup could not be opened, so the deadlines already on this phone were left as they are.');
  }

  /**
   * Half the deadline list arrived, and half of it is the one thing that may
   * not be written: this phone keeps a single list, so pouring in the part that
   * opened is a deletion of everything in the part that did not. It is left
   * alone for the same reason the line above leaves it alone, and it needs its
   * own sentence because "could not be opened" would be false — some of it
   * plainly was, and somebody watching the months arrive would rightly wonder
   * why the deadlines did not follow.
   */
  if (run.deadlines === 'partial') {
    notes.push('Only part of the deadline list in this backup could be opened, so the deadlines already on this phone were left as they are rather than replaced by half a list.');
  }

  return {
    progress:
      run.months === 0
        ? null
        : run.months === 1
          ? 'One month is back.'
          : `${run.months} months are back.`,
    problem: notes.length > 0 ? notes.join(' ') : null,
  };
}
