import {
  compareMonths,
  deadlinesIn,
  monthTotals,
  summarizeMonth,
  tallyMonth,
} from '../monthSummary';
import type { Task } from '../tasks';
import { emptyMonthData } from '../types';
import type { CellState, MonthData } from '../types';

/** 22 Oct 2026, midday; September has 30 days and October 31 */
const NOW = new Date(2026, 9, 22, 12, 0).getTime();
const TODAY = { year: 2026, month: 9, day: 22 };

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

/** `marks` is `{ day: [state per habit] }`, as in history.test.ts */
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

/** The same states on every day from `from` to `to` */
function days(from: number, to: number, states: CellState[]): Record<number, CellState[]> {
  const out: Record<number, CellState[]> = {};
  for (let d = from; d <= to; d++) out[d] = states;
  return out;
}

function task(over: Partial<Task> = {}): Task {
  return { id: '0', text: 'Ship it', due: at(2026, 9, 10), done: false, ...over };
}

describe('summarizeMonth for a past month', () => {
  it('counts every cell of the month', () => {
    const data = month(['Wake', 'Read'], { ...days(1, 10, [1, 2]), 11: [1, 0] });
    const s = summarizeMonth(2026, 8, data, [], NOW);
    expect(s.phase).toBe('past');
    expect(s.daysPast).toBe(30);
    expect(s.done).toBe(11);
    expect(s.missed).toBe(10);
    expect(s.empty).toBe(60 - 21);
    expect(s.pct).toBe(Math.round((11 / 60) * 100));
  });

  it('rates each habit and names the best and the weakest', () => {
    const data = month(['Wake', 'Read', 'Run'], days(1, 30, [1, 2, 0]));
    data.grid['1:2'] = 1;
    const s = summarizeMonth(2026, 8, data, [], NOW);
    expect(s.habits.map((h) => h.pct)).toEqual([100, 0, 3]);
    expect(s.best.map((h) => h.name)).toEqual(['Wake']);
    expect(s.weakest.map((h) => h.name)).toEqual(['Read']);
  });

  it('gives a blank habit name a readable one', () => {
    const s = summarizeMonth(2026, 8, month(['  ']), [], NOW);
    expect(s.habits[0].name).toBe('Untitled habit');
  });

  it('names every habit tied at the top or the bottom', () => {
    const data = month(['A', 'B', 'C', 'D'], { 1: [1, 1, 2, 2] });
    const s = summarizeMonth(2026, 8, data, [], NOW);
    expect(s.best.map((h) => h.name)).toEqual(['A', 'B']);
    expect(s.weakest.map((h) => h.name)).toEqual(['C', 'D']);
  });

  it('leaves a habit with nothing to count out of best and weakest', () => {
    // the 1st, with C still blank: it has no rate yet rather than a rate of 0
    const first = new Date(2026, 9, 1, 9).getTime();
    const s = summarizeMonth(2026, 9, month(['A', 'B', 'C'], { 1: [1, 2, 0] }), [], first);
    expect(s.habits[2].pct).toBeNull();
    expect(s.best.map((h) => h.name)).toEqual(['A']);
    expect(s.weakest.map((h) => h.name)).toEqual(['B']);
  });

  it('names no best or weakest when every habit did as well as the others', () => {
    const data = month(['A', 'B'], days(1, 30, [1, 1]));
    const s = summarizeMonth(2026, 8, data, [], NOW);
    expect(s.best).toEqual([]);
    expect(s.weakest).toEqual([]);
  });

  it('names no best or weakest with a single habit', () => {
    const s = summarizeMonth(2026, 8, month(['A'], { 1: [1] }), [], NOW);
    expect(s.best).toEqual([]);
    expect(s.weakest).toEqual([]);
  });

  it('finds the longest run of days with anything done', () => {
    const data = month(['A', 'B'], { ...days(2, 5, [1, 0]), ...days(10, 16, [0, 1]), 17: [2, 2] });
    expect(summarizeMonth(2026, 8, data, [], NOW).longestStreak).toBe(7);
  });

  it('handles February in a leap year', () => {
    const data = month(['A'], days(1, 29, [1]));
    const s = summarizeMonth(2028, 1, data, [], NOW);
    expect(s.daysInMonth).toBe(29);
    expect(s.pct).toBe(100);
    expect(s.longestStreak).toBe(29);
  });
});

describe('summarizeMonth for the month in progress', () => {
  it('counts the days that are over, and today only where it is marked', () => {
    const data = month(['A', 'B'], { ...days(1, 21, [1, 0]), 22: [1, 0] });
    const s = summarizeMonth(2026, 9, data, [], NOW);
    expect(s.phase).toBe('current');
    expect(s.daysPast).toBe(21);
    expect(s.done).toBe(22);
    expect(s.empty).toBe(21);
    // B's blank today is still open, not empty
    expect(s.habits[1].empty).toBe(21);
    expect(s.pct).toBe(Math.round((22 / 43) * 100));
  });

  it('has nothing to count on the first of the month before anything is marked', () => {
    const first = new Date(2026, 9, 1, 8).getTime();
    const s = summarizeMonth(2026, 9, month(['A']), [], first);
    expect(s.daysPast).toBe(0);
    expect(s.pct).toBeNull();
    expect(s.habits[0].pct).toBeNull();
  });
});

