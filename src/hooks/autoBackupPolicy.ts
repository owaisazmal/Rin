import type { BackupRun, BlockedDoc } from '../sync';
import { Ledger, pendingCount, pendingKeys, unvouchedKeys, unvouchedNote } from '../syncLedger';

// The pure decisions behind useAutoBackup, kept free of React so the suite can test them.

/** Quiet time before the idle timer sends, so a burst of edits costs one upload */
export const IDLE_MS = 30_000;

/** Floor before carrying the exact set a finished run already answered */
export const RETRY_MS = 30 * 60_000;

/** Floor before trying again after an attempt that got nowhere; runs only happen in the foreground */
export const STALL_MS = 5 * 60_000;

/** Floor between any two attempts, which absorbs app-switcher bursts */
export const BURST_MS = 3_000;

// --- what Settings is shown -------------------------------------------------

/** A document the server would not take; `reason` is absent when no run this launch saw why */
export interface Refusal {
  /** the document's name on the server: `2026-09`, `current`, `2024` */
  key: string;
  reason?: BlockedDoc['reason'];
  /** for a month that will not fit, which part of it is the bulk */
  detail?: string;
}

/** A document this phone cannot read in full; a restore fixes it, a retry never does */
export interface Damage {
  key: string;
  /** what was lost, e.g. `2 of 12 habits`; absent when nothing could be counted */
  lost?: string;
}

export interface BackupStatus {
  /** documents this phone holds that the backup does not, refusals aside */
  waiting: string[];
  /** what the server turned down, with a reason where this launch has one */
  blocked: Refusal[];
  damaged: Damage[];
  /** whether the card may claim the phone and the backup agree */
  reconciled: boolean;
}

/** Stable identity for the state before anything is known, and for no code at all */
export const NOTHING: BackupStatus = {
  waiting: [],
  blocked: [],
  damaged: [],
  reconciled: false,
};

// An empty ledger looks settled, and a bare binding is written before the first run reaches the network.
export function isReconciled(ledger: Ledger, accounted: boolean): boolean {
  if (accounted) return true;
  if (ledger.binding === null) return false;
  return ledger.lastPushAt !== null || Object.keys(ledger.digests).length > 0;
}

export function statusOf(ledger: Ledger, memory: RunMemory): BackupStatus {
  const { refusals, accounted } = memory;
  // server refusals are unparked from the ledger, so only this launch's memory still names them
  const turnedAside = [...refusals.values()]
    .filter((doc) => doc.reason === 'rejected' && !ledger.blocked.includes(doc.key))
    .map((doc) => doc.key);

  const damaged: Damage[] = unvouchedKeys(ledger).map((key) => {
    const lost = unvouchedNote(ledger, key);
    return lost ? { key, lost } : { key };
  });

  return {
    waiting: pendingKeys(ledger),
    blocked: [...ledger.blocked, ...turnedAside].map((key) => refusals.get(key) ?? { key }),
    damaged,
    reconciled: memory.turnedAway === 0 && damaged.length === 0 && isReconciled(ledger, accounted),
  };
}

/** Two statuses that stamp the same say the same thing, so the card need not re-render */
export function stampOf(status: BackupStatus): string {
  const blocked = status.blocked.map(
    (doc) => `${doc.key}:${doc.reason ?? ''}:${doc.detail ?? ''}`
  );
  const damaged = status.damaged.map((doc) => `${doc.key}:${doc.lost ?? ''}`);
  return `${status.waiting.join(',')}|${blocked.join(',')}|${damaged.join(',')}|${status.reconciled}`;
}

/** Every dirty key with its generation, so two edits to one month read as a change */
export function dirtyStamp(ledger: Ledger): string {
  return Object.entries(ledger.dirty)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, generation]) => `${key}:${generation}`)
    .join(',');
}

/** Whether bytes reached the server, which is the only thing that dates a backup */
export function sentAnything(result: BackupRun | null): boolean {
  return result !== null && result.ok && result.pushed > 0;
}

/** Refusals by the server about this install, which no edit to the document would change */
export function turnedAway(blocked: readonly BlockedDoc[]): string[] {
  return blocked.filter((doc) => doc.reason === 'rejected').map((doc) => doc.key);
}

// --- what a run leaves behind -----------------------------------------------

export interface RunMemory {
  /** dirty stamp the last attempt of any kind left behind */
  attempted: string;
  /** whether that attempt got nowhere: never got out, or was turned away */
  stalled: boolean;
  /** why each document is stuck, as far as this launch knows; never persisted */
  refusals: ReadonlyMap<string, BlockedDoc>;
  /** whether a finished run has accounted for every document on this phone */
  accounted: boolean;
  /** documents the last finished run was turned away from; the only field kept on disk */
  turnedAway: number;
}

export const NO_RUNS: RunMemory = {
  attempted: '',
  stalled: false,
  refusals: new Map(),
  accounted: false,
  turnedAway: 0,
};

interface Aftermath {
  memory: RunMemory;
  /** documents to unpark in the ledger, because the refusal was about the install */
  unpark: string[];
  dated: boolean;
  /** whether the run got a real answer, and so may rewrite the persisted turned-away count */
  answered: boolean;
}

/** What to remember once a run is over; `stamp` is the dirty stamp of the ledger after it */
export function aftermath(
  before: RunMemory,
  result: BackupRun | null,
  stamp: string
): Aftermath {
  const finished = result !== null && result.ok;
  const unpark = finished ? turnedAway(result.blocked) : [];
  // never got out, or got out and was refused: either way nothing was answered
  const stalled = !finished || unpark.length > 0;

  return {
    memory: {
      attempted: stamp,
      stalled,
      refusals: finished ? new Map(result.blocked.map((doc) => [doc.key, doc])) : before.refusals,
      accounted: before.accounted || !stalled,
      // replaced outright, not added to, so one good run takes it back to zero
      turnedAway: finished ? unpark.length : before.turnedAway,
    },
    unpark,
    dated: sentAnything(result),
    answered: finished,
  };
}

// --- is this worth a run? ---------------------------------------------------

/** `opened` is a mount or a return from the background; `idle` is the timer */
export type Trigger = 'opened' | 'idle';

export interface Moment extends Omit<RunMemory, 'refusals'> {
  /** the ledger as it reads right now */
  ledger: Ledger;
  /** the dirty stamp at the previous look, which only the idle timer keeps */
  seen: string;
  /** milliseconds since a run was last attempted */
  since: number;
}

export function shouldRun(trigger: Trigger, moment: Moment): boolean {
  // the ordinary phone must cost nothing: no request, no sign-in, no Keychain read
  const nothingWaiting = pendingCount(moment.ledger) === 0 && moment.turnedAway === 0;
  if (nothingWaiting && isReconciled(moment.ledger, moment.accounted)) return false;

  if (moment.since < BURST_MS) return false;

  const stamp = dirtyStamp(moment.ledger);
  // the idle timer only fires into stillness
  if (trigger === 'idle' && stamp !== moment.seen) return false;

  // the same state again waits, briefly after an attempt that got nowhere
  return stamp !== moment.attempted || moment.since >= (moment.stalled ? STALL_MS : RETRY_MS);
}
