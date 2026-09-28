import { MARK_WINDOW_DAYS } from './dates';
import { MonthData, cellKey } from './types';

/**
 * Once a day leaves the marking window it closes, and every habit left blank on
 * it becomes missed. Days are closed forward from a saved date, so nothing from
 * before this existed, or from before a habit was added, is touched.
 */

/** A run of closed days inside one month */
export interface ClosedSpan {
  year: number;
  /** 0-based */
  month: number;
  from: number;
  to: number;
}

/** The newest day past marking at `now`: the day before yesterday */
export function lastClosedDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - MARK_WINDOW_DAYS);
}

/** `2026-09-25`, in local time */
export function dayStamp(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function parseStamp(stamp: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stamp);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** The days after `after` up to and including `through`, one span per month */
export function spansBetween(after: Date, through: Date): ClosedSpan[] {
  const out: ClosedSpan[] = [];
  let d = new Date(after.getFullYear(), after.getMonth(), after.getDate() + 1);
  while (d.getTime() <= through.getTime()) {
    const year = d.getFullYear();
    const month = d.getMonth();
    const monthEnd = new Date(year, month + 1, 0);
    const end = monthEnd.getTime() < through.getTime() ? monthEnd : through;
    out.push({ year, month, from: d.getDate(), to: end.getDate() });
    d = new Date(year, month + 1, 1);
  }
  return out;
}

/**
 * What has closed since `stored` (the last saved stamp), and the stamp to save
 * once it is applied, or null when there is nothing to save. A phone with no
 * stamp closes nothing: it only starts counting.
 */
export function closuresSince(
  stored: string | null,
  now: Date
): { spans: ClosedSpan[]; through: string | null } {
  const last = lastClosedDay(now);
  const since = stored ? parseStamp(stored) : null;
  if (!since) return { spans: [], through: dayStamp(last) };
  const spans = spansBetween(since, last);
  return { spans, through: spans.length ? dayStamp(last) : null };
}

/** Every blank cell on days `from` to `to` marked missed, or `data` itself when none were blank */
export function markMissed(data: MonthData, from: number, to: number): MonthData {
  let grid: MonthData['grid'] | null = null;
  for (let day = from; day <= to; day++) {
    for (const h of data.habits) {
      const key = cellKey(day, h.id);
      if (data.grid[key]) continue;
      if (!grid) grid = { ...data.grid };
      grid[key] = 2;
    }
  }
  return grid ? { ...data, grid } : data;
}
