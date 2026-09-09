import { useCallback, useEffect, useRef, useState } from 'react';
import { Task, nextTaskId, readTasksForEditing, saveTasks } from '../tasks';
import { clearUnvouched, markDirty, recordUnvouched } from '../syncLedger';

/**
 * The deadline list: what's on it, and every way it can change.
 *
 * Mirrors `useMonthData` — loading, debounced persistence and named mutations —
 * but keyed to nothing, because tasks aren't filed under a month. Loaded once
 * for the life of the screen rather than per month, so moving between months
 * never drops a deadline out of the reminder schedule.
 */

const SAVE_DEBOUNCE_MS = 400;

/** Where the open deadlines live on the server; finished ones go to a year */
const CURRENT = 'current';

/**
 * Which document on the server a deadline belongs in.
 *
 * The list is one flat thing on the phone but not on the wire: everything still
 * open travels together in `current`, and a finished deadline is filed under
 * the year it was finished in, so years of ticked-off tasks stop being re-sent
 * every time a new one is written down.
 *
 * Two kinds of task have no year to be filed under and stay where they already
 * are. One is a task ticked off before completion times were recorded, which
 * `tasks.ts` describes as "finished, time unknown" — guessing a year for it
 * would file it under a date nobody chose. The other is a completion time from
 * a clock that has wandered outside the `20xx` ids `firestore.rules` accepts:
 * addressing a document the server will refuse loses the task, and leaving it
 * in `current` costs nothing but a little space in the open list.
 */
export function taskShardKey(task: Task): string {
  if (!task.done || typeof task.completedAt !== 'number' || !Number.isFinite(task.completedAt)) {
    return CURRENT;
  }
  const year = String(new Date(task.completedAt).getFullYear());
  return /^20[0-9]{2}$/.test(year) ? year : CURRENT;
}

