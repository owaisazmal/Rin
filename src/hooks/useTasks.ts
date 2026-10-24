import { useCallback, useEffect, useRef, useState } from 'react';
import { RepeatEvery, Task, readTasksForEditing, saveTasks, toggleDone } from '../tasks';
import { repeatFor } from '../recurring';
import { clearUnvouched, markDirty, recordUnvouched } from '../syncLedger';
import { nextId } from '../types';

const SAVE_DEBOUNCE_MS = 400;

/** Where the open deadlines live on the server; finished ones go to a year */
const CURRENT = 'current';

/** A deadline's server document: the year it was finished, or `current` when open, undated or outside `20xx` */
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
  /** false: shown but not saved until edited, which the screen has to say */
  vouched: boolean;
  addTask: () => void;
  setTaskText: (id: string, text: string) => void;
  setTaskDue: (id: string, due: number, every: RepeatEvery | null) => void;
  toggleTaskDone: (id: string) => void;
  removeTask: (id: string) => void;
  findTask: (id: string) => Task | undefined;
}

/** The deadline list, loaded once for the screen's life so paging months never drops a reminder */
export function useTasks(): TaskStore {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Documents a user edit has changed that the ledger hasn't been told about */
  const touched = useRef<Set<string>>(new Set());
  // whether the record was read in full, as in useMonthData
  const vouched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    readTasksForEditing().then(({ data, complete, lost }) => {
      // tell the ledger what the read found, under `current`, the document every edit touches
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

  // the one door for edits; a row that left or joined the list marks its shard, so a tick marks both ends
  const edit = useCallback((change: (prev: Task[]) => Task[]) => {
    setTasks((prev) => {
      const next = change(prev);
      if (next === prev) return prev;
      touched.current.add(CURRENT);
      const before = new Set(prev);
      const after = new Set(next);
      for (const task of prev) if (!after.has(task)) touched.current.add(taskShardKey(task));
      for (const task of next) if (!before.has(task)) touched.current.add(taskShardKey(task));
      return next;
    });
  }, []);

  /** Hands the touched documents to the ledger once each; only called right after the whole list was saved */
  const reportEdits = useCallback(() => {
    if (touched.current.size === 0) return;
    const keys = [...touched.current];
    touched.current.clear();
    for (const key of keys) markDirty(key);
    // the save rewrote the list whole, which repairs any damage
    clearUnvouched(CURRENT);
  }, []);

  // a half-read list is only saved once somebody edits it, as in useMonthData
  useEffect(() => {
    if (!loaded) return;
    const repairing = touched.current.size > 0;
    if (!vouched.current && !repairing) return;
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

  /** Lands with a sensible deadline, since what people type first is the task itself */
  const addTask = useCallback(() => {
    edit((prev) => [...prev, { id: nextId(prev), text: '', due: defaultDue(), done: false }]);
  }, [edit]);

  const setTaskText = useCallback(
    (id: string, text: string) => {
      edit((prev) => prev.map((t) => (t.id === id ? { ...t, text } : t)));
    },
    [edit]
  );

  const setTaskDue = useCallback(
    (id: string, due: number, every: RepeatEvery | null) => {
      edit((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const { repeat: _old, ...rest } = t;
          const repeat = repeatFor(every, due, t);
          return repeat ? { ...rest, due, repeat } : { ...rest, due };
        })
      );
    },
    [edit]
  );

  const toggleTaskDone = useCallback(
    (id: string) => {
      edit((prev) => toggleDone(prev, id, Date.now()));
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
