import { cellKey } from './types';
import type { CellState, MonthData } from './types';
import { dayWhen } from './marking';
import type { DayRef, DayWhen } from './marking';
import { monthLength } from './dates';
import { extremes, habitRates, monthTotals, tallyMonth } from './monthSummary';
import type { HabitRate } from './monthSummary';

// The tracker's month charts; a cell counts once it holds a mark or its day is over, as in monthSummary.ts.

/** Monday first, as the due-date calendar sets weeks out; the values are `Date.getDay()` */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

/** Index into WEEKDAYS for a date */
export const weekdayIndex = (year: number, month: number, day: number) =>
  (new Date(year, month, day).getDay() + 6) % 7;

export interface Tally {
  done: number;
  missed: number;
  /** marked cells plus past ones left blank */
  counted: number;
  /** done as a whole percentage of what counts, null when nothing does */
  pct: number | null;
}

const blank = (): Tally => ({ done: 0, missed: 0, counted: 0, pct: null });

function add(t: Tally, state: CellState, when: DayWhen) {
  if (state === 1) t.done++;
  else if (state === 2) t.missed++;
  if (state !== 0 || when === 'past') t.counted++;
  t.pct = t.counted ? Math.round((t.done / t.counted) * 100) : null;
}

const stateOf = (data: MonthData, day: number, habitId: string): CellState =>
  data.grid[cellKey(day, habitId)] ?? 0;

export interface DayBar {
  day: number;
  done: number;
  missed: number;
  when: DayWhen;
  /** every habit done */
  perfect: boolean;
}

export interface DayBars {
  habitCount: number;
  bars: DayBar[];
  perfectDays: number;
  /** the month's rate as the summary page counts it */
  pct: number | null;
}

export function dayBars(year: number, month: number, data: MonthData, today: DayRef): DayBars {
  const len = monthLength(year, month);
  const summary = tallyMonth(data, len);
  const habitCount = data.habits.length;
  const bars = Array.from({ length: len }, (_, i): DayBar => {
    const day = i + 1;
    const t = summary.tallies[day];
    const done = t?.done ?? 0;
    return {
      day,
      done,
      missed: t?.missed ?? 0,
      when: dayWhen(year, month, day, today),
      perfect: habitCount > 0 && done === habitCount,
    };
  });
  return {
    habitCount,
    bars,
    perfectDays: bars.filter((b) => b.perfect).length,
    pct: monthTotals(year, month, summary, today).pct,
  };
}

/** Day numbers under the bars: the emphasised ones first, then one a week, none closer than `minGap` */
export function axisDays(daysInMonth: number, emphasised: (number | null)[], minGap = 3): number[] {
  const picked: number[] = [];
  const clear = (d: number) => picked.every((p) => Math.abs(p - d) >= minGap);
  for (const d of emphasised) {
    if (d !== null && d >= 1 && d <= daysInMonth && clear(d)) picked.push(d);
  }
  for (let d = 1; d <= daysInMonth; d += 7) if (clear(d)) picked.push(d);
  return picked.sort((a, b) => a - b);
}

export interface HabitBar extends HabitRate {
  /** the habit's month, day by day */
  strip: CellState[];
  /** most days in a row done */
  bestRun: number;
  /** 1 for the highest rate, ties sharing a place; null with nothing to count */
  rank: number | null;
}

/** Highest rate first; habits with nothing to count go last, each group in the order the habits were added */
export function habitBars(year: number, month: number, data: MonthData, today: DayRef): HabitBar[] {
  const len = monthLength(year, month);
  const rates = habitRates(year, month, data, today);
  const bars = rates.map((r, order) => {
    const strip = Array.from({ length: len }, (_, i) => stateOf(data, i + 1, r.id));
    let run = 0;
    let bestRun = 0;
    for (const s of strip) {
      run = s === 1 ? run + 1 : 0;
      bestRun = Math.max(bestRun, run);
    }
    const rank = r.pct === null ? null : 1 + rates.filter((o) => (o.pct ?? -1) > (r.pct as number)).length;
    return { bar: { ...r, strip, bestRun, rank }, order };
  });
  return bars
    .sort((a, b) => (b.bar.pct ?? -1) - (a.bar.pct ?? -1) || a.order - b.order)
    .map((b) => b.bar);
}