describe('summarizeMonth for a month that has not started', () => {
  it('counts nothing', () => {
    const s = summarizeMonth(2026, 10, month(['A', 'B']), [], NOW);
    expect(s.phase).toBe('future');
    expect(s.daysPast).toBe(0);
    expect(s.empty).toBe(0);
    expect(s.pct).toBeNull();
  });
});

describe('summarizeMonth with no habits', () => {
  it('reports an empty month without dividing by zero', () => {
    const s = summarizeMonth(2026, 8, emptyMonthData(), [], NOW);
    expect(s.habitCount).toBe(0);
    expect(s.habits).toEqual([]);
    expect(s.pct).toBeNull();
    expect(s.longestStreak).toBe(0);
    expect(s.goals).toEqual({ done: 0, total: 0, named: [] });
    expect(s.observations).toEqual([]);
    expect(s.previous).toBeNull();
  });
});

describe('summarizeMonth with a damaged month', () => {
  it('ignores marks left behind by a habit that did not survive', () => {
    const data = month(['A'], days(1, 30, [1]));
    data.grid['3:7'] = 2;
    const s = summarizeMonth(2026, 8, data, [], NOW);
    expect(s.missed).toBe(0);
    expect(s.pct).toBe(100);
  });
});

describe('goals and observations', () => {
  it('counts only goals that were written down', () => {
    const data = month([]);
    data.keyGoals = [
      { text: 'Read two books', done: true },
      { text: ' ', done: true },
      { text: 'Move house', done: false },
    ];
    const { goals } = summarizeMonth(2026, 8, data, [], NOW);
    expect(goals.done).toBe(1);
    expect(goals.total).toBe(2);
    expect(goals.named.map((g) => g.text)).toEqual(['Read two books', 'Move house']);
  });

  it('keeps written observations, trimmed', () => {
    const data = month([]);
    data.observations = ['  Slept better ', '', '   ', 'Fewer late nights'];
    expect(summarizeMonth(2026, 8, data, [], NOW).observations).toEqual([
      'Slept better',
      'Fewer late nights',
    ]);
  });
});

describe('deadlinesIn', () => {
  it('sorts the month’s deadlines into met, late, overdue and open', () => {
    const tasks = [
      task({ id: '1', done: true, completedAt: at(2026, 9, 9) }),
      task({ id: '2', done: true, completedAt: at(2026, 9, 12) }),
      task({ id: '3', done: true }),
      task({ id: '4' }),
      task({ id: '5', due: at(2026, 9, 30) }),
    ];
    expect(deadlinesIn(2026, 9, tasks, NOW)).toEqual({ met: 2, late: 1, overdue: 1, open: 1 });
  });

  it('leaves out deadlines due in other months and rows with no name', () => {
    const tasks = [
      task({ due: at(2026, 8, 30, 23) }),
      task({ due: at(2026, 10, 1, 0) }),
      task({ text: '  ' }),
    ];
    expect(deadlinesIn(2026, 9, tasks, NOW)).toEqual({ met: 0, late: 0, overdue: 0, open: 0 });
  });
});

describe('monthTotals and compareMonths', () => {
  it('counts a month from its tallies the same way as from its grid', () => {
    const data = month(['A', 'B'], { ...days(1, 9, [1, 2]), 22: [1, 1] });
    const fromGrid = summarizeMonth(2026, 9, data, [], NOW);
    const fromTallies = monthTotals(2026, 9, tallyMonth(data, 31), TODAY);
    expect(fromTallies).toEqual({
      habitCount: fromGrid.habitCount,
      done: fromGrid.done,
      missed: fromGrid.missed,
      empty: fromGrid.empty,
      pct: fromGrid.pct,
      longestStreak: fromGrid.longestStreak,
    });
  });

  it('reads a month with nothing stored as empty', () => {
    expect(monthTotals(2026, 8, { habitCount: 0, tallies: {} }, TODAY)).toEqual({
      habitCount: 0, done: 0, missed: 0, empty: 0, pct: null, longestStreak: 0,
    });
  });

  it('gives the change from the previous month', () => {
    const before = monthTotals(2026, 8, tallyMonth(month(['A'], days(1, 15, [1])), 30), TODAY);
    const after = monthTotals(2026, 9, tallyMonth(month(['A'], days(1, 21, [1])), 31), TODAY);
    expect(compareMonths(after, before)).toEqual({
      pct: 100 - 50,
      done: 6,
      missed: 0,
      longestStreak: 6,
    });
  });

  it('compares January with the December before it', () => {
    const december = tallyMonth(month(['A'], days(1, 31, [1])), 31);
    const s = summarizeMonth(2027, 0, month(['A'], days(1, 31, [2])), [], NOW, december);
    expect(s.previous?.year).toBe(2026);
    expect(s.previous?.month).toBe(11);
    expect(s.previous?.change.pct).toBe(-100);
    expect(s.previous?.change.longestStreak).toBe(-31);
  });

  it('has no percentage change when the previous month had nothing to count', () => {
    const before = monthTotals(2026, 8, { habitCount: 0, tallies: {} }, TODAY);
    const after = monthTotals(2026, 9, tallyMonth(month(['A'], { 1: [1] }), 31), TODAY);
    expect(compareMonths(after, before).pct).toBeNull();
  });
});
