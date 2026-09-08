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
import { Sealed, deriveBackupId, deriveKey, open, seal } from './backup';
import { MonthData } from './types';
import { Task, parseTasks } from './tasks';
import { listStoredMonths, parseMonthData, loadMonth, saveMonth } from './storage';
import { loadTasks, saveTasks } from './tasks';

/**
 * Carrying a backup to another phone, and nothing else.
 *
 * This is the only code in the app that touches a network. What it sends is
 * ciphertext and an opaque id; what it never sends is a name, an email, an
 * address book, an identifier that outlives an install, or anything about how
 * the app is used. There is no telemetry here and no room for any: the whole
 * surface is four functions, and all four take a backup code.
 *
 * The anonymous sign-in below is not an account. It creates a throwaway uid
 * that exists so requests carry an App Check token — proof they came from a
 * real install of this app rather than a script — and so Firebase applies its
 * own rate limits. Nothing is filed under that uid, and signing in again on a
 * new phone produces a different one. What identifies a backup is the code,
 * which never leaves the device.
 *
 * Every call is best-effort and returns a result rather than throwing: a
 * backup that fails should say so on the screen that asked for it, never
 * interrupt someone's morning.
 */

/** Months are filed by calendar month, which is what the rules will accept */
function monthDoc(id: string, year: number, month: number) {
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  return doc(getFirestore(), 'backups', id, 'months', key);
}

function tasksDoc(id: string) {
  return doc(getFirestore(), 'backups', id, 'tasks', 'current');
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

/** What a caller gets back: it worked, or it didn't and here is roughly why */
export type SyncResult =
  | { ok: true }
  | { ok: false; reason: 'offline' | 'rejected' | 'unreadable' };

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

/** Writes one month, encrypted. The plaintext never leaves this function. */
export async function pushMonth(
  code: string,
  year: number,
  month: number,
  data: MonthData
): Promise<SyncResult> {
  try {
    await ready();
    const sealed = seal(deriveKey(code), JSON.stringify(data));
    await setDoc(monthDoc(deriveBackupId(code), year, month), {
      ...sealed,
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
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

/** The deadline list travels as one record, since it isn't filed by month */
export async function pushTasks(code: string, tasks: Task[]): Promise<SyncResult> {
  try {
    await ready();
    const sealed = seal(deriveKey(code), JSON.stringify(tasks));
    await setDoc(tasksDoc(deriveBackupId(code)), {
      ...sealed,
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
}

export async function pullTasks(code: string): Promise<RestoreResult<Task[]>> {
  try {
    await ready();
    const snapshot = await getDoc(tasksDoc(deriveBackupId(code)));
    if (!snapshot.exists()) return { ok: false, reason: 'missing' };
    const plaintext = open(deriveKey(code), snapshot.data() as Sealed);
    if (plaintext === null) return { ok: false, reason: 'unreadable' };
    return { ok: true, value: parseTasks(JSON.parse(plaintext)) };
  } catch (error) {
    return { ok: false, reason: reasonFor(error) };
  }
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


/**
 * Everything this phone has, encrypted and sent.
 *
 * Months go one document at a time rather than as one blob, so a phone that
 * loses signal halfway leaves a partial backup that still restores, and so a
 * later backup rewrites only what changed. The first failure stops the run:
 * there is no point pushing thirty more months down a connection that just
 * refused one, and whatever already landed stays valid.
 */
export async function backupEverything(
  code: string
): Promise<{ ok: true; months: number } | { ok: false; reason: 'offline' | 'rejected' }> {
  const months = await listStoredMonths();
  let sent = 0;
  for (const { year, month } of months) {
    const result = await pushMonth(code, year, month, await loadMonth(year, month));
    if (!result.ok) return { ok: false, reason: result.reason === 'rejected' ? 'rejected' : 'offline' };
    sent++;
  }
  const tasks = await pushTasks(code, await loadTasks());
  if (!tasks.ok) return { ok: false, reason: tasks.reason === 'rejected' ? 'rejected' : 'offline' };
  return { ok: true, months: sent };
}

/**
 * Pulls a whole backup down onto this phone, overwriting what is here.
 *
 * Overwriting is the honest behaviour for a restore: someone typing a code
 * into a new phone means "make this phone the other one", and quietly merging
 * two months of the same name would invent a history that never happened. A
 * month that will not decrypt is skipped rather than written blank, so one bad
 * record costs one month instead of the lot.
 */
export async function restoreEverything(
  code: string
): Promise<
  | { ok: true; months: number; skipped: number }
  | { ok: false; reason: 'offline' | 'rejected' | 'missing' }
> {
  const listed = await listMonths(code);
  if (!listed.ok) return { ok: false, reason: listed.reason === 'rejected' ? 'rejected' : 'offline' };
  if (listed.value.length === 0) return { ok: false, reason: 'missing' };

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
      restored++;
    } else if (pulled.reason === 'offline' || pulled.reason === 'rejected') {
      return { ok: false, reason: pulled.reason };
    } else {
      skipped++;
    }
  }

  const tasks = await pullTasks(code);
  if (tasks.ok) await saveTasks(tasks.value);

  return { ok: true, months: restored, skipped };
}
