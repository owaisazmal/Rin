import { nextDue, parseRepeat } from './recurring';
import { forEditing, readJson, readVouched, writeJson } from './storage';
import type { ForEditing, VouchedRead, VouchedValue } from './storage';
import { nextId } from './types';

export type { VouchedValue } from './storage';

/** A deadline; kept out of `MonthData` because it belongs to a date, not to the month that is open */
export interface Task {
  /** stable id, so reminders and rows survive edits and reordering */
  id: string;
  text: string;
  /** the deadline itself, epoch milliseconds */
  due: number;
  done: boolean;
  /** epoch ms; absent on a task finished before this was recorded, which history files as time unknown */
  completedAt?: number;
  /** absent on a one-off; a finished occurrence keeps it to say which series it was */
  repeat?: Repeat;
}

export type RepeatEvery = 'week' | 'month' | 'year';

export interface Repeat {
  every: RepeatEvery;
  /** day of the month for monthly and yearly, so a clamped 31st goes back to the 31st */
  day?: number;
}

export const MAX_TASK_TEXT = 200;

export const TASKS_KEY = '@monthly-planning/tasks';

/** Drops anything that isn't a usable task rather than letting it reach the UI */
export function parseTasks(raw: unknown): Task[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is Task =>
        !!t &&
        typeof t.id === 'string' &&
        typeof t.text === 'string' &&
        typeof t.due === 'number' &&
        Number.isFinite(t.due) &&
        typeof t.done === 'boolean'
    )
    .map(({ repeat, ...t }) => {
      const rule = parseRepeat(repeat, t.due);
      return {
        ...t,
        // an unfinished task has no completion time, whatever an old record claims
        completedAt: t.done && typeof t.completedAt === 'number' ? t.completedAt : undefined,
        ...(rule && { repeat: rule }),
      };
    });
}

/** Ticks or un-ticks a deadline; ticking a recurring one adds its next occurrence */
export function toggleDone(tasks: Task[], id: string, now: number): Task[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return tasks;
  if (task.done) {
    // reopened as a one-off, so a finished occurrence can never start a second series
    const { repeat: _rule, ...open } = task;
    return tasks.map((t) => (t === task ? { ...open, done: false, completedAt: undefined } : t));
  }
  const finished = { ...task, done: true, completedAt: now };
  const { repeat } = task;
  if (!repeat) return tasks.map((t) => (t === task ? finished : t));
  // the open row keeps its id and moves on; the finished one is filed under a new id
  return [
    ...tasks.map((t) => (t === task ? { ...t, due: nextDue(t.due, repeat, now) } : t)),
    { ...finished, id: nextId(tasks) },
  ];
}

export async function loadTasks(): Promise<Task[]> {
  return parseTasks(await readJson(TASKS_KEY));
}

/** Whether a parsed deadline list lost rows; the disk read and the backup pull share it */
export function vouchTasksValue(raw: unknown): VouchedValue<Task[]> {
  if (!Array.isArray(raw)) return { status: 'unreadable' };
  // only rows count: clearing a stray completion time is a correction, not a loss
  const data = parseTasks(raw);
  if (data.length === raw.length) return { status: 'complete', data };
  return {
    status: 'partial',
    data,
    lost: `${raw.length - data.length} of ${raw.length} deadlines`,
  };
}

/** The deadline list read the way the backup needs it, telling absent apart from unreadable */
export function readTasksVouched(): Promise<VouchedRead<Task[]>> {
  return readVouched(TASKS_KEY, vouchTasksValue);
}

/** The reader for the screen that also saves the list */
export async function readTasksForEditing(): Promise<ForEditing<Task[]>> {
  return forEditing(await readTasksVouched(), []);
}

export function saveTasks(tasks: Task[]): Promise<void> {
  return writeJson(TASKS_KEY, tasks);
}
