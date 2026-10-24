import type { BackupRun, BlockedDoc, RestoreRun } from '../sync';
import type { BackupStatus, Damage, Refusal } from '../hooks/autoBackupPolicy';
import { device } from '../device';

// The words the two backup screens use, kept out of the screens so the suite can test them.

// --- the names people use for their own data --------------------------------

const MONTH_KEY = /^\d{4}-\d{2}$/;
/** The deadline documents, whose names are plural prose rather than proper nouns */
const TASK_KEY = /^(current|20\d{2})$/;

/** A document, by the name the person who wrote what is in it would use */
export function nameOf(key: string): string {
  if (key === 'current') return 'Your open deadlines';
  if (TASK_KEY.test(key)) return `Deadlines you finished in ${key}`;
  const [year, month] = key.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return key;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

const is = (key: string) => (TASK_KEY.test(key) ? 'are' : 'is');

/** The name mid-sentence: deadline names lose their capital, a month keeps it */
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
  cards: 'the custom cards',
};

// --- one refusal, four things worth saying about it --------------------------

/** Lead with what somebody can act on; a rejection is a fault at my end */
const RANK: Record<string, number> = {
  'too-large': 0,
  unreadable: 1,
  incomplete: 1,
  rejected: 2,
};

function leading(blocked: readonly Refusal[]): Refusal {
  // stable, so equally actionable refusals stay in the order the run found them
  return [...blocked].sort((a, b) => (RANK[a.reason ?? ''] ?? 3) - (RANK[b.reason ?? ''] ?? 3))[0];
}

/** The others, counted rather than listed, and never claimed to share a cause */
function alsoStuck(count: number): string {
  if (count === 1) return ' One more is stuck as well.';
  return count > 1 ? ` ${count} more are stuck as well.` : '';
}

function shorten(key: string, detail: string | undefined): string {
  if (TASK_KEY.test(key)) return 'Deleting deadlines you no longer need will let it through.';
  const bulk = SECTION[detail ?? ''];
  return bulk
    ? `Shortening ${bulk} in that month will let it through.`
    : 'Fewer notes in that month will let it through.';
}

/** An edit is what brings a stuck document back into the queue */
function revive(key: string): string {
  return TASK_KEY.test(key)
    ? 'Changing a deadline will send the list again.'
    : 'Writing in that month again will send it.';
}

// --- what the planner says over a record it must not write back --------------

type DamagedRecord = 'month' | 'deadlines';

/** The notice over a record this phone could not read in full; `restorable` adds the way out */
export function damagedNotice(record: DamagedRecord, restorable = false): string {
  const subject = record === 'month' ? 'all of this month' : 'all of your deadlines';
  const it = record === 'month' ? 'this month' : 'this list';
  // months only: the deadline archive cannot be pulled down one list at a time
  const back =
    record === 'month' && restorable
      ? " Settings can put the backup's copy of this month back instead."
      : '';
  return `Rin could not read ${subject} on this ${device()}, so what you see is only the part that survived. Opening ${it} changes nothing on the disk, but writing in it saves what is on screen, which also lets go of the part that did not.${back}`;
}

// --- the card in Settings ----------------------------------------------------

interface Card {
  title: string;
  body: string;
  /** something needs looking at */
  attention: boolean;
  /** offer to try everything again now */
  retry: boolean;
  /** the damaged month to offer to pull back down, or null */
  restore: string | null;
}

/** Document names the backup holds, or null when nothing has looked (not the same as empty) */
export type BackupHolds = readonly string[] | null;

/** Deadline lists are always `unknown`: they cannot be restored one at a time */
type WayOut = 'restore' | 'only-copy' | 'unknown';

function wayOut(key: string, holds: BackupHolds): WayOut {
  if (holds === null || !MONTH_KEY.test(key)) return 'unknown';
  return holds.includes(key) ? 'restore' : 'only-copy';
}

