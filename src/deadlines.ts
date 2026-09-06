import type { Task } from './tasks';
import { DAY, DAY_ABBR, HOUR, MINUTE, MONTH_ABBR, startOfDay } from './dates';

/**
 * How close a deadline is, and how that should read.
 *
 * Kept apart from the component that draws it because three places need the
 * same answer: the planner section, the reminder schedule, and the widget
 * snapshot. If they disagreed, a task could look calm on screen while the
 * notifications were shouting.
 */

/**
 * The run-up over which a deadline turns from "someday" into "now".
 *
 * A week: long enough that the bar has actually moved by the time the first
 * reminder lands, short enough that a task set two months out isn't drawn as
 * though it were already creeping up.
 */
export const PRESSURE_WINDOW = 7 * DAY;

export type Urgency = 'done' | 'overdue' | 'now' | 'soon' | 'near' | 'later';

export function urgencyOf(task: Task, now: number): Urgency {
  if (task.done) return 'done';
  const left = task.due - now;
  if (left <= 0) return 'overdue';
  if (left <= HOUR) return 'now';
  if (left <= DAY) return 'soon';
  if (left <= 3 * DAY) return 'near';
  return 'later';
}

/** 0 a week or more out, 1 at the deadline and anywhere past it */
export function pressureOf(due: number, now: number): number {
  const left = due - now;
  if (left <= 0) return 1;
  if (left >= PRESSURE_WINDOW) return 0;
  return 1 - left / PRESSURE_WINDOW;
}

/** Coarse duration, largest unit only — "3d", "5h", "12m" */
function coarse(ms: number): string {
  if (ms >= DAY) return `${Math.floor(ms / DAY)}d`;
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h`;
  if (ms >= MINUTE) return `${Math.floor(ms / MINUTE)}m`;
  return 'moments';
}

/** "3d left" / "5h left" / "2d overdue" — the phrase next to the due date */
export function timeLeftLabel(due: number, now: number): string {
  const left = due - now;
  if (left <= 0) {
    const over = coarse(-left);
    return over === 'moments' ? 'just overdue' : `${over} overdue`;
  }
  const rem = coarse(left);
  return rem === 'moments' ? 'due any moment' : `${rem} left`;
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * "Today · 18:00" / "Tomorrow · 09:00" / "Fri 3 Oct · 18:00".
 *
 * Named days for the two that matter most, since those are the ones read at a
 * glance; anything further out gets the date, because "in 4 days" makes the
 * reader do arithmetic they didn't ask for.
 */
export function dueLabel(due: number, now: number): string {
  const d = new Date(due);
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (days === 0) return `Today · ${hhmm(d)}`;
  if (days === 1) return `Tomorrow · ${hhmm(d)}`;
  if (days === -1) return `Yesterday · ${hhmm(d)}`;
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]} · ${hhmm(d)}`;
}

/**
 * Everything still to do, soonest first.
 *
 * What the planner's section shows. Blank rows are kept: one that was just
 * added has no text yet and would otherwise vanish while it was being typed
 * into. Finished tasks are gone from here entirely — they belong to history.
 */
export function unfinished(tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.done).sort((a, b) => a.due - b.due);
}

/**
 * The same list, minus anything still unnamed — for the widgets and the
 * reminders, which are seen away from the app and have no business announcing
 * an untitled task or nagging about one.
 */
export function pendingTasks(tasks: Task[]): Task[] {
  return unfinished(tasks).filter((t) => t.text.trim() !== '');
}
