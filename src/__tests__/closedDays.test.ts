import { closuresSince, lastClosedDay, markMissed, spansBetween } from '../closedDays';
import { MonthData, emptyMonthData } from '../types';

function month(grid: MonthData['grid'], habits = ['0', '1']): MonthData {
  return { ...emptyMonthData(), habits: habits.map((id) => ({ id, name: `h${id}` })), grid };
}

describe('lastClosedDay', () => {
  it('is the day before yesterday', () => {
    expect(lastClosedDay(new Date(2026, 8, 27, 15, 0))).toEqual(new Date(2026, 8, 25));
  });

  it('crosses into last month', () => {
    expect(lastClosedDay(new Date(2026, 9, 1))).toEqual(new Date(2026, 8, 29));
  });
});

describe('spansBetween', () => {
  it('is empty when nothing new has closed', () => {
    const d = new Date(2026, 8, 25);
    expect(spansBetween(d, d)).toEqual([]);
    expect(spansBetween(new Date(2026, 8, 26), d)).toEqual([]);
  });

  it('covers the days after the first date, through the second', () => {
    expect(spansBetween(new Date(2026, 8, 20), new Date(2026, 8, 25))).toEqual([
      { year: 2026, month: 8, from: 21, to: 25 },
    ]);
  });

  it('splits by month, across New Year', () => {
    expect(spansBetween(new Date(2026, 10, 29), new Date(2027, 0, 2))).toEqual([
      { year: 2026, month: 10, from: 30, to: 30 },
      { year: 2026, month: 11, from: 1, to: 31 },
      { year: 2027, month: 0, from: 1, to: 2 },
    ]);
  });
});

describe('closuresSince', () => {
  it('closes nothing on the first run and starts counting', () => {
    expect(closuresSince(null, new Date(2026, 8, 27))).toEqual({
      spans: [],
      through: '2026-09-25',
    });
  });

  it('treats an unreadable stamp like a first run', () => {
    expect(closuresSince('garbage', new Date(2026, 8, 27)).spans).toEqual([]);
  });

  it('closes the days since the stamp', () => {
    expect(closuresSince('2026-09-25', new Date(2026, 9, 2))).toEqual({
      spans: [{ year: 2026, month: 8, from: 26, to: 30 }],
      through: '2026-09-30',
    });
  });

  it('saves nothing when no day has closed since', () => {
    expect(closuresSince('2026-09-25', new Date(2026, 8, 27, 23, 59))).toEqual({
      spans: [],
      through: null,
    });
  });

  it('does not move the stamp back when the clock does', () => {
    expect(closuresSince('2026-09-25', new Date(2026, 8, 20))).toEqual({
      spans: [],
      through: null,
    });
  });
});

describe('markMissed', () => {
  it('fills only the blank cells on the closed days', () => {
    const data = month({ '3:0': 1, '4:1': 2, '6:0': 1 });
    expect(markMissed(data, 3, 5).grid).toEqual({
      '3:0': 1,
      '3:1': 2,
      '4:0': 2,
      '4:1': 2,
      '5:0': 2,
      '5:1': 2,
      '6:0': 1,
    });
  });

  it('hands back the same month when nothing was blank', () => {
    const data = month({ '3:0': 1, '3:1': 2 });
    expect(markMissed(data, 3, 3)).toBe(data);
  });

  it('does nothing in a month with no habits', () => {
    const data = month({}, []);
    expect(markMissed(data, 1, 30)).toBe(data);
  });

  it('leaves the original untouched', () => {
    const data = month({});
    markMissed(data, 1, 2);
    expect(data.grid).toEqual({});
  });
});
