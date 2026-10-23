import {
  axisDays,
  dayBars,
  habitBars,
  heatLevel,
  smoothPath,
  smoothSegments,
  weekPoints,
  weekdayHeat,
  weekdayIndex,
} from '../trackerCharts';
import { summarizeMonth } from '../monthSummary';
import { emptyMonthData } from '../types';
import type { CellState, MonthData } from '../types';

/** Thu 22 Oct 2026; September 2026 starts on a Tuesday, November on a Sunday, February 2027 on a Monday */
const TODAY = { year: 2026, month: 9, day: 22 };
const NOW = new Date(2026, 9, 22, 12).getTime();

/** `marks` is `{ day: [state per habit] }`, as in monthSummary.test.ts */
function month(habits: string[], marks: Record<number, CellState[]> = {}): MonthData {
  const data = emptyMonthData();
  data.habits = habits.map((name, i) => ({ id: String(i), name }));
  for (const [day, states] of Object.entries(marks)) {
    states.forEach((state, i) => {
      if (state !== 0) data.grid[`${day}:${i}`] = state;
    });
  }
  return data;
}

function days(from: number, to: number, states: CellState[]): Record<number, CellState[]> {
  const out: Record<number, CellState[]> = {};
  for (let d = from; d <= to; d++) out[d] = states;
  return out;
}

describe('weekdayIndex', () => {
  it('counts from Monday', () => {
    expect(weekdayIndex(2026, 9, 19)).toBe(0);
    expect(weekdayIndex(2026, 9, 22)).toBe(3);
    expect(weekdayIndex(2026, 9, 25)).toBe(6);
  });
});

describe('dayBars', () => {
  it('tallies each day and counts the perfect ones', () => {
    const data = month(['Wake', 'Read'], { 1: [1, 1], 2: [1, 2], 3: [2, 2], 30: [1, 1] });
    const b = dayBars(2026, 8, data, TODAY);
    expect(b.bars).toHaveLength(30);
    expect(b.bars[1]).toEqual({ day: 2, done: 1, missed: 1, when: 'past', perfect: false });
    expect(b.bars.filter((d) => d.perfect).map((d) => d.day)).toEqual([1, 30]);
    expect(b.perfectDays).toBe(2);
  });

  it('gives the month the rate the summary page shows', () => {
    const data = month(['Wake', 'Read'], { ...days(1, 21, [1, 2]), 22: [1, 0] });
    const b = dayBars(2026, 9, data, TODAY);
    expect(b.pct).toBe(summarizeMonth(2026, 9, data, [], NOW).pct);
    expect(b.bars[21].when).toBe('today');
    expect(b.bars[22].when).toBe('future');
  });

  it('has nothing perfect and no rate without habits', () => {
    const b = dayBars(2026, 8, month([]), TODAY);
    expect(b.perfectDays).toBe(0);
    expect(b.pct).toBeNull();
  });
});

describe('axisDays', () => {
  it('labels one day a week', () => {
    expect(axisDays(31, [])).toEqual([1, 8, 15, 22, 29]);
    expect(axisDays(28, [null])).toEqual([1, 8, 15, 22]);
  });

  it('puts the emphasised days first and keeps the rest clear of them', () => {
    expect(axisDays(31, [10, 22])).toEqual([1, 10, 15, 22, 29]);
    expect(axisDays(31, [30])).toEqual([1, 8, 15, 22, 30]);
  });

  it('drops the second of two emphasised days that would collide', () => {
    expect(axisDays(31, [13, 12])).toEqual([1, 8, 13, 22, 29]);
  });

  it('ignores days outside the month', () => {
    expect(axisDays(30, [31, 0])).toEqual([1, 8, 15, 22, 29]);
  });
});

describe('habitBars', () => {
  it('ranks by rate, ties sharing a place and keeping their order', () => {
    const data = month(['A', 'B', 'C', 'D'], days(1, 30, [2, 1, 1, 0]));
    data.grid['1:3'] = 1;
    const bars = habitBars(2026, 8, data, TODAY);
    expect(bars.map((b) => [b.name, b.pct, b.rank])).toEqual([
      ['B', 100, 1],
      ['C', 100, 1],
      ['D', 3, 3],
      ['A', 0, 4],
    ]);
  });

  it('puts habits with nothing to count last, unranked', () => {
    const first = { year: 2026, month: 9, day: 1 };
    const bars = habitBars(2026, 9, month(['A', 'B', 'C'], { 1: [0, 2, 1] }), first);
    expect(bars.map((b) => [b.name, b.rank])).toEqual([
      ['C', 1],
      ['B', 2],
      ['A', null],
    ]);
  });

  it('carries the month day by day and the longest run done', () => {
    const data = month(['A'], { ...days(3, 5, [1]), 6: [2], ...days(10, 13, [1]) });
    const [a] = habitBars(2026, 8, data, TODAY);
    expect(a.strip).toHaveLength(30);
    expect(a.strip.slice(2, 7)).toEqual([1, 1, 1, 2, 0]);
    expect(a.bestRun).toBe(4);
  });
});

