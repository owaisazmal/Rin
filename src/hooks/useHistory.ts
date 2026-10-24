import { useCallback, useEffect, useMemo, useState } from 'react';
import { MonthRecord, loadMonthWindow } from '../storage';
import { Task } from '../tasks';
import { HistoryDay, buildHistory } from '../history';

// Read in a window, since a full read would grow with every month of use.
const INITIAL_MONTHS = 6;
const MORE_MONTHS = 6;

export function useHistory(tasks: Task[], enabled: boolean, now: number) {
  const [span, setSpan] = useState(INITIAL_MONTHS);
  const [records, setRecords] = useState<MonthRecord[] | null>(null);
  const [loading, setLoading] = useState(false);

  // re-read on every open, so marks made in the planner meanwhile show up
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);

    const today = new Date();
    loadMonthWindow(today.getFullYear(), today.getMonth(), span).then((loaded) => {
      if (cancelled) return;
      setRecords(loaded);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, span]);

  // collapsed on close, so the next open starts cheap again
  useEffect(() => {
    if (!enabled) setSpan(INITIAL_MONTHS);
  }, [enabled]);

  const days: HistoryDay[] = useMemo(
    () => (records ? buildHistory(records, tasks, now) : []),
    [records, tasks, now]
  );

  const loadMore = useCallback(() => setSpan((s) => s + MORE_MONTHS), []);

  // judged on the oldest batch, since one quiet month says nothing about the year behind it
  const canLoadMore =
    !loading &&
    !!records?.length &&
    records.slice(-MORE_MONTHS).some((r) => Object.keys(r.data.grid).length > 0);

  return {
    days,
    /** nothing to show yet, so the spinner shows before the first read has even started */
    loading: records === null,
    /** a later read, with the previous page still in place underneath */
    loadingMore: loading && records !== null,
    loadMore,
    canLoadMore,
  };
}
