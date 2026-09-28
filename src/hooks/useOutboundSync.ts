import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { MonthData } from '../types';
import { Task } from '../tasks';
import { YearMonthSummary } from '../storage';
import { ThemeMode } from '../theme';
import { buildSnapshot } from '../widgets/snapshot';
import { syncWidgets } from '../widgets/sync';
import { syncReminders } from '../notifications';

/**
 * Everything the planner pushes *out* of the app — to the home screen and to
 * the notification schedule. Kept apart from the screen because none of it
 * affects what's on screen; it's the same data leaving by two other doors.
 */

/** Long enough that a burst of taps produces one push, not one per tap */
const DEBOUNCE_MS = 1200;

/**
 * Runs `push` once its inputs have been still for DEBOUNCE_MS, or straight away
 * if the app leaves the foreground first: iOS suspends the app before the timer
 * fires, so an edit made just before going home would wait for the next launch.
 */
function useDebouncedPush(push: (() => void) | null, deps: unknown[]) {
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!push) return;
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      push();
    };
    pending.current = send;
    const t = setTimeout(send, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      if (pending.current === send) pending.current = null;
    };
    // `push` is rebuilt every render; `deps` are what it reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') pending.current?.();
    });
    return () => sub.remove();
  }, []);
}

/**
 * Mirror a snapshot into the shared container the widgets read.
 *
 * Debounced longer than the save itself — WidgetKit rate-limits timeline
 * reloads, so there's no value in pushing one per keystroke. `mode` is a
 * dependency because the widgets take their colour scheme from the snapshot:
 * without it, switching the app's theme would leave every widget on the old
 * one until the next edit happened to push.
 */
export function useWidgetSync(
  enabled: boolean,
  year: number,
  month: number,
  data: MonthData,
  yearMonths: YearMonthSummary[] | null,
  mode: ThemeMode,
  tasks: Task[]
) {
  useDebouncedPush(
    enabled && yearMonths
      ? () => syncWidgets(buildSnapshot(year, month, data, yearMonths, new Date(), mode, tasks))
      : null,
    [enabled, data, year, month, yearMonths, mode, tasks]
  );
}

/**
 * Rewrite the reminder schedule on every change, so today's remaining nudges
 * disappear as soon as nothing is left pending.
 *
 * Habits and deadlines are rewritten together because the schedule is rebuilt
 * from empty each time: scheduling either one alone would drop the other.
 */
export function useReminderSync(
  enabled: boolean,
  data: MonthData,
  today: number | null,
  tasks: Task[]
) {
  useDebouncedPush(
    enabled
      ? () => syncReminders({ habits: data.habits, grid: data.grid, today, tasks, now: new Date() })
      : null,
    [enabled, data, today, tasks]
  );
}