describe('weekPoints', () => {
  const spans = (y: number, m: number) =>
    weekPoints(y, m, month(['A']), TODAY).map((w) => [w.first, w.last]);

  it('cuts Monday-to-Sunday weeks at the month ends', () => {
    expect(spans(2026, 9)).toEqual([[1, 4], [5, 11], [12, 18], [19, 25], [26, 31]]);
    expect(spans(2026, 10)).toEqual([[1, 1], [2, 8], [9, 15], [16, 22], [23, 29], [30, 30]]);
    expect(spans(2027, 1)).toEqual([[1, 7], [8, 14], [15, 21], [22, 28]]);
  });

  it('rates each week and the change on the one before', () => {
    const data = month(['A', 'B'], { ...days(1, 6, [1, 1]), ...days(7, 13, [1, 2]) });
    const w = weekPoints(2026, 8, data, TODAY);
    expect(w.map((p) => p.pct)).toEqual([100, 50, 0, 0, 0]);
    expect(w.map((p) => p.change)).toEqual([null, -50, -50, 0, 0]);
    expect(w.every((p) => !p.running)).toBe(true);
  });

  it('counts a running week on what has passed or been marked', () => {
    const data = month(['A', 'B'], { 19: [1, 1], 20: [1, 0], 22: [1, 0] });
    const w = weekPoints(2026, 9, data, TODAY);
    // the 19th to the 21st count in full, today only where marked
    expect(w[3]).toMatchObject({ done: 4, counted: 7, pct: 57, running: true });
    expect(w[4]).toMatchObject({ counted: 0, pct: null, running: true, change: null });
    expect(w[2].running).toBe(false);
  });
});

describe('smoothPath', () => {
  it('starts at the first point and ends at the last', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 1, y: 2 }])).toBe('M1 2');
    const d = smoothPath([
      { x: 0, y: 10 },
      { x: 10, y: 0 },
      { x: 20, y: 5 },
    ]);
    expect(d.startsWith('M0 10 C')).toBe(true);
    expect(d.endsWith(' 20 5')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
  });

  it('gives one curve per gap between points', () => {
    expect(smoothSegments([{ x: 0, y: 0 }])).toEqual([]);
    const pts = [0, 50, 20, 80].map((y, i) => ({ x: i * 10, y }));
    const segs = smoothSegments(pts);
    expect(segs).toHaveLength(3);
    expect(segs[2].endsWith(' 30 80')).toBe(true);
  });

  it('never swings past the values it was given', () => {
    const pts = [0, 100, 95, 0, 0, 60].map((y, i) => ({ x: i * 40, y }));
    const nums = smoothPath(pts)
      .split(' C')
      .slice(1)
      .map((seg) => seg.split(' ').map(Number));
    nums.forEach((seg, i) => {
      const lo = Math.min(pts[i].y, pts[i + 1].y);
      const hi = Math.max(pts[i].y, pts[i + 1].y);
      [seg[1], seg[3]].forEach((y) => {
        expect(y).toBeGreaterThanOrEqual(lo - 0.01);
        expect(y).toBeLessThanOrEqual(hi + 0.01);
      });
    });
  });
});

describe('weekdayHeat', () => {
  it('finds the weekdays that slip and the ones that hold', () => {
    // September 2026: Mondays are the 7th, 14th, 21st and 28th
    const data = month(['A', 'B'], { 7: [1, 1], 14: [1, 1], 21: [1, 0], 28: [1, 1], 1: [1, 2] });
    const h = weekdayHeat(2026, 8, data, TODAY);
    expect(h.rows.map((r) => r.name)).toEqual(['A', 'B']);
    expect(h.all[0]).toEqual({ done: 7, missed: 0, counted: 8, pct: 88 });
    expect(h.rows[0].cells[0].pct).toBe(100);
    expect(h.all[1]).toEqual({ done: 1, missed: 1, counted: 10, pct: 10 });
    expect(h.strongest).toEqual([0]);
    expect(h.weakest).toEqual([2, 3, 4, 5, 6]);
  });

  it('leaves days still to come out of the count', () => {
    const h = weekdayHeat(2026, 9, month(['A'], { 22: [1] }), TODAY);
    // Thursdays: the 1st, 8th and 15th have passed blank, the 22nd is done, the 29th is ahead
    expect(h.all[3]).toEqual({ done: 1, missed: 0, counted: 4, pct: 25 });
    // Fridays: the 2nd, 9th and 16th have passed; the 23rd and 30th have not
    expect(h.all[4].counted).toBe(3);
  });

  it('names nothing when every weekday is level or there are no habits', () => {
    const level = weekdayHeat(2026, 8, month(['A'], days(1, 30, [1])), TODAY);
    expect(level.weakest).toEqual([]);
    expect(level.strongest).toEqual([]);
    const none = weekdayHeat(2026, 8, month([]), TODAY);
    expect(none.rows).toEqual([]);
    expect(none.all.every((t) => t.pct === null)).toBe(true);
    expect(none.weakest).toEqual([]);
  });
});

describe('heatLevel', () => {
  it('shades by the share done, the same steps as the year grid', () => {
    expect([1, 2, 3, 4].map((done) => heatLevel(done, 0, 4))).toEqual([1, 2, 3, 4]);
    expect(heatLevel(1, 0, 3)).toBe(2);
  });

  it('is red only when misses were marked and nothing was done', () => {
    expect(heatLevel(0, 2, 4)).toBe('missed');
    expect(heatLevel(1, 2, 4)).toBe(1);
    expect(heatLevel(0, 0, 4)).toBe(0);
    expect(heatLevel(0, 0, 0)).toBe(0);
  });
});
