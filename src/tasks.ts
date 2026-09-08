import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Tasks that are due by a certain moment.
 *
 * Deliberately not part of `MonthData`. A deadline is anchored to a date, not
 * to the month you happen to have open: a task written in August and due in
 * October belongs to neither month's page, and its reminders have to keep
 * firing while you browse September. So it is one flat list, ordered by time
 * and nothing else.
 */

export interface Task {
  /** stable id, so reminders and rows survive edits and reordering */
  id: string;
  text: string;
  /** the deadline itself, epoch milliseconds */
  due: number;
  done: boolean;
  /**
   * When it was actually finished, epoch milliseconds. Absent on a task that
   * isn't done, and on anything ticked off before this was recorded — history
   * treats a missing value as "finished, time unknown" rather than guessing.
   */
  completedAt?: number;
}

const TASKS_KEY = '@monthly-planning/tasks';

export function nextTaskId(tasks: Task[]): string {
  const max = tasks.reduce((m, t) => {
    const n = parseInt(t.id, 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, -1);
  return String(max + 1);
}

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
    .map((t) => ({
      ...t,
      // an unfinished task has no completion time, whatever an older or
      // hand-edited record might claim
      completedAt: t.done && typeof t.completedAt === 'number' ? t.completedAt : undefined,
    }));
}

export async function loadTasks(): Promise<Task[]> {
  try {
    const raw = await AsyncStorage.getItem(TASKS_KEY);
    return raw ? parseTasks(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  try {
    await AsyncStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  } catch {
    // best-effort persistence, matching the rest of the app's stores
  }
}
