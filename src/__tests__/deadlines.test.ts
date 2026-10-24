import {
  PRESSURE_WINDOW,
  dueLabel,
  pendingTasks,
  pressureOf,
  timeLeftLabel,
  unfinished,
  urgencyOf,
} from '../deadlines';
import type { Task } from '../tasks';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A fixed local moment, well away from any daylight-saving transition */
const NOW = new Date(2026, 8, 15, 12, 0).getTime(); // 15 Sep 2026, 12:00

function task(over: Partial<Task> = {}): Task {
  return { id: '0', text: 'Something', due: NOW + DAY, done: false, ...over };
}

describe('urgencyOf', () => {
  it('calls a finished task done, however far past its date', () => {
    expect(urgencyOf(task({ done: true, due: NOW - 90 * DAY }), NOW)).toBe('done');
  });

  it.each([
    { when: 'exactly at the deadline', offset: 0, band: 'overdue' },
    { when: 'a second past it', offset: -1_000, band: 'overdue' },
    { when: 'exactly an hour out', offset: HOUR, band: 'now' },
    { when: 'just over an hour out', offset: HOUR + 1, band: 'soon' },
    { when: 'exactly a day out', offset: DAY, band: 'soon' },
    { when: 'just over a day out', offset: DAY + 1, band: 'near' },
    { when: 'exactly three days out', offset: 3 * DAY, band: 'near' },
    { when: 'just over three days out', offset: 3 * DAY + 1, band: 'later' },
  ])('$when is "$band"', ({ offset, band }) => {
    expect(urgencyOf(task({ due: NOW + offset }), NOW)).toBe(band);
  });
});

describe('pressureOf', () => {
  it('is empty a full week out', () => {
    expect(pressureOf(NOW + PRESSURE_WINDOW, NOW)).toBe(0);
  });

  it('stays empty beyond a week', () => {
    expect(pressureOf(NOW + 90 * DAY, NOW)).toBe(0);
  });

  it('is full at the deadline and stays full past it', () => {
    expect(pressureOf(NOW, NOW)).toBe(1);
    expect(pressureOf(NOW - 30 * DAY, NOW)).toBe(1);
  });

  it('runs linearly through the window', () => {
    expect(pressureOf(NOW + PRESSURE_WINDOW / 2, NOW)).toBeCloseTo(0.5, 10);
    expect(pressureOf(NOW + PRESSURE_WINDOW / 4, NOW)).toBeCloseTo(0.75, 10);
  });
});

describe('timeLeftLabel', () => {
  it.each([
    { ahead: 'three days', offset: 3 * DAY, label: '3d left' },
    { ahead: 'a day and 23 hours', offset: DAY + 23 * HOUR, label: '1d left' },
    { ahead: 'five hours', offset: 5 * HOUR, label: '5h left' },
    { ahead: 'twelve minutes', offset: 12 * MINUTE, label: '12m left' },
    { ahead: 'half a minute', offset: 30_000, label: 'due any moment' },
  ])('$ahead ahead reads "$label"', ({ offset, label }) => {
    expect(timeLeftLabel(NOW + offset, NOW)).toBe(label);
  });

  it.each([
    { past: 'two days', offset: 2 * DAY, label: '2d overdue' },
    { past: 'four hours', offset: 4 * HOUR, label: '4h overdue' },
    { past: 'seven minutes', offset: 7 * MINUTE, label: '7m overdue' },
    { past: 'half a minute', offset: 30_000, label: 'just overdue' },
  ])('$past past reads "$label"', ({ offset, label }) => {
    expect(timeLeftLabel(NOW - offset, NOW)).toBe(label);
  });

  it('reports only the largest unit, never a remainder', () => {
    expect(timeLeftLabel(NOW + 2 * DAY + 11 * HOUR + 30 * MINUTE, NOW)).toBe('2d left');
  });
});

describe('dueLabel', () => {
  it('names the two days that get read at a glance', () => {
    const today = new Date(2026, 8, 15, 18, 0).getTime();
    const tomorrow = new Date(2026, 8, 16, 9, 5).getTime();
    const yesterday = new Date(2026, 8, 14, 23, 30).getTime();

    expect(dueLabel(today, NOW)).toBe('Today · 18:00');
    expect(dueLabel(tomorrow, NOW)).toBe('Tomorrow · 09:05');
    expect(dueLabel(yesterday, NOW)).toBe('Yesterday · 23:30');
  });

  it('gives anything further out a real date, rather than making you count', () => {
    const later = new Date(2026, 9, 3, 18, 0).getTime(); // Sat 3 Oct 2026
    expect(dueLabel(later, NOW)).toBe('Sat 3 Oct · 18:00');
  });

  it('pads hours and minutes', () => {
    expect(dueLabel(new Date(2026, 8, 15, 7, 5).getTime(), NOW)).toBe('Today · 07:05');
  });

  it('reads the day from the calendar, not from hours elapsed', () => {
    // 23:30 today and 00:30 tomorrow are an hour apart but different days
    const lateTonight = new Date(2026, 8, 15, 23, 30).getTime();
    const earlyTomorrow = new Date(2026, 8, 16, 0, 30).getTime();
    expect(dueLabel(lateTonight, lateTonight)).toBe('Today · 23:30');
    expect(dueLabel(earlyTomorrow, lateTonight)).toBe('Tomorrow · 00:30');
  });
});

describe('unfinished', () => {
  it('drops finished tasks and sorts the rest soonest first', () => {
    const list = [
      task({ id: 'a', due: NOW + 3 * DAY }),
      task({ id: 'b', due: NOW + DAY }),
      task({ id: 'c', due: NOW + 2 * DAY, done: true }),
      task({ id: 'd', due: NOW - DAY }),
    ];
    expect(unfinished(list).map((t) => t.id)).toEqual(['d', 'b', 'a']);
  });

  it('keeps a blank row, because one just added is still being typed into', () => {
    const list = [task({ id: 'blank', text: '' })];
    expect(unfinished(list)).toHaveLength(1);
  });

  it('does not mutate the list it was given', () => {
    const list = [task({ id: 'a', due: NOW + 2 * DAY }), task({ id: 'b', due: NOW })];
    unfinished(list);
    expect(list.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('pendingTasks', () => {
  it('also drops the unnamed ones, which widgets and reminders should not announce', () => {
    const list = [
      task({ id: 'named', text: 'Send the invoice' }),
      task({ id: 'blank', text: '' }),
      task({ id: 'spaces', text: '   ' }),
      task({ id: 'done', text: 'Finished', done: true }),
    ];
    expect(pendingTasks(list).map((t) => t.id)).toEqual(['named']);
  });
});
