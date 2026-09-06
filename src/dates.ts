/**
 * Calendar arithmetic, and the names that go with it.
 *
 * Every module that reasons about time used to carry its own copy of these —
 * month names in three cases, a `startOfDay` in four files, the length of a
 * month in six. One place, so a change to how a date reads is a change in one
 * file, and so the tests pin one implementation rather than several.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Full names, upper case — how the planner, the picker and the widgets set them */
export const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
] as const;

export const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** Sunday first, matching `Date.getDay()` */
export const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** How many days `month` (0-based) has in `year` */
export function monthLength(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Local midnight of the day containing `ms`, as epoch milliseconds */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
