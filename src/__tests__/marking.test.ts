import { canMark, dayWhen } from '../marking';

const TODAY = { year: 2026, month: 8, day: 28 };

describe('dayWhen', () => {
  it('places days in the same month', () => {
    expect(dayWhen(2026, 8, 27, TODAY)).toBe('past');
    expect(dayWhen(2026, 8, 28, TODAY)).toBe('today');
    expect(dayWhen(2026, 8, 29, TODAY)).toBe('future');
  });

  it('places whole months and years', () => {
    expect(dayWhen(2026, 7, 31, TODAY)).toBe('past');
    expect(dayWhen(2026, 9, 1, TODAY)).toBe('future');
    expect(dayWhen(2025, 11, 31, TODAY)).toBe('past');
    expect(dayWhen(2027, 0, 1, TODAY)).toBe('future');
  });
});

describe('canMark', () => {
  it('leaves today open whatever it holds', () => {
    expect(canMark('today', 0)).toBe(true);
    expect(canMark('today', 1)).toBe(true);
    expect(canMark('today', 2)).toBe(true);
  });

  it('fills a past blank but keeps a past mark as it was', () => {
    expect(canMark('past', 0)).toBe(true);
    expect(canMark('past', 1)).toBe(false);
    expect(canMark('past', 2)).toBe(false);
  });

  it('lets a past mark made this visit be changed', () => {
    expect(canMark('past', 1, true)).toBe(true);
    expect(canMark('past', 2, true)).toBe(true);
  });

  it('never opens a day that has not come yet', () => {
    expect(canMark('future', 0)).toBe(false);
    expect(canMark('future', 0, true)).toBe(false);
  });
});
