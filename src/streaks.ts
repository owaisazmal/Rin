import type { YearMonthSummary } from './storage';
import { monthLength } from './dates';

// The app's one streak rule, shared by the header flame and the Streak widget.

export interface Streaks {
  current: number;
  best: number;
  perfect: number;
}

/** Runs within one calendar year; `current` counts from yesterday while today is still unmarked */
export function computeStreaks(
  year: number,
  months: YearMonthSummary[],
  today: { month: number; day: number } | null
): Streaks {
  // one flag per day of the year, so runs cross month borders
  const active: boolean[] = [];
  const perfect: boolean[] = [];
  let todayIdx = -1;
  for (let m = 0; m < 12; m++) {
    const count = months[m]?.habitCount ?? 0;
    for (let d = 1; d <= monthLength(year, m); d++) {
      if (m === today?.month && d === today.day) todayIdx = active.length;
      const done = months[m]?.tallies[d]?.done ?? 0;
      active.push(done > 0);
      perfect.push(count > 0 && done >= count);
    }
  }

  let best = 0;
  let run = 0;
  for (const a of active) {
    run = a ? run + 1 : 0;
    if (run > best) best = run;
  }

  if (todayIdx < 0) return { current: 0, best, perfect: 0 };

  const countBack = (flags: boolean[]) => {
    let n = 0;
    for (let i = flags[todayIdx] ? todayIdx : todayIdx - 1; i >= 0 && flags[i]; i--) n++;
    return n;
  };

  return { current: countBack(active), best, perfect: countBack(perfect) };
}
