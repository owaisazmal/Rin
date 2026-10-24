import type { Task } from './tasks';
import { DAY, HOUR, MINUTE, shortDate, startOfDay } from './dates';

/** A week, so the bar has moved by the first reminder without far-off tasks looking urgent */
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

/** Coarse duration, largest unit only — "3d", "5h", "12m", or "moments" under a minute */
export function coarse(ms: number): string {
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

/** "Today · 18:00" / "Tomorrow · 09:00" / "Fri 3 Oct · 18:00" */
export function dueLabel(due: number, now: number): string {
  const d = new Date(due);
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (days === 0) return `Today · ${hhmm(d)}`;
  if (days === 1) return `Tomorrow · ${hhmm(d)}`;
  if (days === -1) return `Yesterday · ${hhmm(d)}`;
  return `${shortDate(due)} · ${hhmm(d)}`;
}

/** Everything still to do, soonest first; blank rows stay so one just added can be typed into */
export function unfinished(tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.done).sort((a, b) => a.due - b.due);
}

/** The same list minus unnamed rows, for the widgets and reminders seen away from the app */
export function pendingTasks(tasks: Task[]): Task[] {
  return unfinished(tasks).filter((t) => t.text.trim() !== '');
}
