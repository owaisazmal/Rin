import type { YearMonthSummary } from './storage';
import { monthLength } from './dates';

/** The year up to this month (what the grid opens on), or a calendar year that ends in December regardless */
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

interface BlockShape {
  /** rows the 1st is pushed down by — 0 when the month starts on a Sunday */
  lead: number;
  days: number;
  columns: number;
  /** the span of the squares themselves, which the month label centres over */
  width: number;
  /** how far right the next block starts, carrying the trailing column gap */
  advance: number;
}

/** Kept as two numbers, `width` and `advance`, or labels drift right with every month scrolled past */
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

/** The `[first, last]` days a week column holds; a range, so the lead is padding rather than blank views */
export function columnDays(
  shape: BlockShape,
  column: number
): { first: number; last: number } {
  return {
    first: Math.max(1, column * 7 - shape.lead + 1),
    last: Math.min(shape.days, (column + 1) * 7 - shape.lead),
  };
}

/** Walked across the whole span, so a run from the 28th to the 3rd is one streak; only `done` counts */
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
