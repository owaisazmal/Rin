import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeCode } from '../backup';
import { loadCode } from '../backupState';
import { BackupRun, backupEverything } from '../sync';
import { Ledger, clearBlocked, loadLedger } from '../syncLedger';
import { Moment, NO_RUNS, RunMemory, aftermath, dirtyStamp } from './autoBackupPolicy';

// The one sequence of runs this launch makes: the timer, the app returning and the backup button all settle here.

/** When a run was last attempted, which is what the throttles count */
let lastAttemptAt = 0;

let memory: RunMemory = NO_RUNS;

// --- the turned-away count, the one part of memory that survives a relaunch ---

const TURNED_AWAY_KEY = '@monthly-planning/backup-turned-away';

// a bare count; older builds stored `{ count, at }`, which still reads
function parseTurnaway(raw: unknown): number {
  const count = raw !== null && typeof raw === 'object' ? (raw as { count?: unknown }).count : raw;
  return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 0;
}

async function readTurnaway(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(TURNED_AWAY_KEY);
    return raw ? parseTurnaway(JSON.parse(raw)) : 0;
  } catch {
    return 0;
  }
}

async function writeTurnaway(count: number): Promise<void> {
  try {
    await AsyncStorage.setItem(TURNED_AWAY_KEY, JSON.stringify(count));
  } catch {
    // best-effort persistence, matching the rest of the app's stores
  }
}

/** The disk read, once per launch; everything that reads or writes `memory` waits on it */
let established: Promise<void> | null = null;

function establish(): Promise<void> {
  if (established === null) {
    const reading = readTurnaway().then((count) => {
      // a launch that ended mid-read must not get the old backup's count back
      if (established === reading) memory = { ...memory, turnedAway: count };
    });
    established = reading;
  }
  return established;
}

export async function launchMemory(): Promise<RunMemory> {
  await establish();
  return memory;
}

/** What `shouldRun` needs that only this launch knows; a fresh launch has attempted nothing */
export async function launchMoment(): Promise<Omit<Moment, 'ledger' | 'seen'>> {
  return { ...(await launchMemory()), since: Date.now() - lastAttemptAt };
}

/** The process ending: in-memory state goes, what is on disk stays; a run still in the air keeps its guard */
export function endLaunch(): void {
  lastAttemptAt = 0;
  memory = NO_RUNS;
  established = null;
}

/** Forget everything about the current backup, on disk too, after a restore or a forgotten code */
export async function forgetLaunch(): Promise<void> {
  endLaunch();
  // established before the write, so a read in the meantime cannot bring the old count back
  established = Promise.resolve();
  await writeTurnaway(0);
}

// --- runs, and what they meant ----------------------------------------------

export interface Settled {
  /** whether bytes reached the server, which is the only thing that dates a backup */
  dated: boolean;
  /** the ledger once the parks are off, which is what the card is shown */
  ledger: Ledger;
}

/** `retrying` also lifts parks a finished run no longer stands behind */
async function settle(result: BackupRun | null, retrying: boolean): Promise<Settled> {
  await establish();

  const after = await loadLedger();
  const outcome = aftermath(memory, result, dirtyStamp(after));
  memory = outcome.memory;

  // only a run that got an answer may rewrite the count, down as readily as up
  if (outcome.answered) await writeTurnaway(memory.turnedAway);

  // sync parks every refusal; one about the install must not stay parked or backups stop for good
  const lift = [...outcome.unpark];
  // a run steps over a document already on the server without unparking it, so a retry clears what it didn't name
  if (retrying && result?.ok) {
    const named = new Set(result.blocked.map((doc) => doc.key));
    lift.push(...after.blocked.filter((key) => !named.has(key)));
  }
  for (const key of lift) await clearBlocked(key);

  const ledger = lift.length > 0 ? await loadLedger() : after;
  return { dated: outcome.dated, ledger };
}

/** Never throws: a Keychain failure reads as no code at all */
async function savedCode(): Promise<string | null> {
  try {
    return await loadCode();
  } catch {
    return null;
  }
}

/** Never throws: a network failure is just a run that got nowhere */
async function attempt(code: string | null): Promise<BackupRun | null> {
  if (!code) return null;
  try {
    return await backupEverything(code);
  } catch {
    return null;
  }
}

interface Outcome {
  result: BackupRun | null;
  settled: Settled;
}

interface InFlight {
  code: string | null;
  run: Promise<Outcome>;
}

/** The run in the air, by the code it is under; whoever started it does the bookkeeping */
let inFlight: InFlight | null = null;

// The same code shares the run in the air; a different code waits for it to land, then starts.
async function runOnce(code: string | null, retrying = false): Promise<Outcome & { joined: boolean }> {
  const key = code === null ? null : normalizeCode(code) ?? code;
  while (inFlight) {
    const busy = inFlight;
    if (busy.code === key) return { ...(await busy.run), joined: true };
    await busy.run;
  }

  lastAttemptAt = Date.now();
  const started: InFlight = {
    code: key,
    run: (async () => {
      const result = await attempt(code);
      return { result, settled: await settle(result, retrying) };
    })().finally(() => {
      if (inFlight === started) inFlight = null;
    }),
  };
  inFlight = started;
  return { ...(await started.run), joined: false };
}

/** The way in for both triggers; null is a run another caller started, and is accounting for */
export async function runAndSettle(): Promise<Settled | null> {
  const outcome = await runOnce(await savedCode());
  return outcome.joined ? null : outcome.settled;
}

/** The backup screen's way in, under the code on screen, which may not be saved yet */
export async function backupNow(code: string): Promise<BackupRun> {
  // a run that never got out ends the way a lost connection does
  return (await runOnce(code)).result ?? { ok: false, reason: 'offline' };
}

/** "Try again": skips the throttles, and lifts stale parks once a run has reported back */
export async function retryEverything(): Promise<Settled | null> {
  const outcome = await runOnce(await savedCode(), true);
  return outcome.joined ? null : outcome.settled;
}
