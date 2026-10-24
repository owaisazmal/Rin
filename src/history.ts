import { cellKey } from './types';
import type { CellState, Habit } from './types';
import type { MonthRecord } from './storage';
import type { RepeatEvery, Task } from './tasks';
import { DAY, monthLength, shortDate, startOfDay } from './dates';
import { coarse } from './deadlines';
import { repeatLabel } from './recurring';

// Derived from the month grids and the task list rather than stored, so editing a month rewrites its history.

interface HabitMark {
  name: string;
  /** 1 done, 2 missed — pending marks aren't events, so they never appear */
  state: Exclude<CellState, 0>;
}

interface DeadlineEvent {
  text: string;
  due: number;
  /** null on a task ticked off before completion times were recorded */
  completedAt: number | null;
  /** finished after the deadline had passed */
  late: boolean;
  /** the series this was one occurrence of, or null for a one-off */
  repeat: RepeatEvery | null;
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

/** Ticked off after the deadline; a task with no completion time counts as on time */
export function finishedLate(task: Task): boolean {
  return task.done && task.completedAt != null && task.completedAt > task.due;
}

function marksFor(habits: Habit[], grid: Record<string, CellState>, day: number): HabitMark[] {
  const out: HabitMark[] = [];
  for (const h of habits) {
    const state = grid[cellKey(day, h.id)] ?? 0;
    if (state === 0) continue;
    out.push({ name: h.name.trim() || 'Untitled habit', state });
  }
  return out;
}

/** Newest day first, skipping empty days; an open deadline isn't history yet, however overdue */
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

  for (const { year, month, data } of months) {
    const len = monthLength(year, month);
    for (let day = 1; day <= len; day++) {
      if (new Date(year, month, day).getTime() > today) break;
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
    // with no completion time recorded, the deadline is the only honest date to file it under
    const d = new Date(task.completedAt ?? task.due);
    dayAt(d.getFullYear(), d.getMonth(), d.getDate()).deadlines.push({
      text: task.text.trim() || 'Untitled task',
      due: task.due,
      completedAt: task.completedAt ?? null,
      late: finishedLate(task),
      repeat: task.repeat?.every ?? null,
    });
  }

  return [...days.values()].sort((a, b) => b.key - a.key);
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
  return shortDate(entry.key).toUpperCase();
}

/** Which occurrence of a series this was — "monthly · due Sat 31 Oct" — or null for a one-off */
export function occurrenceLabel(event: DeadlineEvent): string | null {
  if (!event.repeat) return null;
  return `${repeatLabel(event.repeat)} · due ${shortDate(event.due)}`;
}

/** How late, in the coarsest unit that still says something — "2d late" */
export function lateness(event: DeadlineEvent): string | null {
  if (!event.late || event.completedAt == null) return null;
  const over = coarse(event.completedAt - event.due);
  return `${over === 'moments' ? '1m' : over} late`;
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
