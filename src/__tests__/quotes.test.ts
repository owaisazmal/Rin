import { DISCIPLINE_QUOTES, quoteForDate } from '../quotes';

/** The widgets' rule: 1 January is day 1, and the list wraps */
const widgetQuote = (dayOfYear: number) =>
  DISCIPLINE_QUOTES[dayOfYear % DISCIPLINE_QUOTES.length];

const MONTH_LENGTHS_2026 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

describe('quoteForDate', () => {
  // jest.config.js pins the zone; without daylight time the cases below prove nothing
  it('runs in a zone where October is in daylight time and January is not', () => {
    const offset = (month: number) => new Date(2026, month, 9).getTimezoneOffset();
    expect(offset(9)).toBeLessThan(offset(0));
  });

  it('has the new day’s quote in the first hour after midnight in daylight time', () => {
    expect(quoteForDate(new Date(2026, 9, 9, 0, 30))).toBe(widgetQuote(282));
  });

  it('has the same quote at midday in daylight time', () => {
    expect(quoteForDate(new Date(2026, 9, 9, 12, 0))).toBe(widgetQuote(282));
  });

  it('agrees with the widgets in standard time', () => {
    expect(quoteForDate(new Date(2026, 0, 15, 0, 30))).toBe(widgetQuote(15));
    expect(quoteForDate(new Date(2026, 0, 15, 12, 0))).toBe(widgetQuote(15));
    expect(quoteForDate(new Date(2026, 11, 1, 0, 30))).toBe(widgetQuote(335));
  });

  it('counts 1 January as day 1 and 31 December as the last day', () => {
    expect(quoteForDate(new Date(2026, 0, 1, 0, 0))).toBe(widgetQuote(1));
    expect(quoteForDate(new Date(2026, 11, 31, 23, 59))).toBe(widgetQuote(365));
    expect(quoteForDate(new Date(2028, 11, 31, 23, 59))).toBe(widgetQuote(366));
  });

  it('holds one quote from midnight to midnight on every day of the year', () => {
    let dayOfYear = 0;
    MONTH_LENGTHS_2026.forEach((length, month) => {
      for (let day = 1; day <= length; day++) {
        dayOfYear++;
        for (const [hour, minute] of [[0, 0], [0, 30], [12, 0], [23, 59]]) {
          const got = quoteForDate(new Date(2026, month, day, hour, minute));
          expect([month, day, hour, got]).toEqual([month, day, hour, widgetQuote(dayOfYear)]);
        }
      }
    });
  });
});
