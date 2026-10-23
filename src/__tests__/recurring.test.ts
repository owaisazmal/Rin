import { clampNote, nextDue, parseRepeat, repeatFor, stepDue } from '../recurring';
import { planReminders } from '../notifications';
import { defaultNotifications } from '../settings';
import { toggleDone } from '../tasks';
import { buildSnapshot } from '../widgets/snapshot';
import { emptyMonthData } from '../types';
import type { Repeat, Task } from '../tasks';

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Local time, 18:00 unless said otherwise */
const at = (y: number, m: number, d: number, h = 18, min = 0) =>
  new Date(y, m, d, h, min).getTime();

const weekly: Repeat = { every: 'week' };
const monthlyOn = (day: number): Repeat => ({ every: 'month', day });
const yearlyOn = (day: number): Repeat => ({ every: 'year', day });

/** Steps `count` times from `due`, as local dates for reading */
function series(due: number, rule: Repeat, count: number): string[] {
  const out: string[] = [];
  let next = due;
  for (let i = 0; i < count; i++) {
    next = stepDue(next, rule);
    const d = new Date(next);
    out.push(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
  }
  return out;
}

describe('stepDue', () => {
  it('moves a weekly deadline on seven days, across a month end', () => {
    expect(series(at(2026, 8, 28), weekly, 2)).toEqual(['2026-10-5 18:00', '2026-10-12 18:00']);
  });

  it('rolls a weekly deadline over the year end', () => {
    expect(series(at(2026, 11, 28, 9, 30), weekly, 2)).toEqual(['2027-1-4 9:30', '2027-1-11 9:30']);
  });

  it('keeps the wall-clock time across a daylight saving change', () => {
    // clocks go back on 1 Nov 2026 in the test zone
    expect(series(at(2026, 9, 29), weekly, 1)).toEqual(['2026-11-5 18:00']);
    expect(series(at(2026, 9, 31), monthlyOn(31), 1)).toEqual(['2026-11-30 18:00']);
  });

  it('rolls a monthly deadline over the year end', () => {
    expect(series(at(2026, 10, 15), monthlyOn(15), 3)).toEqual([
      '2026-12-15 18:00',
      '2027-1-15 18:00',
      '2027-2-15 18:00',
    ]);
  });

  it('carries the 31st from December into January', () => {
    expect(series(at(2026, 11, 31), monthlyOn(31), 1)).toEqual(['2027-1-31 18:00']);
  });

  it('clamps the 31st to the last day of a short month, then goes back', () => {
    expect(series(at(2027, 0, 31), monthlyOn(31), 5)).toEqual([
      '2027-2-28 18:00',
      '2027-3-31 18:00',
      '2027-4-30 18:00',
      '2027-5-31 18:00',
      '2027-6-30 18:00',
    ]);
  });

  it('lands on 29 Feb in a leap year', () => {
    expect(series(at(2028, 0, 31), monthlyOn(31), 2)).toEqual(['2028-2-29 18:00', '2028-3-31 18:00']);
  });

  it('keeps the 30th on the 30th once February is past', () => {
    expect(series(at(2027, 0, 30), monthlyOn(30), 2)).toEqual(['2027-2-28 18:00', '2027-3-30 18:00']);
  });

  it('rolls a yearly deadline over the year end on the same date', () => {
    expect(series(at(2026, 11, 31, 23, 55), yearlyOn(31), 2)).toEqual([
      '2027-12-31 23:55',
      '2028-12-31 23:55',
    ]);
  });

  it('clamps 29 Feb to the 28th outside leap years and returns in the next one', () => {
    expect(series(at(2028, 1, 29), yearlyOn(29), 4)).toEqual([
      '2029-2-28 18:00',
      '2030-2-28 18:00',
      '2031-2-28 18:00',
      '2032-2-29 18:00',
    ]);
  });

  it("falls back to the due date's own day when the rule has none", () => {
    expect(series(at(2026, 4, 20), { every: 'month' }, 1)).toEqual(['2026-6-20 18:00']);
  });
});

describe('nextDue', () => {
  it('takes one step when ticked on time', () => {
    const due = at(2026, 9, 5);
    expect(nextDue(due, weekly, due - HOUR)).toBe(at(2026, 9, 12));
  });

  it('takes one step when ticked early, never handing back the same occurrence', () => {
    expect(nextDue(at(2026, 10, 1), monthlyOn(1), at(2026, 9, 25))).toBe(at(2026, 11, 1));
  });

  it('skips the dates a late tick has already passed', () => {
    // missed 5 Oct and 12 Oct, ticked on the 20th: the next one still ahead is the 26th
    expect(nextDue(at(2026, 9, 5), weekly, at(2026, 9, 20, 12))).toBe(at(2026, 9, 26));
  });

  it('skips past dates without losing the month-end day', () => {
    expect(nextDue(at(2027, 0, 31), monthlyOn(31), at(2027, 2, 1))).toBe(at(2027, 2, 31));
  });

  it('crosses the year end on a late tick', () => {
    expect(nextDue(at(2026, 11, 31), monthlyOn(31), at(2027, 0, 2))).toBe(at(2027, 0, 31));
  });
});

describe('parseRepeat', () => {
  const due = at(2026, 9, 31);

  it('keeps a usable rule', () => {
    expect(parseRepeat({ every: 'month', day: 31 }, due)).toEqual({ every: 'month', day: 31 });
    expect(parseRepeat({ every: 'year', day: 29 }, due)).toEqual({ every: 'year', day: 29 });
  });

  it('drops the day from a weekly rule', () => {
    expect(parseRepeat({ every: 'week', day: 3 }, due)).toEqual({ every: 'week' });
  });

  it.each([undefined, null, 'monthly', 7, {}, { every: 'day' }, { every: 'MONTH' }])(
    'reads %p as no rule at all',
    (raw) => {
      expect(parseRepeat(raw, due)).toBeUndefined();
    }
  );

  it.each([undefined, 0, 32, 2.5, '31'])("takes the due date's day for a day of %p", (day) => {
    expect(parseRepeat({ every: 'month', day }, due)).toEqual({ every: 'month', day: 31 });
  });
});

describe('repeatFor', () => {
  const clamped = { due: at(2027, 1, 28), repeat: monthlyOn(31) };

  it('is nothing for a one-off', () => {
    expect(repeatFor(null, clamped.due, clamped)).toBeUndefined();
  });

  it('takes the day from the date picked', () => {
    expect(repeatFor('month', at(2026, 9, 31))).toEqual(monthlyOn(31));
    expect(repeatFor('year', at(2028, 1, 29))).toEqual(yearlyOn(29));
    expect(repeatFor('week', at(2026, 9, 31))).toEqual(weekly);
  });

  it('keeps a clamped series on its own day when only the time changes', () => {
    expect(repeatFor('month', at(2027, 1, 28, 9), clamped)).toEqual(monthlyOn(31));
  });

  it('starts again from a newly picked date', () => {
    expect(repeatFor('month', at(2027, 2, 15), clamped)).toEqual(monthlyOn(15));
  });

  it('starts again when the rule itself changes', () => {
    expect(repeatFor('year', clamped.due, clamped)).toEqual(yearlyOn(28));
  });
});

describe('clampNote', () => {
  it('says what a month-end series does in a short month', () => {
    expect(clampNote('month', at(2026, 9, 31))).toBe('Months without a 31st use their last day.');
    expect(clampNote('month', at(2026, 8, 30))).toBe('Months without a 30th use their last day.');
    expect(clampNote('month', at(2026, 0, 29))).toBe('Months without a 29th use their last day.');
  });

  it('says what 29 Feb does outside leap years', () => {
    expect(clampNote('year', at(2028, 1, 29))).toBe('Falls on 28 Feb outside leap years.');
  });

  it('says nothing when the day always exists', () => {
    expect(clampNote('month', at(2026, 9, 28))).toBeNull();
    expect(clampNote('year', at(2026, 9, 31))).toBeNull();
    expect(clampNote('week', at(2026, 9, 31))).toBeNull();
    expect(clampNote(null, at(2026, 9, 31))).toBeNull();
  });
});

describe('reminders for a recurring deadline', () => {
  /** Tue 15 Sep 2026, 10:00 */
  const NOW = new Date(2026, 8, 15, 10, 0);
  const prefs = { ...defaultNotifications(), habits: false };
  const deadlinesFor = (tasks: Task[]) =>
    planReminders({ habits: [], grid: {}, today: 15, tasks, now: NOW, prefs });

  const oneOff: Task = { id: '0', text: 'Weekly report', due: NOW.getTime() + 4 * DAY, done: false };
  const recurring: Task = { ...oneOff, repeat: weekly };

  it('spends exactly what a one-off deadline does', () => {
    expect(deadlinesFor([recurring])).toEqual(deadlinesFor([oneOff]));
  });

  it('spends nothing on finished occurrences, only the next one', () => {
    let tasks = [recurring];
    // ticked three weeks running
    for (let week = 0; week < 3; week++) {
      tasks = toggleDone(tasks, '0', NOW.getTime() - (3 - week) * 7 * DAY);
    }
    expect(tasks.filter((t) => t.done)).toHaveLength(3);
    const open = tasks.filter((t) => !t.done);
    expect(open).toHaveLength(1);

    const planned = deadlinesFor(tasks);
    expect(planned).toEqual(deadlinesFor(open));
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every((n) => n.date.getTime() <= open[0].due)).toBe(true);
  });
});

