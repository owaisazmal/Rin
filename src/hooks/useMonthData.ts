import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CardItem,
  CardRef,
  CellState,
  Habit,
  MAX_CARD_ITEMS,
  MAX_MONTH_CARDS,
  MAX_OBSERVATIONS,
  MonthData,
  cellKey,
  emptyCardItems,
  emptyMonthData,
  nextId,
} from '../types';
import {
  dropCardFromMonths,
  loadCarriedHabits,
  readMonthForEditing,
  saveMonth,
} from '../storage';
import { clearUnvouched, markDirty, recordUnvouched } from '../syncLedger';
import { monthDocKey, monthLength } from '../dates';
import { DayRef, canMark, dayWhen } from '../marking';

export { monthDocKey } from '../dates';

/** Swaps the habit list; emptying it is remembered so nothing is carried back in */
function withHabits(prev: MonthData, habits: Habit[]): MonthData {
  const next: MonthData = { ...prev, habits };
  if (habits.length) delete next.habitsCleared;
  else next.habitsCleared = true;
  return next;
}

/** The open month: loading, debounced saving and every named edit; confirmations are the caller's */
export function useMonthData(year: number, month: number, today: DayRef) {
  const [data, setData] = useState<MonthData>(emptyMonthData());
  const [loaded, setLoaded] = useState(false);
  // past-day cells filled in during this visit, still changeable until it ends
  const filledNow = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ year: number; month: number; data: MonthData } | null>(null);
  // the month an unreported user edit belongs to, which the save may outlive
  const touched = useRef<string | null>(null);
  // whether the record was read in full; a ref, as it gates the write and is set before `loaded` flips
  const vouched = useRef(false);
  // habits shown from an earlier month; not saved here until one is marked or changed
  const inherited = useRef(false);

  const daysInMonth = monthLength(year, month);
  const docKey = monthDocKey(year, month);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    // withdrawn before the read, so the previous month's `true` can't authorise a write here
    vouched.current = false;
    inherited.current = false;
    filledNow.current = new Set();
    const key = monthDocKey(year, month);
    readMonthForEditing(year, month).then(async ({ data: read, complete, lost }) => {
      // the only place on-disk damage is noticed, so the ledger hears even if cancelled; never marks dirty
      if (complete) clearUnvouched(key);
      else recordUnvouched(key, lost ?? '');

      // a month with no habits of its own shows the latest earlier month's
      const carried =
        complete && read.habits.length === 0 && !read.habitsCleared
          ? await loadCarriedHabits(year, month)
          : [];

      if (cancelled) return;
      vouched.current = complete;
      inherited.current = carried.length > 0;
      setData(carried.length ? { ...read, habits: carried } : read);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  // the one door for edits, so the ledger hears of them and never of saves or restores
  const edit = useCallback(
    (change: (prev: MonthData) => MonthData, ownsHabits = false) => {
      setData((prev) => {
        const next = change(prev);
        if (next !== prev) {
          touched.current = docKey;
          // marks and habit edits make the carried list this month's own
          if (ownsHabits) inherited.current = false;
        }
        return next;
      });
    },
    [docKey]
  );

  /** Reports the pending edit once, cleared first so a failed write can't report it twice */
  const reportEdit = useCallback((wrote: boolean) => {
    const key = touched.current;
    if (!key) return;
    touched.current = null;
    markDirty(key);
    // a saved edit rewrote the record whole, which repairs it; an unsaved one leaves the damage
    if (wrote) clearUnvouched(key);
  }, []);

  // a half-read month is only saved once somebody edits it, since that edit is the repair
  useEffect(() => {
    if (!loaded) return;
    const repairing = touched.current !== null;
    if (!vouched.current && !repairing) return;
    if (repairing) vouched.current = true;
    const record = inherited.current ? { ...data, habits: [] } : data;
    pendingSave.current = { year, month, data: record };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveMonth(year, month, record);
      reportEdit(true);
      pendingSave.current = null;
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [data, loaded, year, month, reportEdit]);

  /** Writes pending edits now, before leaving the month; only the guarded effect sets `pendingSave` */
  const flushSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const p = pendingSave.current;
    if (p) {
      saveMonth(p.year, p.month, p.data);
      pendingSave.current = null;
    }
    reportEdit(p !== null);
  }, [reportEdit]);

  /** Whether a cell can be marked, by the rule in marking.ts */
  const canMarkCell = useCallback(
    (day: number, habitId: string) => {
      const key = cellKey(day, habitId);
      return canMark(dayWhen(year, month, day, today), data.grid[key] ?? 0, filledNow.current.has(key));
    },
    [year, month, today, data.grid]
  );

  /** The same rule, checked against the grid being changed rather than the one last rendered */
  const markCell = useCallback(
    (day: number, habitId: string, next: (current: CellState) => CellState) => {
      const when = dayWhen(year, month, day, today);
      edit((prev) => {
        const key = cellKey(day, habitId);
        const current = prev.grid[key] ?? 0;
        if (!canMark(when, current, filledNow.current.has(key))) return prev;
        if (when === 'past') filledNow.current.add(key);
        const state = next(current);
        const grid = { ...prev.grid };
        if (state === 0) delete grid[key];
        else grid[key] = state;
        return { ...prev, grid };
      }, true);
    },
    [year, month, today, edit]
  );

  const setCell = useCallback(
    (day: number, habitId: string, state: CellState) => markCell(day, habitId, () => state),
    [markCell]
  );

  const cycleCell = useCallback(
    (day: number, habitId: string) =>
      markCell(day, habitId, (current) => ((current + 1) % 3) as CellState),
    [markCell]
  );

  const addHabit = useCallback(() => {
    edit((prev) => withHabits(prev, [...prev.habits, { id: nextId(prev.habits), name: '' }]), true);
  }, [edit]);

  const renameHabit = useCallback(
    (id: string, name: string) => {
      edit(
        (prev) => ({
          ...prev,
          habits: prev.habits.map((h) => (h.id === id ? { ...h, name } : h)),
        }),
        true
      );
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
        return withHabits({ ...prev, grid }, prev.habits.filter((h) => h.id !== id));
      }, true);
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

  /** Checked against the same limit `Observations.tsx` hides its button on */
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

  /** The first edit files the card in this month; declines once the month holds the most it may */
  const editCard = useCallback(
    (card: CardRef, change: (items: CardItem[]) => CardItem[]) => {
      edit((prev) => {
        const held = prev.cards ?? [];
        const at = held.findIndex((c) => c.id === card.id);
        if (at < 0 && held.length >= MAX_MONTH_CARDS) return prev;
        const before = at >= 0 ? held[at].items : emptyCardItems(card.kind);
        const items = change(before);
        if (items === before) return prev;
        const next = { id: card.id, title: card.title, kind: card.kind, items };
        return {
          ...prev,
          cards: at >= 0 ? held.map((c, i) => (i === at ? next : c)) : [...held, next],
        };
      });
    },
    [edit]
  );

  const setCardText = useCallback(
    (card: CardRef, index: number, text: string) => {
      editCard(card, (items) =>
        items[index] && items[index].text !== text
          ? items.map((item, i) => (i === index ? { ...item, text } : item))
          : items
      );
    },
    [editCard]
  );

  const toggleCardItem = useCallback(
    (card: CardRef, index: number) => {
      editCard(card, (items) =>
        items[index]
          ? items.map((item, i) => (i === index ? { ...item, done: !item.done } : item))
          : items
      );
    },
    [editCard]
  );

  /** Checked against the same limit the card's header hides its button on */
  const addCardItem = useCallback(
    (card: CardRef) => {
      editCard(card, (items) =>
        card.kind === 'note' || items.length >= MAX_CARD_ITEMS
          ? items
          : [...items, { text: '', done: false }]
      );
    },
    [editCard]
  );

  const removeCardItem = useCallback(
    (card: CardRef, index: number) => {
      editCard(card, (items) =>
        items.length > 1 && items[index] ? items.filter((_, i) => i !== index) : items
      );
    },
    [editCard]
  );

  /** Keeps the title this month stores for a card in step with a rename. */
  const retitleCard = useCallback(
    (id: string, title: string) => {
      edit((prev) =>
        prev.cards?.some((c) => c.id === id && c.title !== title)
          ? { ...prev, cards: prev.cards.map((c) => (c.id === id ? { ...c, title } : c)) }
          : prev
      );
    },
    [edit]
  );

  /** Takes a deleted card's lines out of every month; the key goes with the last of them */
  const dropCard = useCallback(
    (id: string) => {
      edit((prev) => {
        if (!prev.cards?.some((c) => c.id === id)) return prev;
        const { cards, ...rest } = prev;
        const left = cards.filter((c) => c.id !== id);
        return left.length ? { ...rest, cards: left } : rest;
      });
      // the edit above saves the open month; the others are rewritten on disk
      dropCardFromMonths(id, { year, month }).then((months) =>
        months.forEach((m) => markDirty(monthDocKey(m.year, m.month)))
      );
    },
    [edit, year, month]
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

  // `setData` isn't returned, so every change goes through `edit` and reaches the ledger
  return {
    data,
    loaded,
    /** false: shown but not saved until edited, which the screen has to say */
    vouched: vouched.current,
    daysInMonth,
    stats,
    flushSave,
    canMarkCell,
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
    setCardText,
    toggleCardItem,
    addCardItem,
    removeCardItem,
    retitleCard,
    dropCard,
  };
}
