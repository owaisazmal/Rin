import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CellState,
  Habit,
  MonthData,
  cellKey,
  emptyMonthData,
  nextHabitId,
} from '../types';
import { loadMonth, saveMonth } from '../storage';
import { monthLength } from '../dates';

/**
 * The open month: what's in it, and every way it can change.
 *
 * Owns loading, debounced persistence and mutation, so the screen above only
 * has to render and dispatch. Nothing here touches layout, animation or
 * dialogs — `removeHabit` deletes unconditionally and leaves the "are you
 * sure" to the caller, which is the part that belongs to the UI.
 */
export function useMonthData(year: number, month: number, today: number | null) {
  const [data, setData] = useState<MonthData>(emptyMonthData());
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ year: number; month: number; data: MonthData } | null>(null);

  const daysInMonth = monthLength(year, month);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    loadMonth(year, month).then((d) => {
      if (!cancelled) {
        setData(d);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  useEffect(() => {
    if (!loaded) return;
    pendingSave.current = { year, month, data };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveMonth(year, month, data);
      pendingSave.current = null;
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [data, loaded, year, month]);

  /** Write out pending edits now — used before navigating away from a month */
  const flushSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const p = pendingSave.current;
    if (p) {
      saveMonth(p.year, p.month, p.data);
      pendingSave.current = null;
    }
  }, []);

  /**
   * History is read-only: only the real current day can be marked. `today` is
   * null whenever the open month isn't the current one, which locks it
   * wholesale. Guarded here rather than only in the UI so no caller can slip
   * past it.
   */
  const setCell = useCallback(
    (day: number, habitId: string, state: CellState) => {
      if (day !== today) return;
      setData((prev) => {
        const key = cellKey(day, habitId);
        const grid = { ...prev.grid };
        if (state === 0) delete grid[key];
        else grid[key] = state;
        return { ...prev, grid };
      });
    },
    [today]
  );

  const cycleCell = useCallback(
    (day: number, habitId: string) => {
      if (day !== today) return;
      setData((prev) => {
        const key = cellKey(day, habitId);
        const next: CellState = (((prev.grid[key] ?? 0) + 1) % 3) as CellState;
        const grid = { ...prev.grid };
        if (next === 0) delete grid[key];
        else grid[key] = next;
        return { ...prev, grid };
      });
    },
    [today]
  );

  const addHabit = useCallback(() => {
    setData((prev) => ({
      ...prev,
      habits: [...prev.habits, { id: nextHabitId(prev.habits), name: '' }],
    }));
  }, []);

  const renameHabit = useCallback((id: string, name: string) => {
    setData((prev) => ({
      ...prev,
      habits: prev.habits.map((h) => (h.id === id ? { ...h, name } : h)),
    }));
  }, []);

  const removeHabit = useCallback((id: string) => {
    setData((prev) => {
      const grid: typeof prev.grid = {};
      for (const [key, state] of Object.entries(prev.grid)) {
        if (!key.endsWith(`:${id}`)) grid[key] = state;
      }
      return { ...prev, habits: prev.habits.filter((h) => h.id !== id), grid };
    });
  }, []);

  const setGoalText = useCallback((index: number, text: string) => {
    setData((prev) => ({
      ...prev,
      keyGoals: prev.keyGoals.map((g, i) => (i === index ? { ...g, text } : g)),
    }));
  }, []);

  const toggleGoalDone = useCallback((index: number) => {
    setData((prev) => ({
      ...prev,
      keyGoals: prev.keyGoals.map((g, i) => (i === index ? { ...g, done: !g.done } : g)),
    }));
  }, []);

  const setObservation = useCallback((index: number, text: string) => {
    setData((prev) => {
      const observations = [...prev.observations];
      observations[index] = text;
      return { ...prev, observations };
    });
  }, []);

  const addObservation = useCallback(() => {
    setData((prev) => ({ ...prev, observations: [...prev.observations, ''] }));
  }, []);

  const removeObservation = useCallback((index: number) => {
    setData((prev) => ({
      ...prev,
      observations: prev.observations.filter((_, i) => i !== index),
    }));
  }, []);

  /** Whether removing this habit would take marks with it — the caller's cue to confirm */
  const habitHasMarks = useCallback(
    (id: string) => Object.keys(data.grid).some((k) => k.endsWith(`:${id}`)),
    [data.grid]
  );

  const findHabit = useCallback(
    (id: string): Habit | undefined => data.habits.find((h) => h.id === id),
    [data.habits]
  );

  const stats = useMemo(() => {
    const total = data.habits.length * daysInMonth;
    let done = 0;
    for (const state of Object.values(data.grid)) {
      if (state === 1) done++;
    }
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [data.grid, data.habits, daysInMonth]);

  // `setData` deliberately isn't returned: every shape of this data has a named
  // operation above, so no caller has to know how a month is laid out.
  return {
    data,
    loaded,
    daysInMonth,
    stats,
    flushSave,
    setCell,
    cycleCell,
    addHabit,
    renameHabit,
    removeHabit,
    habitHasMarks,
    findHabit,
    setGoalText,
    toggleGoalDone,
    setObservation,
    addObservation,
    removeObservation,
  };
}
