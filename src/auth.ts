import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local account state.
 *
 * There is no server behind this yet — the auth screen is design-complete but
 * nothing is verified and nothing leaves the device. This records who the user
 * says they are so the app has a signed-in state to render, and remembers that
 * the welcome screen has been answered.
 *
 * The password is deliberately never stored. When a backend does arrive it
 * hands back a token, and that is what belongs here — not the credential.
 */
export interface Account {
  name: string;
  email: string;
}

export interface AuthState {
  account: Account | null;
  /** true once the welcome screen has been answered — signed in, or skipped */
  onboarded: boolean;
}

const emptyAuth: AuthState = { account: null, onboarded: false };

const AUTH_KEY = '@monthly-planning/auth';

export async function loadAuth(): Promise<AuthState> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_KEY);
    if (!raw) return emptyAuth;
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    const a = parsed.account;
    return {
      account:
        a && typeof a.name === 'string' && typeof a.email === 'string'
          ? { name: a.name, email: a.email }
          : null,
      onboarded: parsed.onboarded === true,
    };
  } catch {
    return emptyAuth;
  }
}

export async function saveAuth(state: AuthState): Promise<void> {
  try {
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(state));
  } catch {
    // best-effort persistence, matching the rest of the app's stores
  }
}

/** Good enough to catch a typo; real validation is the server's job */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** The name shown when someone signs in without giving one */
export function displayName(account: Account): string {
  return account.name.trim() || account.email.split('@')[0];
}
