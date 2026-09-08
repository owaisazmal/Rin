import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether the intro has been shown.
 *
 * Kept apart from `backupState.ts` on purpose: making a backup, restoring one
 * and forgetting a code all rewrite that state, and none of them should bring
 * the intro back.
 * It is answered once, by this install, and never again.
 */

const INTRO_KEY = '@monthly-planning/intro-seen';

export async function loadIntroSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(INTRO_KEY)) === '1';
  } catch {
    // unreadable storage shouldn't trap someone on the intro forever
    return true;
  }
}

export async function saveIntroSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(INTRO_KEY, '1');
  } catch {
    // best-effort, matching the rest of the app's stores
  }
}
