import AsyncStorage from '@react-native-async-storage/async-storage';
import { sessionStorage } from './session';

/**
 * Whether this phone has a backup, and the code that reaches it.
 *
 * The code itself is the one secret in the app, so it lives in the Keychain /
 * Keystore through `session.ts` and never in AsyncStorage beside the habit
 * grids. What is kept here instead is the unremarkable part: whether the
 * welcome screen has been answered, and when the last backup finished — enough
 * for Settings to say something true without holding anything worth stealing.
 *
 * Replaces the account record this app used to keep. There are no accounts
 * now: no name, no email, nothing that identifies anyone.
 */

const CODE_KEY = 'backup.code';
const STATE_KEY = '@monthly-planning/backup';

export interface BackupState {
  /** true once the welcome screen has been answered — backed up, or skipped */
  onboarded: boolean;
  /** when the last successful backup finished, epoch milliseconds */
  lastBackupAt: number | null;
}

export const emptyBackupState: BackupState = { onboarded: false, lastBackupAt: null };

export async function loadBackupState(): Promise<BackupState> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (!raw) return emptyBackupState;
    const parsed = JSON.parse(raw) as Partial<BackupState>;
    return {
      onboarded: parsed.onboarded === true,
      lastBackupAt:
        typeof parsed.lastBackupAt === 'number' && Number.isFinite(parsed.lastBackupAt)
          ? parsed.lastBackupAt
          : null,
    };
  } catch {
    return emptyBackupState;
  }
}

export async function saveBackupState(state: BackupState): Promise<void> {
  try {
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // best-effort persistence, matching the rest of the app's stores
  }
}

/** The code this phone backs up with, or null if it has never made one */
export function loadCode(): Promise<string | null> {
  return sessionStorage.getItem(CODE_KEY);
}

export function saveCode(code: string): Promise<void> {
  return sessionStorage.setItem(CODE_KEY, code);
}

/**
 * Forgets the code on this phone. The backup itself is untouched and stays
 * reachable by anyone who still has the code written down — which is the whole
 * point of it, so this deliberately deletes nothing on the server.
 */
export function forgetCode(): Promise<void> {
  return sessionStorage.removeItem(CODE_KEY);
}
