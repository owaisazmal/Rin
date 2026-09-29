import { useEffect, useMemo, useState } from 'react';
import { MonthData, dayTally } from '../types';
import { YearMonthSummary, loadYearSummary } from '../storage';

/**
 * Every month of `year`, with the open one's live tallies laid over the
 * persisted snapshot — so the year grid reflects an edit before the debounced
 * save has caught up.
 *
 * `month` is a dependency as well as `year`: edits made in a month have to be
 * re-read after navigating away, and the caller flushes the write first.
 *
 * Returns null until the load lands, or while the loaded year is stale.
 */
export function useYearSummary(
  year: number,
  month: number,
  data: MonthData,
  daysInMonth: number
): YearMonthSummary[] | null {
  const [summary, setSummary] = useState<{
    year: number;
    months: YearMonthSummary[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadYearSummary(year).then((months) => {
      if (!cancelled) setSummary({ year, months });
    });
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  return useMemo(() => {
    if (!summary || summary.year !== year) return null;
    const tallies: YearMonthSummary['tallies'] = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const t = dayTally(data.grid, data.habits, d);
      if (t.done || t.missed) tallies[d] = t;
    }
    const months = summary.months.slice();
    months[month] = { habitCount: data.habits.length, tallies };
    return months;
  }, [summary, year, month, data, daysInMonth]);
}
