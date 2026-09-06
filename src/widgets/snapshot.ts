import { CellState, KeyGoal, MonthData, cellKey } from '../types';
import { YearMonthSummary } from '../storage';
import { ThemeMode } from '../theme';
import { DISCIPLINE_QUOTES } from '../quotes';
import { computeStreaks } from '../streaks';
import { Task } from '../tasks';
import { pendingTasks } from '../deadlines';
import { MONTH_NAMES, monthLength } from '../dates';

/**
 * The payload handed to the iOS widgets.
 *
 * Widgets can't reach AsyncStorage, so the app mirrors a compact snapshot of
 * everything they render into a shared App Group container on every save. Keep
 * this small and flat — it is re-encoded on every keystroke-debounced write.
 */

export interface WidgetHabit {
  id: string;
  name: string;
}

export interface WidgetTask {
  text: string;
  /** the deadline, epoch milliseconds */
  due: number;
}

/** More than any widget family can show, and few enough to stay cheap to encode */
const MAX_WIDGET_TASKS = 8;

export interface WidgetSnapshot {
  updatedAt: number;
  /**
   * The app's own appearance setting, which the widgets follow instead of the
   * phone's. It travels in the snapshot rather than being read from shared
   * storage separately, so a widget can never render a colour scheme from one
   * write and data from another.
   */
  theme: ThemeMode;
  year: number;
  /** 0-based, matching the app */
  month: number;
  monthName: string;
  daysInMonth: number;
  /** day-of-month when the snapshot's month is the live one, else null */
  today: number | null;
  habits: WidgetHabit[];
  /** day → one char per habit: '0' pending, '1' done, '2' missed */
  grid: Record<string, string>;
  monthDone: number;
  monthMissed: number;
  monthTotal: number;
  monthPct: number;
  currentStreak: number;
  bestStreak: number;
  perfectStreak: number;
  goals: { text: string; done: boolean }[];
  /** per month, per day-of-month: how many habits were done (index 0 = day 1) */
  yearDone: number[][];
  yearMissed: number[][];
  yearHabitCounts: number[];
  yearTotal: number;
  /**
   * The whole list, not just today's. The quote widget picks its own by
   * day-of-year, so it rolls over at midnight even if the app is never opened —
   * and `quotes.ts` stays the single source of truth.
   */
  quotes: string[];
  /**
   * Deadlines still to hit, soonest first.
   *
   * Only the deadline itself travels, never how far off it is: the widget works
   * that out against its own clock, so "3h left" stays true between snapshots
   * instead of ageing into a lie the moment the app is closed. Finished tasks
   * are left behind — a widget has nothing to say about them — and the list is
   * capped, because this whole payload is rewritten on every debounced save.
   */
  tasks: WidgetTask[];
}

/** Per-day per-habit states, packed one character per habit */
function packGrid(data: MonthData, daysInMonth: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (data.habits.length === 0) return out;
  for (let day = 1; day <= daysInMonth; day++) {
    let row = '';
    let any = false;
    for (const h of data.habits) {
      const s: CellState = data.grid[cellKey(day, h.id)] ?? 0;
      if (s !== 0) any = true;
      row += String(s);
    }
    if (any) out[String(day)] = row;
  }
  return out;
}

function cleanGoals(goals: KeyGoal[]) {
  return goals.map((g) => ({ text: g.text.trim(), done: g.done }));
}

export function buildSnapshot(
  year: number,
  month: number,
  data: MonthData,
  yearMonths: YearMonthSummary[],
  now: Date,
  theme: ThemeMode,
  tasks: Task[]
): WidgetSnapshot {
  const daysInMonth = monthLength(year, month);
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const today = isCurrentMonth ? now.getDate() : null;

  let monthDone = 0;
  let monthMissed = 0;
  for (const state of Object.values(data.grid)) {
    if (state === 1) monthDone++;
    else if (state === 2) monthMissed++;
  }
  const monthTotal = data.habits.length * daysInMonth;

  const todayRef =
    year === now.getFullYear() ? { month: now.getMonth(), day: now.getDate() } : null;
  const streaks = computeStreaks(year, yearMonths, todayRef);

  const yearDone: number[][] = [];
  const yearMissed: number[][] = [];
  const yearHabitCounts: number[] = [];
  let yearTotal = 0;
  for (let m = 0; m < 12; m++) {
    const info = yearMonths[m];
    const len = monthLength(year, m);
    const done: number[] = [];
    const missed: number[] = [];
    for (let d = 1; d <= len; d++) {
      const t = info?.tallies[d];
      done.push(t?.done ?? 0);
      missed.push(t?.missed ?? 0);
      yearTotal += t?.done ?? 0;
    }
    yearDone.push(done);
    yearMissed.push(missed);
    yearHabitCounts.push(info?.habitCount ?? 0);
  }

  return {
    updatedAt: now.getTime(),
    theme,
    year,
    month,
    monthName: MONTH_NAMES[month],
    daysInMonth,
    today,
    habits: data.habits.map((h) => ({ id: h.id, name: h.name })),
    grid: packGrid(data, daysInMonth),
    monthDone,
    monthMissed,
    monthTotal,
    monthPct: monthTotal ? Math.round((monthDone / monthTotal) * 100) : 0,
    currentStreak: streaks.current,
    bestStreak: streaks.best,
    perfectStreak: streaks.perfect,
    goals: cleanGoals(data.keyGoals),
    yearDone,
    yearMissed,
    yearHabitCounts,
    yearTotal,
    quotes: DISCIPLINE_QUOTES,
    tasks: pendingTasks(tasks)
      .slice(0, MAX_WIDGET_TASKS)
      .map((t) => ({ text: t.text.trim(), due: t.due })),
  };
}
