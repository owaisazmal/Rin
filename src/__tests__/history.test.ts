import {
  buildHistory,
  dayHeading,
  filterHistory,
  historyTotals,
  lateness,
} from '../history';
import type { HistoryDay } from '../history';
import type { MonthRecord } from '../storage';
import { toggleDone } from '../tasks';
import type { Task } from '../tasks';
import { emptyMonthData } from '../types';
import type { CellState } from '../types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 15 Sep 2026, midday — the "now" every test below is written against */
const NOW = new Date(2026, 8, 15, 12, 0).getTime();

const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m, d, h, min).getTime();

/**
 * One stored month. `marks` is `{ day: [state per habit] }`, so
 * `{ 3: [1, 2] }` means habit one done and habit two missed on the 3rd.
 */
function month(
  year: number,
  m: number,
  habits: string[],
  marks: Record<number, CellState[]>
): MonthRecord {
  const data = emptyMonthData();
  data.habits = habits.map((name, i) => ({ id: String(i), name }));
  for (const [day, states] of Object.entries(marks)) {
    states.forEach((state, i) => {
      if (state !== 0) data.grid[`${day}:${i}`] = state;
    });
  }
  return { year, month: m, data };
}

function task(over: Partial<Task> = {}): Task {
  return { id: '0', text: 'Something', due: NOW, done: true, ...over };
}

describe('buildHistory', () => {
  const habits = ['Wake', 'Read'];

  it('groups marks by day, newest first', () => {
    const months = [month(2026, 8, habits, { 1: [1, 1], 3: [1, 2], 5: [2, 2] })];
    const days = buildHistory(months, [], NOW);
    expect(days.map((d) => d.day)).toEqual([5, 3, 1]);
  });

  it('counts done and missed, and remembers how many habits there were', () => {
    const months = [month(2026, 8, habits, { 3: [1, 2] })];
    const [day] = buildHistory(months, [], NOW);
    expect(day.done).toBe(1);
    expect(day.missed).toBe(1);
    expect(day.habitCount).toBe(2);
    expect(day.marks.map((m) => m.name)).toEqual(['Wake', 'Read']);
  });

  it('leaves out days where nothing was marked', () => {
    const months = [month(2026, 8, habits, { 1: [1, 1], 2: [0, 0], 3: [1, 0] })];
    expect(buildHistory(months, [], NOW).map((d) => d.day)).toEqual([3, 1]);
  });

  it('leaves out the future, even if something is marked there', () => {
    // the 20th is ahead of NOW; nothing has happened there yet
    const months = [month(2026, 8, habits, { 14: [1, 1], 20: [1, 1] })];
    expect(buildHistory(months, [], NOW).map((d) => d.day)).toEqual([14]);
  });

  it('includes today itself', () => {
    const months = [month(2026, 8, habits, { 15: [1, 0] })];
    expect(buildHistory(months, [], NOW).map((d) => d.day)).toEqual([15]);
  });

  it('names an untitled habit rather than showing a blank chip', () => {
    const months = [month(2026, 8, ['', 'Read'], { 3: [1, 0] })];
    const [day] = buildHistory(months, [], NOW);
    expect(day.marks[0].name).toBe('Untitled habit');
  });

  it('files a finished deadline on the day it was finished', () => {
    const t = task({ due: at(2026, 8, 10, 17), completedAt: at(2026, 8, 12, 9) });
    const [day] = buildHistory([], [t], NOW);
    expect(day.day).toBe(12);
    expect(day.deadlines[0].late).toBe(true);
  });

  it('marks a deadline met before its date as on time', () => {
    const t = task({ due: at(2026, 8, 10, 17), completedAt: at(2026, 8, 10, 9) });
    const [day] = buildHistory([], [t], NOW);
    expect(day.deadlines[0].late).toBe(false);
  });

  it('falls back to the due date when the completion time was never recorded', () => {
    // written before completedAt existed: the deadline is the only honest date
    const t = task({ due: at(2026, 8, 8, 17), completedAt: undefined });
    const [day] = buildHistory([], [t], NOW);
    expect(day.day).toBe(8);
    expect(day.deadlines[0].completedAt).toBeNull();
    expect(day.deadlines[0].late).toBe(false);
  });

  it('ignores deadlines that are still open, however overdue', () => {
    const open = task({ id: 'open', done: false, due: at(2026, 8, 1, 9) });
    expect(buildHistory([], [open], NOW)).toEqual([]);
  });

  it('puts habits and a deadline finished the same day on one card', () => {
    const months = [month(2026, 8, habits, { 12: [1, 1] })];
    const t = task({ completedAt: at(2026, 8, 12, 9), due: at(2026, 8, 12, 17) });
    const days = buildHistory(months, [t], NOW);
    expect(days).toHaveLength(1);
    expect(days[0].marks).toHaveLength(2);
    expect(days[0].deadlines).toHaveLength(1);
  });

  it('names an untitled task', () => {
    const t = task({ text: '  ', completedAt: at(2026, 8, 12, 9) });
    const [day] = buildHistory([], [t], NOW);
    expect(day.deadlines[0].text).toBe('Untitled task');
  });

  it('shows each finished occurrence of a recurring deadline on its own', () => {
    let tasks = [task({ text: 'Report', done: false, due: at(2026, 8, 4, 17), repeat: { every: 'week' } })];
    tasks = toggleDone(tasks, '0', at(2026, 8, 4, 9));
    tasks = toggleDone(tasks, '0', at(2026, 8, 12, 9)); // 11 Sep, a day late
    const days = buildHistory([], tasks, NOW);
    expect(days.map((d) => [d.day, d.deadlines])).toEqual([
      [12, [{ text: 'Report', due: at(2026, 8, 11, 17), completedAt: at(2026, 8, 12, 9), late: true }]],
      [4, [{ text: 'Report', due: at(2026, 8, 4, 17), completedAt: at(2026, 8, 4, 9), late: false }]],
    ]);
  });

  it('keeps two occurrences finished on the same day apart', () => {
    let tasks = [task({ text: 'Report', done: false, due: at(2026, 8, 4, 17), repeat: { every: 'week' } })];
    tasks = toggleDone(tasks, '0', at(2026, 8, 10, 9));
    tasks = toggleDone(tasks, '0', at(2026, 8, 10, 10));
    const [day] = buildHistory([], tasks, NOW);
    expect(day.deadlines.map((e) => e.due)).toEqual([at(2026, 8, 4, 17), at(2026, 8, 11, 17)]);
  });
});

