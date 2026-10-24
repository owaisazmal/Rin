import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { setSnapshot } from '../../modules/widget-bridge';
import { MonthData } from '../types';
import { Task } from '../tasks';
import { YearMonthSummary } from '../storage';
import { ThemeMode } from '../theme';
import { buildSnapshot } from '../widgets/snapshot';
import { syncReminders } from '../notifications';
import type { NotificationPrefs } from '../settings';
import type { QuoteList } from '../quotes';

/** Long enough that a burst of taps produces one push, not one per tap */
const DEBOUNCE_MS = 1200;

/** Runs `push` once its inputs settle, or at once on backgrounding, since iOS suspends before the timer fires */
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

/** Mirrors a snapshot to the widgets; `mode` is a dependency because they take their colours from it */
export function useWidgetSync(
  enabled: boolean,
  year: number,
  month: number,
  data: MonthData,
  yearMonths: YearMonthSummary[] | null,
  mode: ThemeMode,
  tasks: Task[],
  quotes: QuoteList
) {
  useDebouncedPush(
    enabled && yearMonths
      ? () => {
          const snapshot = buildSnapshot(year, month, data, yearMonths, new Date(), mode, tasks, quotes);
          try {
            setSnapshot(JSON.stringify(snapshot));
          } catch {
            // a widget failing to update should never surface in the app
          }
        }
      : null,
    [enabled, data, year, month, yearMonths, mode, tasks, quotes]
  );
}

/** Habits and deadlines together, since the schedule is rebuilt from empty each time */
export function useReminderSync(
  enabled: boolean,
  data: MonthData,
  today: number | null,
  tasks: Task[],
  prefs: NotificationPrefs
) {
  useDebouncedPush(
    enabled
      ? () =>
          syncReminders({ habits: data.habits, grid: data.grid, today, tasks, now: new Date(), prefs })
      : null,
    [enabled, data, today, tasks, prefs]
  );
}
