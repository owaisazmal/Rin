import { useEffect, useState } from 'react';
import { YearMonthSummary } from '../storage';
import { computeStreaks } from '../streaks';

/** Today's streak, whatever month is browsed; another year holds the last count rather than a false zero */
export function useCurrentStreak(year: number, months: YearMonthSummary[] | null): number {
  const [days, setDays] = useState(0);

  useEffect(() => {
    const now = new Date();
    if (!months || year !== now.getFullYear()) return;
    setDays(
      computeStreaks(year, months, { month: now.getMonth(), day: now.getDate() }).current
    );
  }, [months, year]);

  return days;
}
