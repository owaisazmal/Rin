import { PlannerLayout, parseLayout } from './layout';
import { QuotePrefs, parseQuotePrefs } from './quotes';
import { readJson, writeJson } from './storage';
import { isRecord } from './types';
import type { ColorSchemeName } from 'react-native';
import type { ThemeMode, ThemePreference } from './theme';

/** Every chart the tracker offers, in the picker's order; `github` is the year grid */
export const CHART_TYPES = ['radial', 'github', 'days', 'habits', 'weeks', 'weekdays'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ReminderSlot {
  on: boolean;
  hour: number;
  minute: number;
}

/** The deadline run-up points, in the order `LEADS` in notifications.ts fires them */
const DEADLINE_LEADS = ['3d', '1d', '3h', '1h', 'due'] as const;
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

const minutesOf = (s: ReminderSlot) => s.hour * 60 + s.minute;

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

/** Anything missing or unknown takes its own default */
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
  return [...rest, { on, hour, minute }].sort((a, b) => minutesOf(a) - minutesOf(b));
}

/** Coerced field by field, so an unknown value falls back on its own rather than taking the rest with it */
export function parseSettings(raw: unknown): Settings {
  const p = isRecord(raw) ? raw : {};
  return {
    theme: p.theme === 'light' || p.theme === 'system' ? p.theme : 'dark',
    chart: CHART_TYPES.includes(p.chart as ChartType) ? (p.chart as ChartType) : 'radial',
    layout: parseLayout(p.layout),
    notifications: parseNotifications(p.notifications),
    quotes: parseQuotePrefs(p.quotes),
  };
}

export async function loadSettings(): Promise<Settings> {
  return parseSettings(await readJson(SETTINGS_KEY));
}

/** The mode to draw in; `system` follows the OS and falls back to dark when it gives no answer */
export function resolveTheme(preference: ThemePreference, os: ColorSchemeName | null | undefined): ThemeMode {
  if (preference !== 'system') return preference;
  return os === 'light' ? 'light' : 'dark';
}

export function saveSettings(settings: Settings): Promise<void> {
  return writeJson(SETTINGS_KEY, settings);
}
