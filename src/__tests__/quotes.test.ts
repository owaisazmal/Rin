import {
  DISCIPLINE_QUOTES,
  MAX_CUSTOM_QUOTES,
  MAX_QUOTE_LENGTH,
  BUILT_IN_HEADING,
  OWN_HEADING,
  QuotePrefs,
  activeQuotes,
  cleanQuote,
  defaultQuotePrefs,
  parseQuotePrefs,
  placeQuote,
  quoteForDate,
  quoteHeading,
  quoteProblem,
} from '../quotes';
import { buildSnapshot } from '../widgets/snapshot';
import { emptyMonthData } from '../types';

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

const MINE = ['First of mine.', 'Second of mine.', 'Third of mine.'];
const prefs = (source: QuotePrefs['source'], custom: string[]): QuotePrefs => ({ source, custom });

/** Every day of 2026, at a few times each */
function* daysOf2026() {
  let dayOfYear = 0;
  for (const [month, length] of MONTH_LENGTHS_2026.entries()) {
    for (let day = 1; day <= length; day++) {
      dayOfYear++;
      for (const [hour, minute] of [[0, 0], [12, 0], [23, 59]]) {
        yield { dayOfYear, date: new Date(2026, month, day, hour, minute) };
      }
    }
  }
}

describe('activeQuotes', () => {
  it('is the built-in list when nothing has been added, whatever the source', () => {
    const builtIn = { quotes: DISCIPLINE_QUOTES, ownFrom: DISCIPLINE_QUOTES.length };
    expect(activeQuotes(defaultQuotePrefs())).toEqual(builtIn);
    expect(activeQuotes(prefs('mine', []))).toEqual(builtIn);
    expect(activeQuotes(prefs('both', []))).toEqual(builtIn);
    expect(activeQuotes(defaultQuotePrefs()).quotes).toBe(DISCIPLINE_QUOTES);
  });

  it('follows the source once there are quotes of your own', () => {
    expect(activeQuotes(prefs('builtin', MINE)).quotes).toBe(DISCIPLINE_QUOTES);
    expect(activeQuotes(prefs('mine', MINE))).toEqual({ quotes: MINE, ownFrom: 0 });
    expect(activeQuotes(prefs('both', MINE))).toEqual({
      quotes: [...DISCIPLINE_QUOTES, ...MINE],
      ownFrom: DISCIPLINE_QUOTES.length,
    });
  });
});

describe('quoteForDate with a list', () => {
  it('gives today’s quote unchanged with no custom quotes', () => {
    for (const { date } of daysOf2026()) {
      expect(quoteForDate(date, activeQuotes(defaultQuotePrefs()).quotes)).toBe(quoteForDate(date));
    }
  });

  it('uses the built-in list when handed an empty one', () => {
    const date = new Date(2026, 9, 9, 12, 0);
    expect(quoteForDate(date, [])).toBe(quoteForDate(date));
  });

  it('holds one of your quotes from midnight to midnight, by the widgets’ rule', () => {
    for (const { dayOfYear, date } of daysOf2026()) {
      expect(quoteForDate(date, MINE)).toBe(MINE[dayOfYear % MINE.length]);
    }
  });

  it('lands on the same quote as the widget, which picks from the snapshot', () => {
    for (const quotes of [defaultQuotePrefs(), prefs('mine', []), prefs('mine', MINE), prefs('both', MINE)]) {
      const list = activeQuotes(quotes);
      const snap = buildSnapshot(2026, 9, emptyMonthData(), [], new Date(2026, 9, 9), 'dark', [], list);
      for (const { dayOfYear, date } of daysOf2026()) {
        const i = dayOfYear % snap.quotes.length;
        expect(snap.quotes[i]).toBe(quoteForDate(date, list.quotes));
        expect(i >= snap.ownQuotesFrom ? OWN_HEADING : BUILT_IN_HEADING).toBe(quoteHeading(date, list));
      }
    }
  });
});