/** 18:00 today if that's still ahead, otherwise 18:00 tomorrow */
function defaultDue(now = new Date()): number {
  const at = new Date(now);
  at.setHours(18, 0, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at.getTime();
}

export interface TaskStore {
  tasks: Task[];
  loaded: boolean;
  /**
   * Whether the rows on screen are the whole of what is stored.
   *
   * False means the list is being shown but must not be written back, and the
   * screen showing it has to say so — a deadline typed into a list that cannot
   * be saved would vanish without a word.
   */
  vouched: boolean;
  addTask: () => void;
  setTaskText: (id: string, text: string) => void;
  setTaskDue: (id: string, due: number) => void;
  toggleTaskDone: (id: string) => void;
  removeTask: (id: string) => void;
  findTask: (id: string) => Task | undefined;
}

export function useTasks(): TaskStore {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Documents a user edit has changed that the ledger hasn't been told about */
  const touched = useRef<Set<string>>(new Set());
  /**
   * Whether the record this list was read from was understood in full. A ref
   * for the reason `useMonthData` gives: it gates the write rather than the
   * render, and it is set before `loaded` flips, so the render that first shows
   * the list is the render that first sees it.
   *
   * Nothing resets it, because this hook loads once for the life of the screen.
   */
  const vouched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    readTasksForEditing().then(({ data, complete, lost }) => {
      /**
       * What this read found, told to the ledger, for the reason set out at
       * length in `useMonthData`: a record damaged on disk changes nothing, the
       * backup only ever looks at what changed, and so a screen reading it is
       * the one moment anybody finds out. A local write, no dirty flag, and no
       * run — a list this phone cannot read has nothing the backup should be
       * sent, since the only thing it could send is the rows that survived.
       *
       * Filed under `current` alone, though the damage is not really about one
       * document at all: the deadlines are a single record on this phone, and
       * the year shards are how that record is divided up on the way to the
       * server. `current` is the one every edit touches and the one that
       * carries the open list, so it is the document to name. Naming every
       * shard the ledger has ever heard of would need a ledger read this hook
       * has no other reason to make, and would say the same thing five times.
       */
      if (complete) clearUnvouched(CURRENT);
      else recordUnvouched(CURRENT, lost ?? '');

      if (cancelled) return;
      vouched.current = complete;
      setTasks(data);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The one door every mutation below goes through, for the reason set out in
   * `useMonthData`: the ledger has to hear about a change from the edit that
   * made it, never from the save, because a restore saves every document it
   * downloads and marking those dirty would send the whole list straight back.
   *
   * Which documents a change touched is worked out by comparing the list before
   * against the list after, rather than being stated at each call site. The
   * mutators replace only the rows they change, so a row that left the list or
   * arrived in it is exactly a row whose document has to be rewritten. Ticking
   * a deadline off is the case that earns this: the task leaves `current` and
   * lands in a year shard, both ends have to be sent, and a call site is an
   * easy place to remember one of them and forget the other. A mutator that
   * rebuilt the whole list would mark every shard it can see, which is one
   * upload too many rather than one too few.
   */
  const edit = useCallback((change: (prev: Task[]) => Task[]) => {
    setTasks((prev) => {
      const next = change(prev);
      if (next === prev) return prev;
      // `current` always: it carries the open deadlines, and every mutation
      // here either adds one, drops one, or moves one across its edge
      touched.current.add(CURRENT);
      const before = new Set(prev);
      const after = new Set(next);
      for (const task of prev) if (!after.has(task)) touched.current.add(taskShardKey(task));
      for (const task of next) if (!before.has(task)) touched.current.add(taskShardKey(task));
      return next;
    });
  }, []);

  /**
   * Hand the touched documents to the ledger, once each. Emptied before the
   * calls rather than after: `markDirty` is best-effort like every other store
   * here, and a flag lost to a failed write costs one upload that the next
   * backup works out from digests anyway.
   */
  const reportEdits = useCallback(() => {
    if (touched.current.size === 0) return;
    const keys = [...touched.current];
    touched.current.clear();
    for (const key of keys) markDirty(key);
    /**
     * And the list is no longer one this phone cannot read. This is only ever
     * called from the debounce, immediately after the whole list has gone to
     * disk, so by here the record really has been rewritten whole — which is
     * what makes adding a deadline the repair the backup screens describe.
     * Under `current`, because that is the only key the note is ever filed
     * under; free when there was nothing noted.
     */
    clearUnvouched(CURRENT);
  }, []);

  /**
   * Write the list out, a moment after it stops changing.
   *
   * Gated on the read as well as on the load, and it matters more here than it
   * does for a month: the deadlines are one document for the whole phone, so a
   * list written back after being half read is every dropped row gone at once.
   * This effect fires when `loaded` flips, so without the second half of the
   * guard merely opening the planner would do it — and the record is genuinely
   * whole afterwards, which is how the thinned list then goes over the good
   * copy in the backup as an ordinary edit, with nothing anywhere to say so.
   *
   * A deliberate edit is the exception, exactly as in `useMonthData`. The guard
   * is about writes nobody asked for; refusing one somebody typed would leave
   * the list unusable, and adding a deadline is how a person rebuilds one.
   */
  useEffect(() => {
    if (!loaded) return;
    const repairing = touched.current.size > 0;
    if (!vouched.current && !repairing) return;
    // The repair rewrites the list whole, so what lands is vouchable from here.
    if (repairing) vouched.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTasks(tasks);
      reportEdits();
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [tasks, loaded, reportEdits]);

  /**
   * Lands with a sensible deadline already on it rather than opening the picker
   * straight away — the first thing anyone wants to type is what the task is,
   * and the date is one tap away on the row itself.
   */
  const addTask = useCallback(() => {
    edit((prev) => [
      ...prev,
      { id: nextTaskId(prev), text: '', due: defaultDue(), done: false },
    ]);
  }, [edit]);

  const setTaskText = useCallback(
    (id: string, text: string) => {
      edit((prev) => prev.map((t) => (t.id === id ? { ...t, text } : t)));
    },
    [edit]
  );

  const setTaskDue = useCallback(
    (id: string, due: number) => {
      edit((prev) => prev.map((t) => (t.id === id ? { ...t, due } : t)));
    },
    [edit]
  );

  /**
   * Stamps the moment it was finished, and clears that again if it is un-ticked
   * — the history is a record of what happened, so a task that goes back to
   * unfinished should leave nothing behind claiming otherwise.
   *
   * This is also the only mutation that moves a task between documents, which
   * `edit` handles by marking both the shard it came from and the one it goes
   * to — the year it was finished in when it is ticked, and `current` when it
   * is un-ticked and the year shard it was in has to lose it.
   */
  const toggleTaskDone = useCallback(
    (id: string) => {
      edit((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, done: !t.done, completedAt: t.done ? undefined : Date.now() }
            : t
        )
      );
    },
    [edit]
  );

  const removeTask = useCallback(
    (id: string) => {
      edit((prev) => prev.filter((t) => t.id !== id));
    },
    [edit]
  );

  const findTask = useCallback(
    (id: string): Task | undefined => tasks.find((t) => t.id === id),
    [tasks]
  );

  return {
    tasks,
    loaded,
    vouched: vouched.current,
    addTask,
    setTaskText,
    setTaskDue,
    toggleTaskDone,
    removeTask,
    findTask,
  };
}
