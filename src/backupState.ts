import AsyncStorage from '@react-native-async-storage/async-storage';
import { sessionStorage } from './session';

// The code lives in the Keychain via session.ts; only the unremarkable state goes in AsyncStorage.

const CODE_KEY = 'backup.code';
const STATE_KEY = '@monthly-planning/backup';

export interface BackupState {
  // true once the welcome screen has been answered, backed up or skipped
  onboarded: boolean;
  // when the last successful backup finished, epoch milliseconds
  lastBackupAt: number | null;
}

const emptyBackupState: BackupState = { onboarded: false, lastBackupAt: null };

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

export function loadCode(): Promise<string | null> {
  return sessionStorage.getItem(CODE_KEY);
}

export function saveCode(code: string): Promise<void> {
  return sessionStorage.setItem(CODE_KEY, code);
}

// Deliberately deletes nothing on the server: the backup stays reachable with the code.
export function forgetCode(): Promise<void> {
  return sessionStorage.removeItem(CODE_KEY);
}
