import { useEffect, useMemo, useRef, useState } from 'react';
import { YearMonthSummary, listStoredMonths, loadYearSummary } from '../storage';
import {
  YearBlock,
  YearSpan,
  YearSpanStats,
  spanContains,
  spanMonths,
  spanStats,
} from '../yearGrid';

const EMPTY_MONTH: YearMonthSummary = { habitCount: 0, tallies: {} };

/** The year grid's span; separate from useYearSummary, whose January-first array the widgets depend on */
export function useYearWindow({
  now,
  browsedYear,
  browsedMonth,
  browsedMonths,
}: {
  now: { year: number; month: number; day: number };
  /** the calendar year open in the planner */
  browsedYear: number;
  browsedMonth: number;
  /** that year's summaries with the open month's live edits laid over them */
  browsedMonths: YearMonthSummary[] | null;
}): {
  span: YearSpan;
  setSpan: (span: YearSpan) => void;
  /** calendar years offered in the picker, newest first */
  years: number[];
  /** the twelve blocks to draw, oldest first, or null before the first load */
  blocks: YearBlock[] | null;
  stats: YearSpanStats;
} {
  const [span, setSpan] = useState<YearSpan>({ kind: 'rolling' });
  const [stored, setStored] = useState<number[]>([]);
  const [loaded, setLoaded] = useState<Record<number, YearMonthSummary[]>>({});

  const { year: nowYear, month: nowMonth } = now;
  const months = useMemo(
    () => spanMonths(span, { year: nowYear, month: nowMonth }),
    [span, nowYear, nowMonth]
  );

  // Paging the planner (or the clock) out of the span brings it along, preferring rolling; picking a span doesn't.
  const watched = useRef({
    year: browsedYear,
    month: browsedMonth,
    nowKey: now.year * 12 + now.month,
  });
  useEffect(() => {
    const at = { year: browsedYear, month: browsedMonth };
    const nowKey = now.year * 12 + now.month;
    const changed =
      watched.current.year !== at.year ||
      watched.current.month !== at.month ||
      watched.current.nowKey !== nowKey;
    watched.current = { ...at, nowKey };
    if (!changed || spanContains(months, at)) return;
    const rolling = spanMonths({ kind: 'rolling' }, now);
    setSpan(spanContains(rolling, at) ? { kind: 'rolling' } : { kind: 'calendar', year: browsedYear });
    // `months` left out, or this would re-run against the span it just chose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsedYear, browsedMonth, now.year, now.month]);

  // the picker's years, re-read as writing in a new year adds one
  useEffect(() => {
    let cancelled = false;
    listStoredMonths().then((list) => {
      if (!cancelled) setStored(list.map((m) => m.year));
    });
    return () => {
      cancelled = true;
    };
  }, [browsedYear]);

  const years = useMemo(() => {
    const all = new Set<number>(stored);
    all.add(now.year);
    all.add(browsedYear);
    return [...all].sort((a, b) => b - a);
  }, [stored, now.year, browsedYear]);

  // years in the span other than the browsed one, which arrives live; re-read on each month change
  const needed = useMemo(() => {
    const set = new Set(months.map((m) => m.year));
    set.delete(browsedYear);
    return [...set].sort();
  }, [months, browsedYear]);
  const neededKey = needed.join(',');

  useEffect(() => {
    // nothing cleared either, which would re-render all 365 cells for nothing
    if (needed.length === 0) return;
    let cancelled = false;
    Promise.all(needed.map((y) => loadYearSummary(y))).then((results) => {
      if (cancelled) return;
      // merged, so a year being refreshed keeps its old numbers rather than drawing empty
      setLoaded((prev) => {
        const next = { ...prev };
        needed.forEach((y, i) => {
          next[y] = results[i];
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // `needed` is rebuilt on every render; its contents are what matter.
    // `browsedMonth` is here so paging re-reads the neighbouring year too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededKey, browsedYear, browsedMonth]);

  const built = useMemo(() => {
    if (!browsedMonths) return null;
    return months.map(({ year, month }) => ({
      year,
      month,
      summary:
        (year === browsedYear ? browsedMonths[month] : loaded[year]?.[month]) ?? EMPTY_MONTH,
    }));
  }, [months, browsedYear, browsedMonths, loaded]);

  // the last full grid, held while a year change loads so the card doesn't collapse mid-tap
  const held = useRef<YearBlock[] | null>(null);
  if (built) held.current = built;
  const blocks = built ?? held.current;

  const stats = useMemo<YearSpanStats>(() => spanStats(blocks ?? []), [blocks]);

  return { span, setSpan, years, blocks, stats };
}
