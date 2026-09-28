import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ClosedSpan, closuresSince, markMissed } from '../closedDays';
import { readMonthVouched, saveMonth } from '../storage';
import { markDirty } from '../syncLedger';
import { monthDocKey } from './useMonthData';

const CLOSED_KEY = '@monthly-planning/closed-through';

/** One pass at a time, so two can never read the same stamp */
let queue: Promise<void> = Promise.resolve();

/** Marks a span missed on disk; false when nothing changed or the month is damaged */
async function closeStored(span: ClosedSpan): Promise<boolean> {
  const record = await readMonthVouched(span.year, span.month);
  if (record.status !== 'complete') return false;
  const next = markMissed(record.data, span.from, span.to);
  if (next === record.data) return false;
  await saveMonth(span.year, span.month, next);
  await markDirty(monthDocKey(span.year, span.month));
  return true;
}

/**
 * Closes every day that has left the marking window since the last pass: at
 * launch, and again whenever the date moves on. Returns a count that goes up
 * each time a stored month changed, for the readers that cache them.
 */
export function useClosedDays(
  dayStart: number,
  open: { flushSave: () => void; reread: (year: number, month: number) => void }
): number {
  const [revision, setRevision] = useState(0);
  const latest = useRef(open);
  latest.current = open;

  useEffect(() => {
    queue = queue
      .then(async () => {
        let stored: string | null = null;
        try {
          stored = await AsyncStorage.getItem(CLOSED_KEY);
        } catch {
          return;
        }
        const { spans, through } = closuresSince(stored, new Date(dayStart));
        // the open month's edits go to disk first, so the pass builds on them
        if (spans.length) latest.current.flushSave();
        let wrote = false;
        for (const span of spans) {
          if (!(await closeStored(span))) continue;
          wrote = true;
          latest.current.reread(span.year, span.month);
        }
        if (through) await AsyncStorage.setItem(CLOSED_KEY, through);
        if (wrote) setRevision((r) => r + 1);
      })
      .catch(() => {});
  }, [dayStart]);

  return revision;
}
