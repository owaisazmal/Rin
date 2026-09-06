import type { YearMonthSummary } from './storage';
import { monthLength } from './dates';

/**
 * How consecutive days are counted.
 *
 * This is the app's own rule, not a widget detail — the header flame and the
 * Streak widget both read from here so they can never disagree. It lived in
 * `widgets/snapshot.ts` while the widgets were its only caller, which pointed
 * the dependency the wrong way once the planner started asking too.
 */

/** Flat day-of-year view of a whole year, so streaks can cross month borders */
function flattenYear(year: number, months: YearMonthSummary[]) {
  const active: boolean[] = [];
  const perfect: boolean[] = [];
  const index: { month: number; day: number }[] = [];
  for (let m = 0; m < 12; m++) {
    const info = months[m];
    const len = monthLength(year, m);
    for (let d = 1; d <= len; d++) {
      const t = info?.tallies[d];
      const done = t?.done ?? 0;
      const count = info?.habitCount ?? 0;
      active.push(done > 0);
      perfect.push(count > 0 && done >= count);
      index.push({ month: m, day: d });
    }
  }
  return { active, perfect, index };
}

export interface Streaks {
  current: number;
  best: number;
  perfect: number;
}

/**
 * `current` counts back from today, or from yesterday when today isn't marked
 * yet — a streak shouldn't look broken just because the day isn't over.
 * Streaks are computed within one calendar year, so a run crossing New Year
 * restarts at January 1.
 */
export function computeStreaks(
  year: number,
  months: YearMonthSummary[],
  today: { month: number; day: number } | null
): Streaks {
  const { active, perfect, index } = flattenYear(year, months);

  let best = 0;
  let run = 0;
  for (const a of active) {
    run = a ? run + 1 : 0;
    if (run > best) best = run;
  }

  if (!today) return { current: 0, best, perfect: 0 };

  const todayIdx = index.findIndex((e) => e.month === today.month && e.day === today.day);
  if (todayIdx < 0) return { current: 0, best, perfect: 0 };

  const countBack = (flags: boolean[]) => {
    let start = todayIdx;
    if (!flags[start]) start = todayIdx - 1; // today not marked yet — fall back to yesterday
    let n = 0;
    for (let i = start; i >= 0 && flags[i]; i--) n++;
    return n;
  };

  return { current: countBack(active), best, perfect: countBack(perfect) };
}