describe('the widget snapshot', () => {
  const now = new Date(2026, 9, 22, 12);
  const quotes = { quotes: ['Keep going.'], ownFrom: 1 };
  const snap = (tasks: Task[]) =>
    buildSnapshot(2026, 9, emptyMonthData(), [], now, 'dark', tasks, quotes).tasks;

  it('names the series on a recurring deadline', () => {
    const due = at(2026, 9, 31);
    expect(snap([{ id: '0', text: 'Rent', due, done: false, repeat: monthlyOn(31) }])).toEqual([
      { text: 'Rent', due, repeats: 'monthly' },
    ]);
  });

  it('sends a one-off exactly as before, with no repeat key at all', () => {
    const [task] = snap([{ id: '0', text: 'Essay', due: at(2026, 9, 30), done: false }]);
    expect(JSON.stringify(task)).toBe(JSON.stringify({ text: 'Essay', due: at(2026, 9, 30) }));
  });

  it('leaves finished occurrences out, so only the next one shows', () => {
    const tasks = toggleDone([{ id: '0', text: 'Report', due: at(2026, 9, 23), done: false, repeat: weekly }], '0', now.getTime());
    expect(snap(tasks)).toEqual([{ text: 'Report', due: at(2026, 9, 30), repeats: 'weekly' }]);
  });
});