describe('filterHistory', () => {
  const months = [month(2026, 8, ['Wake'], { 11: [1] })];
  const finished = task({ completedAt: at(2026, 8, 12, 9), due: at(2026, 8, 12, 17) });
  const days = buildHistory(months, [finished], NOW);

  it('leaves everything alone on "all"', () => {
    expect(filterHistory(days, 'all')).toBe(days);
  });

  it('keeps only days with habit marks, and strips their deadlines', () => {
    const habitsOnly = filterHistory(days, 'habits');
    expect(habitsOnly.map((d) => d.day)).toEqual([11]);
    expect(habitsOnly[0].deadlines).toEqual([]);
  });

  it('keeps only days with deadlines, and strips their marks', () => {
    const deadlinesOnly = filterHistory(days, 'deadlines');
    expect(deadlinesOnly.map((d) => d.day)).toEqual([12]);
    expect(deadlinesOnly[0].marks).toEqual([]);
    expect(deadlinesOnly[0].done).toBe(0);
  });
});

describe('dayHeading', () => {
  const day = (d: number): HistoryDay => ({
    key: new Date(2026, 8, d).getTime(),
    year: 2026,
    month: 8,
    day: d,
    marks: [],
    done: 0,
    missed: 0,
    habitCount: 0,
    deadlines: [],
  });

  it('names today and yesterday', () => {
    expect(dayHeading(day(15), NOW)).toBe('TODAY');
    expect(dayHeading(day(14), NOW)).toBe('YESTERDAY');
  });

  it('gives anything older a weekday and date', () => {
    expect(dayHeading(day(12), NOW)).toBe('SAT 12 SEP'); // 12 Sep 2026 is a Saturday
  });
});

describe('lateness', () => {
  const event = (over: number) => ({
    text: 'x',
    due: NOW,
    completedAt: NOW + over,
    late: over > 0,
  });

  it('is nothing at all when the deadline was met', () => {
    expect(lateness(event(-HOUR))).toBeNull();
  });

  it('reports the coarsest unit that still says something', () => {
    expect(lateness(event(2 * DAY))).toBe('2d late');
    expect(lateness(event(5 * HOUR))).toBe('5h late');
    expect(lateness(event(30 * MINUTE))).toBe('30m late');
  });

  it('never rounds a late finish down to "0m late"', () => {
    expect(lateness(event(10_000))).toBe('1m late');
  });

  it('says nothing when the completion time is unknown', () => {
    expect(lateness({ text: 'x', due: NOW, completedAt: null, late: true })).toBeNull();
  });
});

describe('historyTotals', () => {
  it('adds up what is currently in view', () => {
    const months = [month(2026, 8, ['Wake', 'Read'], { 10: [1, 2], 11: [1, 1] })];
    const onTime = task({ id: 'a', completedAt: at(2026, 8, 12, 9), due: at(2026, 8, 12, 17) });
    const late = task({ id: 'b', completedAt: at(2026, 8, 13, 9), due: at(2026, 8, 12, 17) });
    const totals = historyTotals(buildHistory(months, [onTime, late], NOW));

    expect(totals).toEqual({ done: 3, missed: 1, finished: 2, late: 1, days: 4 });
  });

  it('is all zeroes for an empty list', () => {
    expect(historyTotals([])).toEqual({ done: 0, missed: 0, finished: 0, late: 0, days: 0 });
  });
});
