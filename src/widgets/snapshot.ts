import { CellState, MonthData, cellKey } from '../types';
import { YearMonthSummary } from '../storage';
import { ThemeMode } from '../theme';
import { computeStreaks } from '../streaks';
import { Task } from '../tasks';
import type { QuoteList } from '../quotes';
import { pendingTasks } from '../deadlines';
import { repeatLabel } from '../recurring';
import { MONTH_NAMES, monthLength } from '../dates';

// What the iOS widgets render, mirrored into the App Group; kept small and flat, as it is re-encoded on every save.

interface WidgetHabit {
  id: string;
  name: string;
}

interface WidgetTask {
  text: string;
  /** the deadline, epoch milliseconds */
  due: number;
  /** "weekly" / "monthly" / "yearly" on a recurring deadline; absent on a one-off */
  repeats?: string;
}

/** More than any widget family can show, and few enough to stay cheap to encode */
const MAX_WIDGET_TASKS = 8;

export interface WidgetSnapshot {
  updatedAt: number;
  /** the app's own setting, sent with the data so a widget never mixes two writes */
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
  /** The whole active list, so the widget picks by day-of-year and rolls over without the app */
  quotes: string[];
  /** where the user's own quotes begin in `quotes`, which take the "YOUR WORDS." heading */
  ownQuotesFrom: number;
  /** open deadlines, soonest first; the widget counts down against its own clock */
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

export function buildSnapshot(
  year: number,
  month: number,
  data: MonthData,
  yearMonths: YearMonthSummary[],
  now: Date,
  theme: ThemeMode,
  tasks: Task[],
  quotes: QuoteList
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
    goals: data.keyGoals.map((g) => ({ text: g.text.trim(), done: g.done })),
    yearDone,
    yearMissed,
    yearHabitCounts,
    yearTotal,
    quotes: quotes.quotes,
    ownQuotesFrom: quotes.ownFrom,
    tasks: pendingTasks(tasks)
      .slice(0, MAX_WIDGET_TASKS)
      .map((t) => ({
        text: t.text.trim(),
        due: t.due,
        ...(t.repeat && { repeats: repeatLabel(t.repeat.every) }),
      })),
  };
}
