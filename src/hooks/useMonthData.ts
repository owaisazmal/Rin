import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CellState,
  Habit,
  MAX_OBSERVATIONS,
  MonthData,
  cellKey,
  emptyMonthData,
  nextHabitId,
} from '../types';
import { readMonthForEditing, saveMonth } from '../storage';
import { clearUnvouched, markDirty, recordUnvouched } from '../syncLedger';
import { monthLength } from '../dates';

/**
 * What this month is called on the server — `2026-09`.
 *
 * The backup writes a month under this name, so it is also the name the ledger
 * has to file it under: a dirty flag on `2026-9` would be a flag on a document
 * nobody ever pushes. Padded here rather than trusted to whoever calls it.
 */
export function monthDocKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

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
  /**
   * The month a user edit is waiting to be reported against, null when there is
   * nothing to report. It holds the key rather than a bare `true` so that an
   * edit is always attributed to the month it was made in — the save that
   * reports it can land after the screen has already moved on to another one.
   */
  const touched = useRef<string | null>(null);
  /**
   * Whether the record this month was read from was understood in full.
   *
   * A ref rather than state because what it gates is the write rather than the
   * render, and it is set before `loaded` flips — so the effect that reads it
   * always re-runs after it has been written, and the render that first shows
   * the month is the render that first sees it.
   */
  const vouched = useRef(false);

  const daysInMonth = monthLength(year, month);
  const docKey = monthDocKey(year, month);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    // A stale `true` left by the month just navigated away from would authorise
    // a write for this one, so the permission is withdrawn before the read that
    // grants it rather than after.
    vouched.current = false;
    const key = monthDocKey(year, month);
    readMonthForEditing(year, month).then(({ data: read, complete, lost }) => {
      /**
       * Tell the ledger what this read found, before anything else.
       *
       * This is the only place a damaged month is ever noticed. The backup only
       * looks at documents whose contents changed, and a month that rotted on
       * disk changed nothing, so nothing on the backup's side of the app was
       * ever going to examine it — which is how a phone came to say everything
       * on it was in the backup while a month was missing half its habits. A
       * screen reading the record is the one moment somebody finds out, so this
       * is the moment it gets written down.
       *
       * A local write and nothing more. It does not mark the month dirty and it
       * cannot start a run — see `recordUnvouched`, which is emphatic about why:
       * the only thing this phone could send for this month is the half of it
       * that survived the parse, and sending that over the whole copy on the
       * server is the fault being closed rather than the fix.
       *
       * The `complete` side is the other half and it matters just as much. A
       * note that outlived the damage would have the card offering to replace a
       * month with a copy from the backup that this phone no longer needs and
       * may well be older, so a read this phone *can* vouch for retires it — a
       * complete read being the only proof of a whole record there is. That
       * covers the way out that does not come back through this hook at all:
       * `restoreMonth` writes the backup's copy straight to disk, and the next
       * time anybody opens the month, this says so. Both calls leave the record
       * untouched when there is nothing to change, so an undamaged month costs
       * a read of the ledger and no write of it.
       *
       * Deliberately outside the `cancelled` check below. What was found is a
       * fact about the file on disk rather than about this screen, and paging
       * quickly past a damaged month is not a reason for the backup never to
       * hear about it.
       */
      if (complete) clearUnvouched(key);
      else recordUnvouched(key, lost ?? '');

      if (cancelled) return;
      vouched.current = complete;
      setData(read);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  /**
   * The one door every mutation below goes through.
   *
   * The ledger has to learn about a change from the edit itself, and from
   * nothing else. Marking the month dirty inside `saveMonth` would be the
   * obvious place and is wrong twice over: a restore calls it once per month it
   * downloads, which would mark three years of freshly arrived history as
   * needing upload, and the save effect below fires whenever a month finishes
   * loading, so paging back through history would flag every month browsed and
   * upload it again.
   *
   * Wrapping `setData` once, rather than setting the flag in each of the named
   * mutators, is the part that keeps this honest. A mutator written later
   * cannot forget to do it, and forgetting would be invisible — no error, no
   * failing test, just a month that quietly stops being backed up.
   *
   * A change that hands back `prev` untouched is not an edit: React skips the
   * re-render, and so does this. That is how a mutator declines to do anything
   * without costing an upload of a month nobody changed.
   */
  const edit = useCallback(
    (change: (prev: MonthData) => MonthData) => {
      setData((prev) => {
        const next = change(prev);
        if (next !== prev) touched.current = docKey;
        return next;
      });
    },
    [docKey]
  );

  /**
   * Tell the ledger, once, about whatever has been edited since the last time.
   * The flag is cleared before the call rather than after: `markDirty` is one
   * more best-effort store, and a flag lost to a failed write costs an upload
   * the next backup works out from the digest anyway, while the same edit
   * reported twice can outlive the push that answered it and cost a second run.
   */
  const reportEdit = useCallback((wrote: boolean) => {
    const key = touched.current;
    if (!key) return;
    touched.current = null;
    markDirty(key);
    /**
     * And if that edit went to disk, the month is no longer one this phone
     * cannot read. What a deliberate edit writes is the whole record — that is
     * what makes it the repair both backup screens tell people to make — so the
     * note it was written under is finished. Leaving it would have the card
     * going on calling a month damaged after somebody had fixed it, which is
     * the one thing a way out must not do.
     *
     * `wrote` is the narrow part, and it is why the flag above is not gated on
     * it. There is one caller that reports an edit without having saved
     * anything, and the two answers pull apart exactly there: the phone really
     * is holding something the backup has not seen, so the flag is true, and
     * the record on disk is still the damaged one, so the note is still true
     * as well. Clearing it on the strength of an edit that never landed is the
     * app going quiet about a month it knows it cannot read.
     */
    if (wrote) clearUnvouched(key);
  }, []);

  /**
   * Write the open month out, a moment after it stops changing.
   *
   * The second half of the guard is the important one, and it is not about the
   * backup. This effect fires when `loaded` flips as well as on every edit, so
   * merely opening a month schedules a save of whatever the read gave back —
   * and for a record this phone could only half read, that is the survivors
   * going back over the record they survived. A habit that rotted on disk is
   * one navigation away from being gone for good, and nobody typed anything.
   *
   * It destroys the evidence as well as the data: the record is genuinely
   * complete once it has been rewritten, so the vouched read the backup makes
   * says so, and the thinned month goes up over the good copy on the server as
   * an ordinary edit.
   *
   * What it must NOT do is refuse a deliberate edit. Rewriting the month is
   * exactly how someone repairs a damaged one, and both backup screens tell
   * them so; a guard that swallowed the repair would leave the month read-only
   * with no way out and the app giving advice it had made impossible to take.
   * So the line is drawn at intent, not at damage: a write nobody asked for is
   * refused, a write somebody typed is honoured. `touched` is set only by the
   * `edit` wrapper above, so it is exactly the signal for "a person did this".
   */
  useEffect(() => {
    if (!loaded) return;
    const repairing = touched.current !== null;
    if (!vouched.current && !repairing) return;
    // The repair rewrites the record whole, so what lands on disk from here is
    // something this phone can vouch for — and the edits that follow it in the
    // same session are ordinary ones.
    if (repairing) vouched.current = true;
    pendingSave.current = { year, month, data };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveMonth(year, month, data);
      reportEdit(true);
      pendingSave.current = null;
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [data, loaded, year, month, reportEdit]);

  /**
   * Write out pending edits now — used before navigating away from a month.
   *
   * It needs no guard of its own: the only thing it writes is `pendingSave`,
   * and the effect above is the sole writer of that and no longer sets it for a
   * month this phone could not vouch for. Reporting the edit is deliberate even
   * then. Somebody typed, nothing was saved, and the flag says the phone holds
   * something the backup has not seen — which is true: the next run reads the
   * same damaged record, blocks the month, and the card in Settings names it.
   * What is *not* reported in that case is a repair, which is what `p` carries
   * into `reportEdit`: nothing was written, so nothing was mended.
   */
  const flushSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const p = pendingSave.current;
    if (p) {
      saveMonth(p.year, p.month, p.data);
      pendingSave.current = null;
    }
    reportEdit(p !== null);
  }, [reportEdit]);

  /**
   * History is read-only: only the real current day can be marked. `today` is
   * null whenever the open month isn't the current one, which locks it
   * wholesale. Guarded here rather than only in the UI so no caller can slip
   * past it.
   */
  const setCell = useCallback(
    (day: number, habitId: string, state: CellState) => {
      if (day !== today) return;
      edit((prev) => {
        const key = cellKey(day, habitId);
        const grid = { ...prev.grid };
        if (state === 0) delete grid[key];
        else grid[key] = state;
        return { ...prev, grid };
      });
    },
    [today, edit]
  );

  const cycleCell = useCallback(
    (day: number, habitId: string) => {
      if (day !== today) return;
      edit((prev) => {
        const key = cellKey(day, habitId);
        const next: CellState = (((prev.grid[key] ?? 0) + 1) % 3) as CellState;
        const grid = { ...prev.grid };
        if (next === 0) delete grid[key];
        else grid[key] = next;
        return { ...prev, grid };
      });
    },
    [today, edit]
  );

  const addHabit = useCallback(() => {
    edit((prev) => ({
      ...prev,
      habits: [...prev.habits, { id: nextHabitId(prev.habits), name: '' }],
    }));
  }, [edit]);

  const renameHabit = useCallback(
    (id: string, name: string) => {
      edit((prev) => ({
        ...prev,
        habits: prev.habits.map((h) => (h.id === id ? { ...h, name } : h)),
      }));
    },
    [edit]
  );

  const removeHabit = useCallback(
    (id: string) => {
      edit((prev) => {
        const grid: typeof prev.grid = {};
        for (const [key, state] of Object.entries(prev.grid)) {
          if (!key.endsWith(`:${id}`)) grid[key] = state;
        }
        return { ...prev, habits: prev.habits.filter((h) => h.id !== id), grid };
      });
    },
    [edit]
  );

  const setGoalText = useCallback(
    (index: number, text: string) => {
      edit((prev) => ({
        ...prev,
        keyGoals: prev.keyGoals.map((g, i) => (i === index ? { ...g, text } : g)),
      }));
    },
    [edit]
  );

  const toggleGoalDone = useCallback(
    (index: number) => {
      edit((prev) => ({
        ...prev,
        keyGoals: prev.keyGoals.map((g, i) => (i === index ? { ...g, done: !g.done } : g)),
      }));
    },
    [edit]
  );

  const setObservation = useCallback(
    (index: number, text: string) => {
      edit((prev) => {
        const observations = [...prev.observations];
        observations[index] = text;
        return { ...prev, observations };
      });
    },
    [edit]
  );

  /**
   * The count limit lives here as well as in the header that offers the add
   * control, so that the two cannot drift: `Observations.tsx` hides its button
   * on the same `< MAX_OBSERVATIONS` it is checked against here. Declining by
   * handing back `prev` keeps a refused tap out of the ledger — the month has
   * not changed, so there is nothing to back up.
   */
  const addObservation = useCallback(() => {
    edit((prev) =>
      prev.observations.length >= MAX_OBSERVATIONS
        ? prev
        : { ...prev, observations: [...prev.observations, ''] }
    );
  }, [edit]);

  const removeObservation = useCallback(
    (index: number) => {
      edit((prev) => ({
        ...prev,
        observations: prev.observations.filter((_, i) => i !== index),
      }));
    },
    [edit]
  );

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
  // operation above, so no caller has to know how a month is laid out — and a
  // change made outside those operations would never reach the ledger.
  return {
    data,
    loaded,
    /**
     * Whether what is on screen is the whole of what is on disk.
     *
     * False means this month is being shown but must not be written back, so
     * the screen has to say so: an app that takes what somebody types and
     * silently drops it is worse than one that admits it cannot save. Read
     * through the ref rather than held as state because it is only ever written
     * immediately before `loaded`, which is what re-renders on it.
     */
    vouched: vouched.current,
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
