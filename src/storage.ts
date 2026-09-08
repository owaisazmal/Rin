import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CellState,
  Habit,
  KeyGoal,
  MAX_HABITS,
  MonthData,
  cellKey,
  emptyMonthData,
} from './types';

function monthKey(year: number, month: number): string {
  // month is 0-based
  return `@monthly-planning/${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * What a stored month is allowed to look like.
 *
 * Until now the only thing that ever wrote a month was this app, so the loaders
 * took the shape on disk more or less on trust. Once months can also arrive
 * from a server that trust is misplaced: a record edited by hand, written by an
 * older client, or planted by whoever got hold of the account must not be able
 * to crash the planner, the history or the widget sync — all of which call
 * `.trim()` on what they are handed. So every field is checked for type,
 * anything that fails is dropped, and unknown properties never make it through.
 *
 * `parseTasks` in tasks.ts does the same job for deadlines.
 */

/**
 * v1 stored habits as a fixed 8-slot string array and grid keys as `${day}:${slotIndex}`.
 * Converting each non-empty slot to { id: String(slotIndex), name } keeps every
 * existing grid key valid, so no grid rewrite is needed.
 */
function parseHabits(raw: unknown): Habit[] {
  if (!Array.isArray(raw)) return [];
  const habits: Habit[] = raw.every((h) => typeof h === 'string')
    ? (raw as string[])
        .map((name, i) => ({ id: String(i), name }))
        .filter((h) => h.name.trim() !== '')
    : raw
        .filter(
          (h): h is Habit => !!h && typeof h.id === 'string' && typeof h.name === 'string'
        )
        .map((h) => ({ id: h.id, name: h.name }));

  // A repeated id would have two rings claiming the same cells; the first one
  // wins. The cap is the same one the UI enforces when adding.
  const seen = new Set<string>();
  const unique: Habit[] = [];
  for (const h of habits) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    unique.push(h);
    if (unique.length === MAX_HABITS) break;
  }
  return unique;
}

/**
 * Only cells that belong to a habit in the list, on a plausible day, holding a
 * real mark. A pending cell is the same as an absent one — the app deletes
 * rather than writes 0 — so those are dropped too, which also keeps
 * `habitHasMarks` honest. Keys are rebuilt, so `01:0` and `1:0` can't coexist.
 */
function parseGrid(raw: unknown, habits: Habit[]): Record<string, CellState> {
  const grid: Record<string, CellState> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return grid;
  const ids = new Set(habits.map((h) => h.id));
  for (const [key, state] of Object.entries(raw as Record<string, unknown>)) {
    if (state !== 1 && state !== 2) continue;
    const sep = key.indexOf(':');
    if (sep <= 0) continue;
    const day = Number(key.slice(0, sep));
    const id = key.slice(sep + 1);
    if (!Number.isInteger(day) || day < 1 || day > 31 || !ids.has(id)) continue;
    grid[cellKey(day, id)] = state;
  }
  return grid;
}

function parseObservations(raw: unknown): string[] {
  const lines = Array.isArray(raw) ? raw.filter((o): o is string => typeof o === 'string') : [];
  return lines.length ? lines : emptyMonthData().observations;
}

/** Always exactly three, each slot coerced on its own rather than all-or-nothing */
function parseKeyGoals(raw: unknown): KeyGoal[] {
  const base = emptyMonthData().keyGoals;
  if (!Array.isArray(raw)) return base;
  return base.map((empty, i) => {
    const g: unknown = raw[i];
    if (!g || typeof g !== 'object') return empty;
    const { text, done } = g as Record<string, unknown>;
    return { text: typeof text === 'string' ? text : '', done: done === true };
  });
}

export function parseMonthData(raw: unknown): MonthData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyMonthData();
  const r = raw as Record<string, unknown>;
  const habits = parseHabits(r.habits);
  return {
    habits,
    grid: parseGrid(r.grid, habits),
    observations: parseObservations(r.observations),
    keyGoals: parseKeyGoals(r.keyGoals),
  };
}

/** A stored month's JSON, or an empty month if there isn't one or it won't parse */
function decodeMonth(raw: string | null | undefined): MonthData {
  if (!raw) return emptyMonthData();
  try {
    return parseMonthData(JSON.parse(raw));
  } catch {
    return emptyMonthData();
  }
}

export async function loadMonth(year: number, month: number): Promise<MonthData> {
  try {
    return decodeMonth(await AsyncStorage.getItem(monthKey(year, month)));
  } catch {
    return emptyMonthData();
  }
}

export async function saveMonth(year: number, month: number, data: MonthData): Promise<void> {
  try {
    await AsyncStorage.setItem(monthKey(year, month), JSON.stringify(data));
  } catch {
    // best-effort persistence; nothing actionable on failure
  }
}

/** One stored month, with the year and month it came from */
export interface MonthRecord {
  year: number;
  /** 0-based, matching the app */
  month: number;
  data: MonthData;
}

/**
 * Full records for a run of months ending at (year, month), newest first.
 *
 * The year summary below is deliberately lossy — it counts marks without saying
 * which habit they belonged to — which is all a grid needs and not enough for a
 * log that names them. One multiGet either way, so reading whole months over a
 * short window costs about the same as reading tallies over a long one.
 */
export async function loadMonthWindow(
  year: number,
  month: number,
  count: number
): Promise<MonthRecord[]> {
  try {
    const span = Array.from({ length: count }, (_, i) => {
      const d = new Date(year, month - i, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
    const pairs = await AsyncStorage.multiGet(span.map((s) => monthKey(s.year, s.month)));
    return span.map((s, i) => ({ ...s, data: decodeMonth(pairs[i]?.[1]) }));
  } catch {
    return [];
  }
}

/**
 * Every month this phone has actually stored, oldest first.
 *
 * The other readers here ask for a window they already know the bounds of;
 * backing up has no bounds to know, so it asks the store what is there. The
 * pattern is deliberately strict: the same prefix also holds settings, tasks
 * and the intro flag, none of which are months.
 */
export async function listStoredMonths(): Promise<{ year: number; month: number }[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys
      .map((key) => /^@monthly-planning\/(\d{4})-(\d{2})$/.exec(key))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ year: Number(match[1]), month: Number(match[2]) - 1 }))
      .filter((m) => m.month >= 0 && m.month <= 11)
      .sort((a, b) => a.year - b.year || a.month - b.month);
  } catch {
    return [];
  }
}

/** Per-day done/missed counts for one month, used by the yearly grid */
export interface YearMonthSummary {
  habitCount: number;
  tallies: Record<number, { done: number; missed: number }>;
}

const EMPTY_MONTH_SUMMARY: YearMonthSummary = { habitCount: 0, tallies: {} };

/** Loads lightweight tallies for all 12 months of a year in one multiGet. */
export async function loadYearSummary(year: number): Promise<YearMonthSummary[]> {
  try {
    const keys = Array.from({ length: 12 }, (_, m) => monthKey(year, m));
    const pairs = await AsyncStorage.multiGet(keys);
    return pairs.map(([, raw]) => {
      if (!raw) return EMPTY_MONTH_SUMMARY;
      const data = decodeMonth(raw);
      const tallies: YearMonthSummary['tallies'] = {};
      // the parser has already rebuilt every key as `${day}:${id}` and kept
      // only real marks on real habits, so there is nothing left to check
      for (const [key, state] of Object.entries(data.grid)) {
        const t = (tallies[parseInt(key, 10)] ??= { done: 0, missed: 0 });
        if (state === 1) t.done++;
        else t.missed++;
      }
      return { habitCount: data.habits.length, tallies };
    });
  } catch {
    return Array.from({ length: 12 }, () => EMPTY_MONTH_SUMMARY);
  }
}
