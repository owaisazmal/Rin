import AsyncStorage from '@react-native-async-storage/async-storage';
import { PlannerLayout, defaultLayout, parseLayout } from './layout';
import { QuotePrefs, defaultQuotePrefs, parseQuotePrefs } from './quotes';
import type { ColorSchemeName } from 'react-native';
import type { ThemeMode, ThemePreference } from './theme';

/**
 * What the app remembers about how it is shown: which palette, which chart the
 * tracker opens on, which cards the planner carries below the daily check,
 * when it sends reminders, and which quotes it shows. Kept apart from the month store because they change for
 * different reasons and are read at different times — once at launch here, once
 * per month there.
 */

export type ChartType = 'radial' | 'github';

export interface ReminderSlot {
  on: boolean;
  hour: number;
  minute: number;
}

/** The deadline run-up points, in the order `LEADS` in notifications.ts fires them */
export const DEADLINE_LEADS = ['3d', '1d', '3h', '1h', 'due'] as const;
export type DeadlineLead = (typeof DEADLINE_LEADS)[number];

export interface NotificationPrefs {
  habits: boolean;
  slots: ReminderSlot[];
  allDone: boolean;
  deadlines: boolean;
  leads: Record<DeadlineLead, boolean>;
  /** the one nudge the morning after a deadline is missed */
  overdue: boolean;
}

/** 5 a day for 7 days is 35, which fits beside the 28 deadline reminders under iOS's 64 */
export const MAX_SLOTS = 5;

export function defaultNotifications(): NotificationPrefs {
  return {
    habits: true,
    slots: [
      { on: true, hour: 12, minute: 30 },
      { on: true, hour: 17, minute: 30 },
      { on: true, hour: 20, minute: 45 },
    ],
    allDone: true,
    deadlines: true,
    leads: { '3d': true, '1d': true, '3h': true, '1h': true, due: true },
    overdue: true,
  };
}

export interface Settings {
  theme: ThemePreference;
  chart: ChartType;
  layout: PlannerLayout;
  notifications: NotificationPrefs;
  quotes: QuotePrefs;
}

const SETTINGS_KEY = '@monthly-planning/settings';
const DEFAULTS: Settings = {
  theme: 'dark',
  chart: 'radial',
  layout: defaultLayout(),
  notifications: defaultNotifications(),
  quotes: defaultQuotePrefs(),
};

const minutesOf = (s: ReminderSlot) => s.hour * 60 + s.minute;
const byTime = (a: ReminderSlot, b: ReminderSlot) => minutesOf(a) - minutesOf(b);

function isClock(n: unknown, max: number): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max;
}

function parseSlots(raw: unknown): ReminderSlot[] {
  if (!Array.isArray(raw)) return defaultNotifications().slots;
  const slots: ReminderSlot[] = [];
  for (const s of raw as Partial<ReminderSlot>[]) {
    if (!s || !isClock(s.hour, 23) || !isClock(s.minute, 59)) continue;
    slots.push({ on: s.on !== false, hour: s.hour, minute: s.minute });
  }
  return slots.length ? slots.slice(0, MAX_SLOTS) : defaultNotifications().slots;
}

/** Same rule as `loadSettings`: anything missing or unknown takes its own default */
export function parseNotifications(raw: unknown): NotificationPrefs {
  const d = defaultNotifications();
  if (!raw || typeof raw !== 'object') return d;
  const p = raw as Partial<Record<keyof NotificationPrefs, unknown>>;
  const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const leads = (p.leads && typeof p.leads === 'object' ? p.leads : {}) as Record<string, unknown>;
  return {
    habits: flag(p.habits, d.habits),
    slots: parseSlots(p.slots),
    allDone: flag(p.allDone, d.allDone),
    deadlines: flag(p.deadlines, d.deadlines),
    leads: Object.fromEntries(
      DEADLINE_LEADS.map((id) => [id, flag(leads[id], d.leads[id])])
    ) as Record<DeadlineLead, boolean>,
    overdue: flag(p.overdue, d.overdue),
  };
}

/** Sets slot `index`, or adds one when null; a time already taken switches that slot on instead */
export function placeSlot(
  slots: ReminderSlot[],
  index: number | null,
  hour: number,
  minute: number
): ReminderSlot[] {
  const rest = index === null ? slots : slots.filter((_, i) => i !== index);
  const clash = rest.findIndex((s) => s.hour === hour && s.minute === minute);
  if (clash >= 0) return rest.map((s, i) => (i === clash ? { ...s, on: true } : s));
  if (index === null && slots.length >= MAX_SLOTS) return slots;
  const on = index === null ? true : (slots[index]?.on ?? true);
  return [...rest, { on, hour, minute }].sort(byTime);
}

/** Coerced field by field, so an unknown value falls back on its own rather than taking the rest with it */
export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      theme: parsed.theme === 'light' || parsed.theme === 'system' ? parsed.theme : 'dark',
      chart: parsed.chart === 'github' ? 'github' : 'radial',
      layout: parseLayout(parsed.layout),
      notifications: parseNotifications(parsed.notifications),
      quotes: parseQuotePrefs(parsed.quotes),
    };
  } catch {
    return DEFAULTS;
  }
}

/** The mode to draw in; `system` follows the OS and falls back to dark when it gives no answer */
export function resolveTheme(preference: ThemePreference, os: ColorSchemeName | null | undefined): ThemeMode {
  if (preference !== 'system') return preference;
  return os === 'light' ? 'light' : 'dark';
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // best-effort persistence, matching the rest of the app's stores
  }
}
