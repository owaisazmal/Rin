import { markableDays } from '../dates';

describe('markableDays', () => {
  it('opens today and yesterday in the current month', () => {
    expect(markableDays(2026, 8, new Date(2026, 8, 27, 9, 0))).toEqual([27, 26]);
  });

  it('keeps yesterday open until the very end of today', () => {
    expect(markableDays(2026, 8, new Date(2026, 8, 27, 23, 59, 59))).toEqual([27, 26]);
    expect(markableDays(2026, 8, new Date(2026, 8, 28, 0, 0, 0))).toEqual([28, 27]);
  });

  it('closes a day once the next one has passed', () => {
    expect(markableDays(2026, 8, new Date(2026, 8, 28))).not.toContain(26);
  });

  it('splits across a month border', () => {
    const now = new Date(2026, 9, 1, 8, 0);
    expect(markableDays(2026, 9, now)).toEqual([1]);
    expect(markableDays(2026, 8, now)).toEqual([30]);
  });

  it('splits across New Year', () => {
    const now = new Date(2027, 0, 1, 8, 0);
    expect(markableDays(2027, 0, now)).toEqual([1]);
    expect(markableDays(2026, 11, now)).toEqual([31]);
  });

  it('opens nothing in any other month', () => {
    const now = new Date(2026, 8, 27);
    expect(markableDays(2026, 7, now)).toEqual([]);
    expect(markableDays(2026, 9, now)).toEqual([]);
    expect(markableDays(2025, 8, now)).toEqual([]);
  });
});
