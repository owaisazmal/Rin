import { CellState } from './types';

/**
 * Which cells can be marked. Today can be marked and changed freely. A past day,
 * in any month, can be filled in wherever it was left blank, but a mark already
 * there stays as it was; a day that hasn't come yet can't be marked at all.
 */

export interface DayRef {
  year: number;
  /** 0-based */
  month: number;
  day: number;
}

export type DayWhen = 'past' | 'today' | 'future';

export function dayWhen(year: number, month: number, day: number, today: DayRef): DayWhen {
  const a = year * 10000 + month * 100 + day;
  const b = today.year * 10000 + today.month * 100 + today.day;
  return a < b ? 'past' : a > b ? 'future' : 'today';
}

/**
 * `filledNow` is a past-day cell filled in during this visit to the month, which
 * stays changeable until the visit ends, so a mis-tap isn't permanent.
 */
export function canMark(when: DayWhen, state: CellState, filledNow = false): boolean {
  if (when === 'today') return true;
  if (when === 'future') return false;
  return state === 0 || filledNow;
}