export interface WeekPoint extends Tally {
  /** the week's first and last day inside the month */
  first: number;
  last: number;
  /** holds today or days still to come */
  running: boolean;
  /** points gained on the week before, when both have a rate */
  change: number | null;
}

/** Monday-to-Sunday weeks, cut at the month's ends */
export function weekPoints(year: number, month: number, data: MonthData, today: DayRef): WeekPoint[] {
  const len = monthLength(year, month);
  const out: WeekPoint[] = [];
  for (let first = 1; first <= len; ) {
    const last = Math.min(len, first + 6 - weekdayIndex(year, month, first));
    const t = blank();
    let running = false;
    for (let d = first; d <= last; d++) {
      const when = dayWhen(year, month, d, today);
      if (when !== 'past') running = true;
      for (const h of data.habits) add(t, stateOf(data, d, h.id), when);
    }
    const prev = out[out.length - 1]?.pct ?? null;
    out.push({
      ...t,
      first,
      last,
      running,
      change: prev !== null && t.pct !== null ? t.pct - prev : null,
    });
    first = last + 1;
  }
  return out;
}

interface Point {
  x: number;
  y: number;
}

const fixed = (n: number) => Number(n.toFixed(2));

/** A monotone cubic, one `C` per gap, so the curve never overshoots a value it was given */
export function smoothSegments(points: Point[]): string[] {
  const n = points.length;
  if (n < 2) return [];
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    slope.push((points[i + 1].y - points[i].y) / dx[i]);
  }
  const m = points.map((_, i) =>
    i === 0
      ? slope[0]
      : i === n - 1
        ? slope[n - 2]
        : slope[i - 1] * slope[i] <= 0
          ? 0
          : (slope[i - 1] + slope[i]) / 2
  );
  // Fritsch–Carlson: pull the tangents in wherever they would overshoot
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  return dx.map((w, i) => {
    const h = w / 3;
    const p = points[i];
    const q = points[i + 1];
    const c = [p.x + h, p.y + m[i] * h, q.x - h, q.y - m[i + 1] * h, q.x, q.y].map(fixed);
    return `C${c.join(' ')}`;
  });
}

export function smoothPath(points: Point[]): string {
  if (!points.length) return '';
  return [`M${fixed(points[0].x)} ${fixed(points[0].y)}`, ...smoothSegments(points)].join(' ');
}

interface WeekdayRow {
  id: string;
  name: string;
  /** one per WEEKDAYS entry */
  cells: Tally[];
}

export interface WeekdayHeat {
  rows: WeekdayRow[];
  /** every habit together, one per WEEKDAYS entry */
  all: Tally[];
  /** indexes into WEEKDAYS tied at the bottom and the top; empty unless rates differ */
  weakest: number[];
  strongest: number[];
}

export function weekdayHeat(year: number, month: number, data: MonthData, today: DayRef): WeekdayHeat {
  const len = monthLength(year, month);
  const rows = habitRates(year, month, data, today).map(
    (r): WeekdayRow => ({ id: r.id, name: r.name, cells: WEEKDAYS.map(blank) })
  );
  const all = WEEKDAYS.map(blank);
  for (let d = 1; d <= len; d++) {
    const when = dayWhen(year, month, d, today);
    const col = weekdayIndex(year, month, d);
    for (const row of rows) {
      const state = stateOf(data, d, row.id);
      add(row.cells[col], state, when);
      add(all[col], state, when);
    }
  }
  const { best, weakest } = extremes(all.map((t, i) => ({ pct: t.pct, i })));
  return {
    rows,
    all,
    weakest: weakest.map((t) => t.i),
    strongest: best.map((t) => t.i),
  };
}

type HeatLevel = 0 | 1 | 2 | 3 | 4 | 'missed';

/** The year grid's shading: four greens by share done, red when only misses were marked, blank otherwise */
export function heatLevel(done: number, missed: number, of: number): HeatLevel {
  if (of <= 0) return 0;
  if (done > 0) {
    const r = done / of;
    return r <= 0.25 ? 1 : r <= 0.5 ? 2 : r <= 0.75 ? 3 : 4;
  }
  return missed > 0 ? 'missed' : 0;
}
