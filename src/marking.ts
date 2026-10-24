import { CellState } from './types';

// Today changes freely, a past day only fills its blanks, and a future day can't be marked.

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

/** `filledNow`: a past cell filled during this visit stays changeable, so a mis-tap isn't permanent */
export function canMark(when: DayWhen, state: CellState, filledNow = false): boolean {
  if (when === 'today') return true;
  if (when === 'future') return false;
  return state === 0 || filledNow;
}
