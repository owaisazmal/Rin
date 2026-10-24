import { computeStreaks } from '../streaks';
import type { YearMonthSummary } from '../storage';

/** 2026 is not a leap year, so February has 28 days */
const YEAR = 2026;

/** Builds the 12-month array from a sparse `{ month: { day: doneCount } }` spec */
function year(
  spec: Record<number, { habits: number; days: Record<number, number> }>
): YearMonthSummary[] {
  return Array.from({ length: 12 }, (_, m) => {
    const month = spec[m];
    if (!month) return { habitCount: 0, tallies: {} };
    const tallies: YearMonthSummary['tallies'] = {};
    for (const [day, done] of Object.entries(month.days)) {
      tallies[Number(day)] = { done, missed: 0 };
    }
    return { habitCount: month.habits, tallies };
  });
}

/** `{1: n, 2: n, ...}` for a run of consecutive days */
function run(from: number, to: number, done: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (let d = from; d <= to; d++) out[d] = done;
  return out;
}

describe('computeStreaks', () => {
  it('reports nothing for an empty year', () => {
    const s = computeStreaks(YEAR, year({}), { month: 0, day: 15 });
    expect(s).toEqual({ current: 0, best: 0, perfect: 0 });
  });

  it('still finds the best run when there is no "today" to count back from', () => {
    const months = year({ 0: { habits: 3, days: run(1, 5, 2) } });
    const s = computeStreaks(YEAR, months, null);
    expect(s.best).toBe(5);
    // without a reference day there is nothing to count back from
    expect(s.current).toBe(0);
    expect(s.perfect).toBe(0);
  });

  it('counts back from today when today is marked', () => {
    const months = year({ 0: { habits: 3, days: run(10, 14, 1) } });
    expect(computeStreaks(YEAR, months, { month: 0, day: 14 }).current).toBe(5);
  });

  it('falls back to yesterday, so an unmarked today does not look like a break', () => {
    const months = year({ 0: { habits: 3, days: run(10, 13, 1) } });
    // the 14th has nothing on it yet; the run through the 13th still stands
    expect(computeStreaks(YEAR, months, { month: 0, day: 14 }).current).toBe(4);
  });

  it('is broken once two days in a row are unmarked', () => {
    const months = year({ 0: { habits: 3, days: run(10, 12, 1) } });
    expect(computeStreaks(YEAR, months, { month: 0, day: 15 }).current).toBe(0);
  });

  it('carries a run across a month border', () => {
    const months = year({
      0: { habits: 2, days: run(30, 31, 1) },
      1: { habits: 2, days: run(1, 2, 1) },
    });
    expect(computeStreaks(YEAR, months, { month: 1, day: 2 }).current).toBe(4);
  });

  it('does not carry a run across the year border', () => {
    // January starts the year fresh — December is a different year's problem
    const months = year({ 0: { habits: 2, days: run(1, 3, 1) } });
    expect(computeStreaks(YEAR, months, { month: 0, day: 3 }).current).toBe(3);
    expect(computeStreaks(YEAR, months, { month: 0, day: 3 }).best).toBe(3);
  });

  it('finds the longest run anywhere in the year, not just the live one', () => {
    const months = year({
      2: { habits: 2, days: run(1, 9, 1) },
      5: { habits: 2, days: run(1, 2, 1) },
    });
    const s = computeStreaks(YEAR, months, { month: 5, day: 2 });
    expect(s.current).toBe(2);
    expect(s.best).toBe(9);
  });

  it('counts a day as active on a single mark, however many habits exist', () => {
    const months = year({ 0: { habits: 8, days: run(1, 3, 1) } });
    expect(computeStreaks(YEAR, months, { month: 0, day: 3 }).current).toBe(3);
  });

  it('counts perfect days only when every habit was done', () => {
    const months = year({
      0: { habits: 4, days: { 1: 4, 2: 4, 3: 2, 4: 4, 5: 4 } },
    });
    const s = computeStreaks(YEAR, months, { month: 0, day: 5 });
    // the 3rd fell short, so the perfect run is only the 4th and 5th
    expect(s.perfect).toBe(2);
    // but the day still counted as active, so the plain streak is unbroken
    expect(s.current).toBe(5);
  });

  it('never calls a day perfect when the month has no habits', () => {
    const months = year({ 0: { habits: 0, days: run(1, 3, 0) } });
    expect(computeStreaks(YEAR, months, { month: 0, day: 3 }).perfect).toBe(0);
  });

  it('returns zero when the reference day is not a real day of the year', () => {
    const months = year({ 0: { habits: 2, days: run(1, 3, 1) } });
    expect(computeStreaks(YEAR, months, { month: 11, day: 32 }).current).toBe(0);
  });
});
