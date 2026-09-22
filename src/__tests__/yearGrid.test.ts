import {
  YearBlock,
  blockShape,
  columnDays,
  spanContains,
  spanMonths,
  spanStats,
} from '../yearGrid';
import { monthLength } from '../dates';

/** the grid's own geometry constants, mirrored so the cases below read in points */
const STEP = 15;
const GAP = 3;
const MONTH_GAP = 12;

const shape = (year: number, month: number) =>
  blockShape(year, month, STEP, GAP, MONTH_GAP);

const marks = (days: Record<number, number>, habitCount = 4): YearBlock['summary'] => ({
  habitCount,
  tallies: Object.fromEntries(
    Object.entries(days).map(([d, done]) => [d, { done, missed: 0 }])
  ),
});

const block = (year: number, month: number, days: Record<number, number> = {}): YearBlock => ({
  year,
  month,
  summary: marks(days),
});

describe('spanMonths', () => {
  it('gives a calendar year as January to December', () => {
    const months = spanMonths({ kind: 'calendar', year: 2025 }, { year: 2026, month: 8 });
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ year: 2025, month: 0 });
    expect(months[11]).toEqual({ year: 2025, month: 11 });
  });

  it('ends a rolling span on the current month and crosses New Year to reach back', () => {
    const months = spanMonths({ kind: 'rolling' }, { year: 2026, month: 8 }); // Sep 2026
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ year: 2025, month: 9 }); // Oct 2025
    expect(months[11]).toEqual({ year: 2026, month: 8 }); // Sep 2026
  });

  it('is a plain calendar year when the current month is December', () => {
    const months = spanMonths({ kind: 'rolling' }, { year: 2026, month: 11 });
    expect(months[0]).toEqual({ year: 2026, month: 0 });
    expect(months[11]).toEqual({ year: 2026, month: 11 });
  });

  it('reaches into the previous year when the current month is January', () => {
    const months = spanMonths({ kind: 'rolling' }, { year: 2026, month: 0 });
    expect(months[0]).toEqual({ year: 2025, month: 1 }); // Feb 2025
    expect(months[11]).toEqual({ year: 2026, month: 0 });
  });
});

describe('spanContains', () => {
  const rolling = spanMonths({ kind: 'rolling' }, { year: 2026, month: 8 });

  it('finds a month inside the span', () => {
    expect(spanContains(rolling, { year: 2025, month: 9 })).toBe(true);
    expect(spanContains(rolling, { year: 2026, month: 8 })).toBe(true);
  });

  it('does not confuse the same month in a different year', () => {
    expect(spanContains(rolling, { year: 2025, month: 8 })).toBe(false); // Sep 2025
    expect(spanContains(rolling, { year: 2026, month: 9 })).toBe(false); // Oct 2026
  });
});

describe('blockShape', () => {
  it('needs no lead when the month starts on a Sunday', () => {
    // 1 Feb 2026 is a Sunday
    const s = shape(2026, 1);
    expect(s.lead).toBe(0);
    expect(s.days).toBe(28);
    expect(s.columns).toBe(4);
  });

  it('spills into a sixth column when a 31-day month starts on a Saturday', () => {
    // 1 Aug 2026 is a Saturday: 6 lead rows + 31 days = 37 cells
    const s = shape(2026, 7);
    expect(s.lead).toBe(6);
    expect(s.days).toBe(31);
    expect(s.columns).toBe(6);
  });

  it('counts the extra day in a leap February', () => {
    expect(shape(2024, 1).days).toBe(29);
    expect(shape(2025, 1).days).toBe(28);
  });

  it('keeps the label width clear of the trailing column gap', () => {
    const s = shape(2026, 1); // 4 columns
    expect(s.width).toBe(4 * STEP - GAP);
    expect(s.advance).toBe(4 * STEP + MONTH_GAP);
    // the two must differ, or labels drift right as the grid scrolls
    expect(s.advance - s.width).toBe(GAP + MONTH_GAP);
  });
});

