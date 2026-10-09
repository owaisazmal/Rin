import AsyncStorage from '@react-native-async-storage/async-storage';
import { PlannerLayout, defaultLayout, parseLayout } from './layout';
import type { ThemeMode } from './theme';

/**
 * The three things the app remembers about how it is shown: which palette,
 * which chart the tracker opens on, and which cards the planner carries below
 * the daily check. Kept apart from the month store because they change for
 * different reasons and are read at different times — once at launch here, once
 * per month there.
 */

export type ChartType = 'radial' | 'github';

export interface Settings {
  theme: ThemeMode;
  chart: ChartType;
  layout: PlannerLayout;
}

const SETTINGS_KEY = '@monthly-planning/settings';
const DEFAULTS: Settings = { theme: 'dark', chart: 'radial', layout: defaultLayout() };

/** Coerced field by field, so an unknown value falls back on its own rather than taking the rest with it */
export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      chart: parsed.chart === 'github' ? 'github' : 'radial',
      layout: parseLayout(parsed.layout),
    };
  } catch {
    return DEFAULTS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // best-effort persistence, matching the rest of the app's stores
  }
}