describe('quoteHeading', () => {
  it('stays on discipline with no quotes of your own', () => {
    for (const { date } of daysOf2026()) {
      expect(quoteHeading(date, activeQuotes(defaultQuotePrefs()))).toBe(BUILT_IN_HEADING);
      expect(quoteHeading(date, activeQuotes(prefs('mine', [])))).toBe(BUILT_IN_HEADING);
      expect(quoteHeading(date, activeQuotes(prefs('builtin', MINE)))).toBe(BUILT_IN_HEADING);
    }
  });

  it('names your own words, and only those, whatever the source', () => {
    const both = activeQuotes(prefs('both', MINE));
    for (const { date } of daysOf2026()) {
      expect(quoteHeading(date, activeQuotes(prefs('mine', MINE)))).toBe(OWN_HEADING);
      const own = MINE.includes(quoteForDate(date, both.quotes));
      expect(quoteHeading(date, both)).toBe(own ? OWN_HEADING : BUILT_IN_HEADING);
    }
  });
});

describe('cleanQuote', () => {
  it('keeps one line with single spaces', () => {
    expect(cleanQuote('  Keep\n\n going,   always.  ')).toBe('Keep going, always.');
  });

  it('drops wrapping quote marks, which the card adds itself', () => {
    expect(cleanQuote('“Keep going.”')).toBe('Keep going.');
    expect(cleanQuote('"\'Nested.\'"')).toBe('Nested.');
    expect(cleanQuote("Don't stop")).toBe("Don't stop");
    expect(cleanQuote('“”')).toBe('');
  });

  it('cuts at the length limit', () => {
    expect(cleanQuote('a'.repeat(MAX_QUOTE_LENGTH + 20))).toHaveLength(MAX_QUOTE_LENGTH);
  });
});

describe('parseQuotePrefs', () => {
  it('falls back one field at a time', () => {
    expect(parseQuotePrefs(null)).toEqual(defaultQuotePrefs());
    expect(parseQuotePrefs({ source: 'theirs', custom: 'x' })).toEqual(defaultQuotePrefs());
    expect(parseQuotePrefs({ source: 'both' })).toEqual({ source: 'both', custom: [] });
  });

  it('drops blanks, non-text and repeats, and keeps the cap', () => {
    expect(parseQuotePrefs({ custom: ['One.', ' ', 7, 'one.', '“Two.”'] }).custom).toEqual([
      'One.',
      'Two.',
    ]);
    const many = Array.from({ length: MAX_CUSTOM_QUOTES + 5 }, (_, i) => `Quote ${i}`);
    expect(parseQuotePrefs({ custom: many }).custom).toHaveLength(MAX_CUSTOM_QUOTES);
  });
});

describe('placeQuote', () => {
  it('adds to the end and rewrites in place', () => {
    expect(placeQuote(MINE, null, ' Fourth. ')).toEqual([...MINE, 'Fourth.']);
    expect(placeQuote(MINE, 1, 'New second.')).toEqual([MINE[0], 'New second.', MINE[2]]);
  });

  it('refuses blanks and repeats, but lets a quote be saved as itself', () => {
    expect(quoteProblem(MINE, null, '  ')).toBe('empty');
    expect(quoteProblem(MINE, null, 'first OF mine.')).toBe('repeat');
    expect(quoteProblem(MINE, 2, MINE[0])).toBe('repeat');
    expect(quoteProblem(MINE, 0, MINE[0])).toBeNull();
    expect(placeQuote(MINE, null, MINE[1])).toBe(MINE);
  });

  it('stops adding at the cap, and still allows edits there', () => {
    const full = Array.from({ length: MAX_CUSTOM_QUOTES }, (_, i) => `Quote ${i}`);
    expect(quoteProblem(full, null, 'One more')).toBe('full');
    expect(placeQuote(full, null, 'One more')).toBe(full);
    expect(placeQuote(full, 0, 'Changed')[0]).toBe('Changed');
  });
});
