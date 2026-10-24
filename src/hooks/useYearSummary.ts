import { useEffect, useMemo, useState } from 'react';
import { MonthData } from '../types';
import { YearMonthSummary, loadYearSummary } from '../storage';
import { tallyMonth } from '../monthSummary';

/** Every month of `year` with the open month's live tallies laid over, or null while loading */
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

  // `month` too, so edits are re-read after navigating away
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
    const months = summary.months.slice();
    months[month] = tallyMonth(data, daysInMonth);
    return months;
  }, [summary, year, month, data, daysInMonth]);
}
