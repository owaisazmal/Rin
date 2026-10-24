import { cellKey, dayTally } from './types';
import type { KeyGoal, MonthData } from './types';
import type { YearMonthSummary } from './storage';
import type { Task } from './tasks';
import type { DayRef } from './marking';
import { dayWhen } from './marking';
import { finishedLate } from './history';
import { monthLength } from './dates';

// A cell counts once its day is over or it holds a mark, so a running month is judged on what has passed.

type MonthPhase = 'past' | 'current' | 'future';

interface MonthTotals {
  habitCount: number;
  done: number;
  missed: number;
  /** past days left blank */
  empty: number;
  /** done as a whole percentage of the cells that count, null when none do */
  pct: number | null;
  /** most days in a row with anything done, by the rule in streaks.ts */
  longestStreak: number;
}

export interface HabitRate {
  id: string;
  name: string;
  done: number;
  missed: number;
  empty: number;
  pct: number | null;
}

interface DeadlineTotals {
  /** finished by the deadline, or finished with no time recorded */
  met: number;
  /** finished after the deadline */
  late: number;
  /** not finished and already past due */
  overdue: number;
  /** not finished and not due yet */
  open: number;
}

export interface MonthSummary extends MonthTotals {
  phase: MonthPhase;
  daysInMonth: number;
  /** days of the month that are over */
  daysPast: number;
  habits: HabitRate[];
  /** every habit tied at the top and at the bottom; empty unless rates differ */
  best: HabitRate[];
  weakest: HabitRate[];
  /** named goals only */
  goals: { done: number; total: number; named: KeyGoal[] };
  deadlines: DeadlineTotals;
  /** non-blank observations, trimmed */
  observations: string[];
  /** the month before and the change since, once it has been read */
  previous: PreviousMonth | null;
}

interface PreviousMonth {
  year: number;
  month: number;
  totals: MonthTotals;
  change: MonthComparison;
}

interface MonthComparison {
  /** percentage points; null when either month has nothing to count */
  pct: number | null;
  done: number;
  missed: number;
  longestStreak: number;
}

function phaseOf(year: number, month: number, today: DayRef): MonthPhase {
  const a = year * 12 + month;
  const b = today.year * 12 + today.month;
  return a < b ? 'past' : a > b ? 'future' : 'current';
}

function daysPastIn(year: number, month: number, today: DayRef): number {
  const phase = phaseOf(year, month, today);
  if (phase === 'past') return monthLength(year, month);
  return phase === 'current' ? today.day - 1 : 0;
}

const percent = (done: number, counted: number) =>
  counted ? Math.round((done / counted) * 100) : null;

/** The open month in the shape the year grid keeps, so both months are counted alike */
export function tallyMonth(data: MonthData, daysInMonth: number): YearMonthSummary {
  const tallies: YearMonthSummary['tallies'] = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const t = dayTally(data.grid, data.habits, d);
    if (t.done || t.missed) tallies[d] = t;
  }
  return { habitCount: data.habits.length, tallies };
}

/** Overall counts for one month from its tallies; also what the previous month is read with */
export function monthTotals(
  year: number,
  month: number,
  summary: YearMonthSummary,
  today: DayRef
): MonthTotals {
  const len = monthLength(year, month);
  const past = daysPastIn(year, month, today);
  let done = 0;
  let missed = 0;
  let empty = 0;
  let run = 0;
  let longestStreak = 0;
  for (let d = 1; d <= len; d++) {
    const dayDone = summary.tallies[d]?.done ?? 0;
    const dayMissed = summary.tallies[d]?.missed ?? 0;
    done += dayDone;
    missed += dayMissed;
    if (d <= past) empty += Math.max(0, summary.habitCount - dayDone - dayMissed);
    // days in a row with anything done, the rule streaks.ts counts by
    run = dayDone > 0 ? run + 1 : 0;
    longestStreak = Math.max(longestStreak, run);
  }
  return {
    habitCount: summary.habitCount,
    done,
    missed,
    empty,
    pct: percent(done, done + missed + empty),
    longestStreak,
  };
}

/** Each habit's month, in the order the habits were added */
export function habitRates(year: number, month: number, data: MonthData, today: DayRef): HabitRate[] {
  const len = monthLength(year, month);
  return data.habits.map((h) => {
    let done = 0;
    let missed = 0;
    let empty = 0;
    for (let d = 1; d <= len; d++) {
      const state = data.grid[cellKey(d, h.id)] ?? 0;
      if (state === 1) done++;
      else if (state === 2) missed++;
      else if (dayWhen(year, month, d, today) === 'past') empty++;
    }
    return {
      id: h.id,
      name: h.name.trim() || 'Untitled habit',
      done,
      missed,
      empty,
      pct: percent(done, done + missed + empty),
    };
  });
}

/** Everything tied at the top and at the bottom by rate; both empty unless rates differ */
export function extremes<T extends { pct: number | null }>(items: T[]): { best: T[]; weakest: T[] } {
  const counted = items.filter((r) => r.pct !== null);
  const pcts = counted.map((r) => r.pct as number);
  const top = Math.max(...pcts);
  const bottom = Math.min(...pcts);
  if (counted.length < 2 || top === bottom) return { best: [], weakest: [] };
  return {
    best: counted.filter((r) => r.pct === top),
    weakest: counted.filter((r) => r.pct === bottom),
  };
}

/** Deadlines that fell due in the month, judged at `now`; unnamed ones are left out */
export function deadlinesIn(
  year: number,
  month: number,
  tasks: Task[],
  now: number
): DeadlineTotals {
  const start = new Date(year, month, 1).getTime();
  const end = new Date(year, month + 1, 1).getTime();
  const out: DeadlineTotals = { met: 0, late: 0, overdue: 0, open: 0 };
  for (const t of tasks) {
    if (t.due < start || t.due >= end || t.text.trim() === '') continue;
    if (t.done) out[finishedLate(t) ? 'late' : 'met']++;
    else out[t.due <= now ? 'overdue' : 'open']++;
  }
  return out;
}

/** `previous` is the month before in the year grid's shape, or null while it is being read */
export function summarizeMonth(
  year: number,
  month: number,
  data: MonthData,
  tasks: Task[],
  now: number,
  previous: YearMonthSummary | null = null
): MonthSummary {
  const d = new Date(now);
  const today: DayRef = { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  const daysInMonth = monthLength(year, month);
  const totals = monthTotals(year, month, tallyMonth(data, daysInMonth), today);
  const habits = habitRates(year, month, data, today);
  const named = data.keyGoals.filter((g) => g.text.trim() !== '');
  const before = new Date(year, month - 1, 1);
  const prior = previous && monthTotals(before.getFullYear(), before.getMonth(), previous, today);
  return {
    ...totals,
    phase: phaseOf(year, month, today),
    daysInMonth,
    daysPast: daysPastIn(year, month, today),
    habits,
    ...extremes(habits),
    goals: { done: named.filter((g) => g.done).length, total: named.length, named },
    deadlines: deadlinesIn(year, month, tasks, now),
    observations: data.observations.map((o) => o.trim()).filter((o) => o !== ''),
    previous: prior && {
      year: before.getFullYear(),
      month: before.getMonth(),
      totals: prior,
      change: compareMonths(totals, prior),
    },
  };
}

/** This month minus the one before it */
export function compareMonths(current: MonthTotals, previous: MonthTotals): MonthComparison {
  return {
    pct: current.pct !== null && previous.pct !== null ? current.pct - previous.pct : null,
    done: current.done - previous.done,
    missed: current.missed - previous.missed,
    longestStreak: current.longestStreak - previous.longestStreak,
  };
}