/** How long ago; past two months the date comes with the count beside it */
function whenBackedUp(at: number): string {
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

interface Words {
  title: string;
  body: string;
}

// A copy this phone cannot read whole, whether a run or the planner found it; nothing of it was sent.
function damageWords(doc: Refusal, holds: BackupHolds): Words {
  const within = nameWithin(doc.key);
  const partial = doc.reason === 'incomplete';
  const lost = partial ? `: ${doc.detail || 'part of it'} did not survive` : '';
  const out = wayOut(doc.key, holds);
  const ending =
    out === 'restore'
      ? `The backup holds a copy of its own. Restoring that month puts the backup's copy on this ${device()} in place of the damaged one, and anything written in it since the damage goes with it.`
      : out === 'only-copy'
        ? `The backup does not hold that month, so this ${device()}'s copy is the only one there is. Writing in it again is the only way forward: that saves what is on screen and lets go of the rest.`
        : revive(doc.key);
  return {
    title: partial
      ? `Rin could only read part of ${within}`
      : `Rin could not read ${within} on this ${device()}`,
    body: `This ${device()}'s copy is damaged${lost}. Rin never sends a copy it cannot read in full. ${ending}`,
  };
}

/** One stuck document in a title and what follows it; the card and the backup screen both say this */
function stuckWords(doc: Refusal, holds: BackupHolds): Words {
  const name = nameOf(doc.key);
  switch (doc.reason) {
    case 'too-large':
      return {
        title: `${name} ${is(doc.key)} too large to back up`,
        body: `${shorten(doc.key, doc.detail)} Nothing on this ${device()} has been lost.`,
      };
    case 'unreadable':
    case 'incomplete':
      return damageWords(doc, holds);
    case 'rejected':
      return {
        title: `${name} ${is(doc.key)} not reaching the backup`,
        body: `The server turned it down, which is a fault at my end rather than anything you did. Everything is still here on this ${device()}, Rin will keep trying this on its own, and backing up again will try it again now.`,
      };
    default:
      // no run this launch, so the ledger knows what is stuck but not why
      return {
        title: `${name} ${is(doc.key)} not reaching the backup`,
        body: `Everything is still here on this ${device()}. Backing up now will say what stopped it.`,
      };
  }
}

/** Lead with the damaged document that has a way out, as the refusal a run would have found */
function leadDamaged(damaged: readonly Damage[], holds: BackupHolds): Refusal {
  const lead = [...damaged].sort(
    (a, b) =>
      (wayOut(a.key, holds) === 'restore' ? 0 : 1) - (wayOut(b.key, holds) === 'restore' ? 0 : 1)
  )[0];
  return lead.lost
    ? { key: lead.key, reason: 'incomplete', detail: lead.lost }
    : { key: lead.key, reason: 'unreadable' };
}

/** The state of the backup in one title and one line: damage, then stuck, then waiting, then unchecked */
export function backupCard(
  status: BackupStatus,
  lastBackupAt: number | null,
  holds: BackupHolds = null
): Card {
  const { damaged, blocked } = status;
  if (damaged.length > 0 || blocked.length > 0) {
    const lead = damaged.length > 0 ? leadDamaged(damaged, holds) : leading(blocked);
    const { title, body } = stuckWords(lead, holds);
    // by document, since one month can be both damaged and blocked
    const others = new Set([...damaged, ...blocked].map((doc) => doc.key)).size - 1;
    const damage = lead.reason === 'unreadable' || lead.reason === 'incomplete';
    return {
      title,
      body: `${body}${alsoStuck(others)}`,
      attention: true,
      // a retry cannot mend damage: the next run would read the same record and decline again
      retry: blocked.length > 0,
      restore: damage && wayOut(lead.key, holds) === 'restore' ? lead.key : null,
    };
  }

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

  if (!status.reconciled) {
    return {
      title: 'Backup is on',
      body: `Rin has not checked this ${device()} against the backup yet. It does that when you open the app.${sent}`,
      attention: false,
      retry: false,
      restore: null,
    };
  }

  return {
    title: 'Backed up',
    body: lastBackupAt
      ? `Everything on this ${device()} is in the backup.${sent}`
      : // restored and unchanged since, so a date here would be somebody else's
        `Everything on this ${device()} matches the backup.`,
    attention: false,
    retry: false,
    restore: null,
  };
}

/** Whether the card's wording turns on what the backup holds; the ordinary phone asks nothing */
export function needsHolds(status: BackupStatus): boolean {
  return status.damaged.length > 0 || status.blocked.length > 0;
}

/** The month the card offers to pull back, read off the card so the planner cannot disagree with it */
export function restoreOffer(status: BackupStatus, holds: BackupHolds = null): string | null {
  return backupCard(status, null, holds).restore;
}

/** Why a single-month restore did not happen */
export type RestoreFailure = 'offline' | 'rejected' | 'missing' | 'unreadable';

/** A failed restore leaves the ledger unchanged, so the card cannot say this itself */
export function restoreFailure(reason: RestoreFailure): string {
  switch (reason) {
    case 'offline':
      return 'Rin could not reach the backup. Your damaged copy is untouched, so this is safe to try again when you have a connection.';
    case 'rejected':
      return `The backup server turned this ${device()} away, so nothing was replaced. Rin will keep trying on its own.`;
    case 'missing':
      return 'The backup does not hold that month after all, so there was nothing to put back. Your copy is untouched.';
    case 'unreadable':
      return 'The copy in the backup could not be read in full either, so Rin left your copy alone rather than replacing it with less.';
  }
}

// --- what the backup screen says after a run ---------------------------------

/** The warning above the button and the quiet line under it, which must never contradict */
interface RunReport {
  progress: string | null;
  problem: string | null;
}

/** What is stuck, in the card's own words, for a run that sent something or was refused for a reason */
function stuckSentence(blocked: readonly BlockedDoc[]): string {
  const { title, body } = stuckWords(leading(blocked), null);
  return `${title}. ${body}${alsoStuck(blocked.length - 1)}`;
}

/** What a run did; `months` is what the backup holds now, not what this run sent */
export function runReport(run: Extract<BackupRun, { ok: true }>): RunReport {
  const held = run.months === 1 ? 'One month is' : `${run.months} months are`;

  if (run.blocked.length === 0) {
    return {
      progress:
        run.months === 0
          ? `This ${device()} is backed up. Rin sends new changes whenever you open it.`
          : `${held} safe. Rin sends new changes whenever you open it.`,
      problem: null,
    };
  }

  // the whole install turned away, which is the only run that may say nothing was sent
  const silent = run.pushed === 0 && run.blocked.every((doc) => doc.reason === 'rejected');
  return {
    progress: silent || run.months === 0 ? null : `${held} safe.`,
    problem: silent
      ? `The backup server turned this app away, so nothing was sent. That is a setup problem at my end, not yours. Nothing on this ${device()} was lost, and what is already in the backup is untouched.`
      : stuckSentence(run.blocked),
  };
}

/** What a restore did, including what it stepped over */
export function restoreReport(run: Extract<RestoreRun, { ok: true }>): RunReport {
  const notes: string[] = [];

  if (run.months === 0 && run.skipped > 0) {
    notes.push(`None of the months in this backup could be opened, so no month on this ${device()} was replaced.`);
  } else if (run.skipped === 1) {
    notes.push('One month in this backup could not be opened, so it was left out.');
  } else if (run.skipped > 1) {
    notes.push(`${run.skipped} months in this backup could not be opened, so they were left out.`);
  }

  if (run.deadlines === 'unreadable') {
    notes.push(`The deadline list in this backup could not be opened, so the deadlines already on this ${device()} were left as they are.`);
  }

  // this phone keeps one list, so writing half of one would delete the other half
  if (run.deadlines === 'partial') {
    notes.push(`Only part of the deadline list in this backup could be opened, so the deadlines already on this ${device()} were left as they are rather than replaced by half a list.`);
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