describe('columnDays', () => {
  /**
   * Every cell the component would draw for a month, in the order it draws
   * them: column by column, and within a column top to bottom after the lead.
   */
  const layout = (year: number, month: number) => {
    const s = shape(year, month);
    const seen: { day: number; column: number }[] = [];
    for (let column = 0; column < s.columns; column++) {
      const { first, last } = columnDays(s, column);
      for (let day = first; day <= last; day++) seen.push({ day, column });
    }
    return { shape: s, seen };
  };

  const cases: [string, number, number][] = [
    ['February 2026 — starts Sunday', 2026, 1],
    ['February 2024 — leap year', 2024, 1],
    ['August 2026 — 31 days starting Saturday', 2026, 7],
    ['September 2026', 2026, 8],
    ['November 2025', 2025, 10],
    ['January 2027 — starts Friday', 2027, 0],
  ];

  it.each(cases)('draws every day of %s exactly once', (_name, year, month) => {
    const { shape: s, seen } = layout(year, month);
    const days = seen.map((c) => c.day).sort((a, b) => a - b);
    expect(days).toEqual(Array.from({ length: monthLength(year, month) }, (_, i) => i + 1));
    expect(new Set(days).size).toBe(s.days);
  });

  it.each(cases)('puts every day of %s in the row its weekday says', (_name, year, month) => {
    const { shape: s, seen } = layout(year, month);
    for (const { day, column } of seen) {
      // the component pads the first column by `lead` rows and stacks from
      // there, so a day's place in the grid is fixed by its offset from the 1st
      const slot = day - 1 + s.lead;
      expect(slot % 7).toBe(new Date(year, month, day).getDay());
      expect(Math.floor(slot / 7)).toBe(column);
    }
  });

  it('leaves no column empty', () => {
    for (let month = 0; month < 12; month++) {
      const s = shape(2026, month);
      for (let column = 0; column < s.columns; column++) {
        const { first, last } = columnDays(s, column);
        expect(last).toBeGreaterThanOrEqual(first);
      }
    }
  });
});

describe('spanStats', () => {
  it('is all zeroes for an empty span', () => {
    expect(spanStats([])).toEqual({ total: 0, activeDays: 0, maxStreak: 0 });
    expect(spanStats([block(2026, 0)])).toEqual({ total: 0, activeDays: 0, maxStreak: 0 });
  });

  it('totals every check and counts a day once however many were kept', () => {
    const stats = spanStats([block(2026, 0, { 1: 3, 2: 1, 5: 4 })]);
    expect(stats.total).toBe(8);
    expect(stats.activeDays).toBe(3);
  });

  it('does not count a day that was only ever marked missed', () => {
    const missedOnly: YearBlock = {
      year: 2026,
      month: 0,
      summary: { habitCount: 2, tallies: { 4: { done: 0, missed: 2 } } },
    };
    expect(spanStats([missedOnly])).toEqual({ total: 0, activeDays: 0, maxStreak: 0 });
  });

  it('runs a streak across a month boundary', () => {
    // 30 and 31 January, then 1 and 2 February
    const stats = spanStats([block(2026, 0, { 30: 1, 31: 1 }), block(2026, 1, { 1: 1, 2: 1 })]);
    expect(stats.maxStreak).toBe(4);
    expect(stats.activeDays).toBe(4);
  });

  it('breaks the streak on a gap and keeps the longest run', () => {
    const stats = spanStats([block(2026, 0, { 1: 1, 2: 1, 3: 1, 7: 1, 8: 1 })]);
    expect(stats.maxStreak).toBe(3);
    expect(stats.activeDays).toBe(5);
  });

  it('breaks the streak when a month between two active ones is empty', () => {
    const stats = spanStats([
      block(2026, 0, { 31: 1 }),
      block(2026, 1), // February untouched
      block(2026, 2, { 1: 1 }),
    ]);
    expect(stats.maxStreak).toBe(1);
  });

  it('counts a whole month, leap day included', () => {
    const february = block(
      2024,
      1,
      Object.fromEntries(Array.from({ length: 29 }, (_, i) => [i + 1, 1]))
    );
    expect(spanStats([february])).toEqual({ total: 29, activeDays: 29, maxStreak: 29 });
  });

  it('ignores a tally for a day the month does not have', () => {
    // a 31st stored against a 30-day month must not be counted
    const stats = spanStats([block(2026, 3, { 30: 1, 31: 1 })]); // April
    expect(stats.total).toBe(1);
    expect(stats.activeDays).toBe(1);
  });
});
