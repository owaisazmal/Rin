import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Application from 'expo-application';
import * as StoreReview from 'expo-store-review';
import { REVIEW_PERFECT_DAYS, loadReviewRecord, saveReviewRecord, shouldAskForReview } from '../review';
import type { YearMonthSummary } from '../storage';
import { computeStreaks } from '../streaks';

/** Asks for a store rating after a full clean week, once per version, a moment after the planner settles */
export function useReviewPrompt(enabled: boolean, year: number, months: YearMonthSummary[] | null) {
  const asking = useRef(false);

  useEffect(() => {
    if (!enabled || !months) return;
    const today = new Date();
    if (year !== today.getFullYear()) return;
    const perfectDays = computeStreaks(year, months, {
      month: today.getMonth(),
      day: today.getDate(),
    }).perfect;
    if (perfectDays < REVIEW_PERFECT_DAYS) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (asking.current) return;
      asking.current = true;
      try {
        const version = Application.nativeApplicationVersion;
        const record = await loadReviewRecord();
        const now = Date.now();
        if (cancelled || !shouldAskForReview({ perfectDays, version, record, now })) return;
        if (AppState.currentState !== 'active' || !(await StoreReview.hasAction())) return;
        await StoreReview.requestReview();
        // a prompt the store swallows still resolves, and counts; a store that cannot be reached throws, and does not
        await saveReviewRecord({ askedVersion: version, askedAt: now });
      } catch {
        // no store to ask, or it declined; there is nothing to show the user
      } finally {
        asking.current = false;
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, year, months]);
}
