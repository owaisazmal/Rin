import AsyncStorage from '@react-native-async-storage/async-storage';
import type { VouchedRead } from './storage';

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

/** A deadline's own field limit; the group in `types.ts` explains the sizing. */
export const MAX_TASK_TEXT = 200;

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

/**
 * `VouchedRead` is declared in `storage.ts`, next to the lossy month readers it
 * exists to qualify, and imported here as a type only — nothing about the month
 * store reaches this module at runtime. Re-exported so a caller can take the
 * reader and the shape of its answer from the same place.
 */
export type { VouchedRead } from './storage';

/**
 * The deadline list read the way the backup needs it.
 *
 * `loadTasks` answers an empty list for a phone that has never saved a
 * deadline, for a file that will not parse, and for a store that will not
 * answer. Every screen is right not to care — it draws nothing in all three
 * cases. Backing up is the one caller for which the difference is the entire
 * question, because the first means the deadlines were deleted and the others
 * mean do not touch the archive. So this is the same single read, saying
 * afterwards which of them it was.
 */
export async function readTasksVouched(): Promise<VouchedRead<Task[]>> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(TASKS_KEY);
  } catch {
    // a store that will not answer is not a phone with no deadlines
    return { status: 'unreadable' };
  }
  if (raw === null || raw === undefined) return { status: 'absent' };

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return { status: 'unreadable' };
  }
  // a list stored as something that is not a list is a record this phone
  // cannot read, not a list that lost rows
  if (!Array.isArray(stored)) return { status: 'unreadable' };

  const data = parseTasks(stored);
  if (data.length === stored.length) return { status: 'complete', data };
  /**
   * Rows are all that is counted. `parseTasks` also clears a completion time
   * off a task that is not done, and that is the parser doing its documented
   * job on a value nothing should have written — the deadline itself is still
   * there, so it is a correction rather than a loss, and calling it one would
   * block the backup of every half-migrated list.
   */
  return {
    status: 'partial',
    data,
    lost: `${stored.length - data.length} of ${stored.length} deadlines`,
  };
}

/** A deadline list to draw, and whether the record it came from was whole */
export interface TasksForEditing {
  /** the rows that survived, or an empty list when nothing could be read */
  data: Task[];
  /** false when the bytes on disk held more rows than `data` does */
  complete: boolean;
}

/**
 * The reader for the screen that also writes what it read — the twin of
 * `readMonthForEditing` in `storage.ts`, and it exists for the same reason.
 *
 * `loadTasks` answers a half-parsed list with the rows that survived, which is
 * right for drawing it. It is wrong for a screen that then saves, because the
 * survivors go back over the record they survived and the dropped rows stop
 * being recoverable — at which point `readTasksVouched` says `complete`, the
 * thinned list backs up as an ordinary edit, and every guard in `sync.ts` is
 * looking at a record that no longer knows it was damaged. That is a deletion
 * of deadlines nobody touched, which is a bug whether or not this phone has
 * ever backed anything up.
 *
 * So: the same single read, something to draw in every case, and one flag
 * saying whether writing it back would be a save or a deletion. A caller that
 * writes must not write when `complete` is false.
 *
 * `useTasks` is the caller this exists for.
 */
export async function readTasksForEditing(): Promise<TasksForEditing> {
  const record = await readTasksVouched();
  switch (record.status) {
    case 'complete':
      return { data: record.data, complete: true };
    case 'partial':
      return { data: record.data, complete: false };
    case 'absent':
      // nothing is stored under the key, which is a phone that has never
      // written a deadline. An empty list is exactly what is there, so writing
      // one back takes nothing away.
      return { data: [], complete: true };
    default:
      // the store would not answer, or the bytes are not JSON. There is nothing
      // to draw but an empty list, and saving that empty list is how every
      // deadline on this phone goes at once.
      return { data: [], complete: false };
  }
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  try {
    await AsyncStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  } catch {
    // best-effort persistence, matching the rest of the app's stores
  }
}
