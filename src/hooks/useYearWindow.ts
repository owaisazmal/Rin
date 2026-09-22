import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { YearMonthSummary, listStoredMonths, loadYearSummary } from '../storage';
import {
  YearBlock,
  YearSpan,
  YearSpanStats,
  spanContains,
  spanMonths,
  spanStats,
} from '../yearGrid';

export type { YearBlock, YearSpan, YearSpanStats } from '../yearGrid';

const EMPTY_MONTH: YearMonthSummary = { habitCount: 0, tallies: {} };

/**
 * Everything the year grid draws, for whichever span is on show.
 *
 * Kept apart from `useYearSummary` on purpose. That hook answers one calendar
 * year and its answer is a contract: index 0 is January, and the streak badge,
 * the widget snapshot and both native widget targets all index it that way. A
 * rolling span crosses New Year, so it cannot be that array under another name
 * — it is a second, view-only structure that borrows the browsed year's live
 * copy and loads whatever else it needs beside it.
 */
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

  const months = useMemo(() => spanMonths(span, now), [span, now.year, now.month]);

  /**
   * Paging the planner out of the span brings the span along.
   *
   * Without this, browsing back to a month the grid isn't showing leaves the
   * grid highlighting nothing — the chart quietly stops being about the month
   * underneath it. Rolling is preferred when the month fits in it, so stepping
   * back into the last twelve months restores the default rather than pinning
   * the calendar year it happened to pass through.
   *
   * It follows the planner moving, and the calendar moving under it, and
   * nothing else. Reacting to the span as well would make the picker useless:
   * choosing 2025 while the planner sat in September 2026 would put it straight
   * back to the rolling year, because the open month isn't in 2025 — which is
   * the whole point of having asked for 2025. Looking at a year you are not
   * writing in is allowed; being carried out of it is not.
   *
   * The clock is watched because a rolling span is defined by today: at
   * midnight on the 1st it slides forward a month and drops its oldest one, and
   * a planner left open on that month would be stranded outside a span nothing
   * had asked to change.
   */
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
    // Only what is watched above. `months` is read as it stands at the moment
    // something moves, which is the span the move is being judged against —
    // listing it would re-run this against the span it just chose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsedYear, browsedMonth, now.year, now.month]);

  // Which years the picker offers. Re-read when the browsed year moves, since
  // writing in a year the phone had never stored adds one to the list.
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

  /**
   * Any year in the span that isn't the browsed one has to be read from the
   * store — the browsed year arrives live from `useYearSummary`, and a rolling
   * span straddling New Year needs the one before it as well.
   *
   * Re-read on every month change rather than cached for the session: the read
   * is a twelve-key multiGet, and the alternative is a year going stale the
   * moment somebody edits a month in it and pages away.
   */
  const needed = useMemo(() => {
    const set = new Set(months.map((m) => m.year));
    set.delete(browsedYear);
    return [...set].sort();
  }, [months, browsedYear]);
  const neededKey = needed.join(',');

  useEffect(() => {
    // Nothing to fetch, and nothing to clear either: what is already held is
    // either about to be wanted again or costs a few hundred bytes to keep.
    // Emptying it here would hand the grid a new object on every month paged,
    // and re-render all 365 cells for it.
    if (needed.length === 0) return;
    let cancelled = false;
    Promise.all(needed.map((y) => loadYearSummary(y))).then((results) => {
      if (cancelled) return;
      // Merged, not replaced. A read in flight would otherwise leave the years
      // it is refreshing undefined, and an undefined year draws as twelve empty
      // months — so the headline would count a half-empty span and then jump
      // when the read landed. Last year's numbers for a moment beat wrong ones.
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

  /**
   * The last grid that was fully backed by data, held while the next one loads.
   *
   * `browsedMonths` goes null for a moment whenever the planner changes year,
   * which a tap on any cell outside the open year now does. Passing that null
   * on would unmount the chart and collapse the tracker card to its loading
   * spacer mid-tap — the card visibly jumping every time somebody follows the
   * grid into another year. A year-old grid for one frame is the quieter of the
   * two wrong answers, and the stats are derived from the same blocks, so what
   * is drawn and what is counted never disagree.
   */
  const held = useRef<YearBlock[] | null>(null);
  if (built) held.current = built;
  const blocks = built ?? held.current;

  const stats = useMemo<YearSpanStats>(() => spanStats(blocks ?? []), [blocks]);

  const setSpanStable = useCallback((next: YearSpan) => setSpan(next), []);

  return { span, setSpan: setSpanStable, years, blocks, stats };
}
