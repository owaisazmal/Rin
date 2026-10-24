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

/** "Fri 3 Oct" */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
}

/** "2026-09": a month's name on disk, in the backup and in exports, always zero-padded */
export function monthDocKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}
