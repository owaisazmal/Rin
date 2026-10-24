import AsyncStorage from '@react-native-async-storage/async-storage';

// Kept apart from backupState.ts, so making, restoring or forgetting a backup never brings the intro back.
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
