import type { YearMonthSummary } from './storage';
import { monthLength } from './dates';

/**
 * The arithmetic behind the year grid: which twelve months it covers, how a
 * month's block of squares is shaped, and what the three numbers above it say.
 *
 * Kept out of both the hook and the component for the reason `streaks.ts`
 * exists: none of it renders and none of it touches storage, so it can be
 * pinned by tests that run in plain Node. The hook does the loading, the
 * component does the drawing, and the rules about dates live here where they
 * can be checked against a calendar.
 */

/**
 * Which twelve months the grid is showing.
 *
 * `rolling` is the year up to this month — the span somebody actually wants to
 * see, and the one the grid opens on. A calendar year is the other question
 * ("how was 2025?"), and it is a different one: it ends in December whether or
 * not December has happened.
 */
export type YearSpan = { kind: 'rolling' } | { kind: 'calendar'; year: number };

/** One month of the grid: which month it is, and what was marked in it */
export interface YearBlock {
  year: number;
  month: number;
  summary: YearMonthSummary;
}

export interface YearSpanStats {
  /** habits checked off inside the span */
  total: number;
  /** days carrying at least one check */
  activeDays: number;
  /** the longest run of consecutive active days inside the span */
  maxStreak: number;
}

/** The twelve months a span covers, oldest first. */
export function spanMonths(
  span: YearSpan,
  now: { year: number; month: number }
): { year: number; month: number }[] {
  if (span.kind === 'calendar') {
    return Array.from({ length: 12 }, (_, month) => ({ year: span.year, month }));
  }
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.year, now.month - 11 + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
}

export function spanContains(
  months: { year: number; month: number }[],
  at: { year: number; month: number }
): boolean {
  return months.some((m) => m.year === at.year && m.month === at.month);
}

export interface BlockShape {
  /** rows the 1st is pushed down by — 0 when the month starts on a Sunday */
  lead: number;
  days: number;
  columns: number;
  /** the span of the squares themselves, which the month label centres over */
  width: number;
  /** how far right the next block starts, carrying the trailing column gap */
  advance: number;
}

/**
 * How wide a month's block is, and where its days sit inside it.
 *
 * `width` and `advance` are deliberately two numbers. The label centres over
 * the squares, which end where the last one does; the next block starts a
 * column-gap further right than that. Collapsing them into one is the
 * difference between a label under its month and one that drifts a few points
 * right for every month the grid scrolls past.
 */
export function blockShape(
  year: number,
  month: number,
  step: number,
  gap: number,
  monthGap: number
): BlockShape {
  const lead = new Date(year, month, 1).getDay(); // 0 = Sunday
  const days = monthLength(year, month);
  const columns = Math.ceil((lead + days) / 7);
  return {
    lead,
    days,
    columns,
    width: columns * step - gap,
    advance: columns * step + monthGap,
  };
}

/**
 * The days a given column of a block holds, as `[first, last]` day-of-month.
 *
 * Columns are weeks and rows are weekdays, so the first column is short by the
 * `lead` and the last one stops wherever the month does. Returned as a range
 * rather than an array of cells because the component draws the lead as
 * padding — a year is then 365 views instead of the 430-odd a grid padded with
 * transparent squares would mount, on the platform that can least afford them.
 */
export function columnDays(
  shape: BlockShape,
  column: number
): { first: number; last: number } {
  return {
    first: Math.max(1, column * 7 - shape.lead + 1),
    last: Math.min(shape.days, (column + 1) * 7 - shape.lead),
  };
}

/**
 * Walked day by day across the whole span rather than per month, because the
 * longest run is the one question here that doesn't respect month ends: a
 * streak running from the 28th to the 3rd is one streak.
 *
 * Only `done` counts as active. A day where every habit was marked missed is a
 * day that was answered, but it is not a day that was kept, and the number
 * above the grid is about what was kept.
 */
export function spanStats(blocks: YearBlock[]): YearSpanStats {
  let total = 0;
  let activeDays = 0;
  let maxStreak = 0;
  let run = 0;
  for (const block of blocks) {
    const len = monthLength(block.year, block.month);
    for (let d = 1; d <= len; d++) {
      const done = block.summary.tallies[d]?.done ?? 0;
      total += done;
      if (done > 0) {
        activeDays++;
        run++;
        if (run > maxStreak) maxStreak = run;
      } else {
        run = 0;
      }
    }
  }
  return { total, activeDays, maxStreak };
}
