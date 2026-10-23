import { monthLength } from './dates';
import type { Repeat, RepeatEvery } from './tasks';

/** Date maths for recurring deadlines; only the open occurrence of a series exists */

const EVERY: readonly RepeatEvery[] = ['week', 'month', 'year'];

/** A usable rule, or undefined; a monthly or yearly rule with no usable day takes the due date's */
export function parseRepeat(raw: unknown, due: number): Repeat | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { every, day } = raw as { every?: unknown; day?: unknown };
  if (!EVERY.includes(every as RepeatEvery)) return undefined;
  if (every === 'week') return { every };
  const valid = typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 31;
  return { every: every as RepeatEvery, day: valid ? day : new Date(due).getDate() };
}

/** The rule for a deadline moved to `due`; an untouched date keeps the series' own day */
export function repeatFor(
  every: RepeatEvery | null,
  due: number,
  prev?: { due: number; repeat?: Repeat }
): Repeat | undefined {
  if (!every) return undefined;
  if (every === 'week') return { every };
  const keep =
    prev?.repeat?.every === every && prev.repeat.day !== undefined && sameDate(prev.due, due);
  return { every, day: keep ? prev.repeat!.day : new Date(due).getDate() };
}

function sameDate(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** One step along the series, at the same local time; a short month clamps to its last day */
export function stepDue(due: number, rule: Repeat): number {
  const d = new Date(due);
  if (rule.every === 'week') {
    d.setDate(d.getDate() + 7);
    return d.getTime();
  }
  const year = d.getFullYear();
  const month = d.getMonth() + (rule.every === 'month' ? 1 : 12);
  const day = Math.min(rule.day ?? d.getDate(), monthLength(year, month));
  return new Date(
    year, month, day, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()
  ).getTime();
}

/** The first occurrence after both `due` and `after`, so a late tick leaves no backlog */
export function nextDue(due: number, rule: Repeat, after: number): number {
  let next = stepDue(due, rule);
  while (next <= after) next = stepDue(next, rule);
  return next;
}

/** What a series on this date does when the day runs out, or null when it never does */
export function clampNote(every: RepeatEvery | null, due: number): string | null {
  const d = new Date(due);
  const day = d.getDate();
  if (every === 'month' && day > 28) {
    return `Months without a ${day}${day === 31 ? 'st' : 'th'} use their last day.`;
  }
  if (every === 'year' && d.getMonth() === 1 && day === 29) {
    return 'Falls on 28 Feb outside leap years.';
  }
  return null;
}

/** "weekly" / "monthly" / "yearly" */
export function repeatLabel(every: RepeatEvery): string {
  return every === 'week' ? 'weekly' : every === 'month' ? 'monthly' : 'yearly';
}
