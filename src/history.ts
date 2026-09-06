import { cellKey } from './types';
import type { CellState, Habit } from './types';
import type { MonthRecord } from './storage';
import type { Task } from './tasks';
import { DAY, DAY_ABBR, HOUR, MINUTE, MONTH_ABBR, monthLength, startOfDay } from './dates';

/**
 * What actually happened, day by day.
 *
 * Derived, not recorded. Every fact here is already in the month grids and the
 * task list, so there is no second store to keep in step and nothing to migrate
 * — editing August in August changes what August's history says, which is the
 * honest answer rather than a stale one. The only thing history needed that
 * wasn't already stored is *when* a deadline was ticked off, which is why
 * `Task.completedAt` exists.
 */

export interface HabitMark {
  name: string;
  /** 1 done, 2 missed — pending marks aren't events, so they never appear */
  state: Exclude<CellState, 0>;
}

export interface DeadlineEvent {
  text: string;
  due: number;
  /** null on a task ticked off before completion times were recorded */
  completedAt: number | null;
  /** finished after the deadline had passed */
  late: boolean;
}

export interface HistoryDay {
  /** start of the day, epoch ms — the key everything is grouped and sorted by */
  key: number;
  year: number;
  /** 0-based */
  month: number;
  day: number;
  marks: HabitMark[];
  done: number;
  missed: number;
  /** how many habits existed that month, so "3/5" means something */
  habitCount: number;
  deadlines: DeadlineEvent[];
}

export type HistoryFilter = 'all' | 'habits' | 'deadlines';

function marksFor(habits: Habit[], grid: Record<string, CellState>, day: number): HabitMark[] {
  const out: HabitMark[] = [];
  for (const h of habits) {
    const state = grid[cellKey(day, h.id)] ?? 0;
    if (state === 0) continue;
    out.push({ name: h.name.trim() || 'Untitled habit', state });
  }
  return out;
}

/**
 * Folds the loaded months and the task list into one reverse-chronological
 * list, dropping days where nothing happened.
 *
 * Only completed deadlines appear. One that has blown past its date without
 * being ticked is not history yet — it is still open, still in the Deadlines
 * section, and still capable of being finished; filing it as a past event would
 * mean moving it back out again the moment it was.
 */
export function buildHistory(
  months: MonthRecord[],
  tasks: Task[],
  now: number
): HistoryDay[] {
  const today = startOfDay(now);
  const days = new Map<number, HistoryDay>();

  const dayAt = (year: number, month: number, day: number): HistoryDay => {
    const key = new Date(year, month, day).getTime();
    let entry = days.get(key);
    if (!entry) {
      entry = {
        key, year, month, day,
        marks: [], done: 0, missed: 0, habitCount: 0, deadlines: [],
      };
      days.set(key, entry);
    }
    return entry;
  };

  for (const record of months) {
    const { year, month, data } = record;
    const len = monthLength(year, month);
    for (let day = 1; day <= len; day++) {
      const key = new Date(year, month, day).getTime();
      if (key > today) break; // nothing has happened in the future
      const marks = marksFor(data.habits, data.grid, day);
      if (marks.length === 0) continue;
      const entry = dayAt(year, month, day);
      entry.marks = marks;
      entry.done = marks.filter((m) => m.state === 1).length;
      entry.missed = marks.length - entry.done;
      entry.habitCount = data.habits.length;
    }
  }

  for (const task of tasks) {
    if (!task.done) continue;
    // A task ticked off before completion times were kept has no moment of its
    // own; the deadline is the only date it can honestly be filed under.
    const at = task.completedAt ?? task.due;
    const d = new Date(at);
    const entry = dayAt(d.getFullYear(), d.getMonth(), d.getDate());
    entry.deadlines.push({
      text: task.text.trim() || 'Untitled task',
      due: task.due,
      completedAt: task.completedAt ?? null,
      late: task.completedAt != null && task.completedAt > task.due,
    });
  }

  return [...days.values()]
    .filter((d) => d.marks.length > 0 || d.deadlines.length > 0)
    .sort((a, b) => b.key - a.key);
}

export function filterHistory(days: HistoryDay[], filter: HistoryFilter): HistoryDay[] {
  if (filter === 'all') return days;
  return days
    .map((d) =>
      filter === 'habits' ? { ...d, deadlines: [] } : { ...d, marks: [], done: 0, missed: 0 }
    )
    .filter((d) => (filter === 'habits' ? d.marks.length > 0 : d.deadlines.length > 0));
}

/** "TODAY", "YESTERDAY", or "SAT 29 AUG" */
export function dayHeading(entry: HistoryDay, now: number): string {
  const diff = Math.round((startOfDay(now) - entry.key) / DAY);
  if (diff === 0) return 'TODAY';
  if (diff === 1) return 'YESTERDAY';
  const d = new Date(entry.key);
  return `${DAY_ABBR[d.getDay()].toUpperCase()} ${entry.day} ${MONTH_ABBR[entry.month].toUpperCase()}`;
}

/** How late, in the coarsest unit that still says something — "2d late" */
export function lateness(event: DeadlineEvent): string | null {
  if (!event.late || event.completedAt == null) return null;
  const over = event.completedAt - event.due;
  if (over >= DAY) return `${Math.floor(over / DAY)}d late`;
  if (over >= HOUR) return `${Math.floor(over / HOUR)}h late`;
  return `${Math.max(1, Math.floor(over / MINUTE))}m late`;
}

/** Totals across everything currently in view, for the summary strip */
export function historyTotals(days: HistoryDay[]) {
  let done = 0;
  let missed = 0;
  let finished = 0;
  let late = 0;
  for (const d of days) {
    done += d.done;
    missed += d.missed;
    finished += d.deadlines.length;
    late += d.deadlines.filter((e) => e.late).length;
  }
  return { done, missed, finished, late, days: days.length };
}
