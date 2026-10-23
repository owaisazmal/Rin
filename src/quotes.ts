import { DAY } from './dates';

export const DISCIPLINE_QUOTES = [
  "Discipline doesn't care how you feel. Discipline is doing what needs to be done, even when you don't feel like doing it.",
  'We are what we repeatedly do. Excellence, then, is not an act, but a habit.',
  'Motivation gets you going, but discipline keeps you growing.',
  'You will never always be motivated, so you must learn to be disciplined.',
  'Small disciplines repeated with consistency every day lead to great achievements.',
  'Discipline is choosing between what you want now and what you want most.',
  'Suffer the pain of discipline or suffer the pain of regret.',
  'The successful warrior is the average man, with laser-like focus.',
  "Don't count the days. Make the days count.",
  'Success is nothing more than a few simple disciplines, practiced every day.',
  'Freedom is impossible without discipline.',
  'A river cuts through rock not because of its power, but because of its persistence.',
  'You don’t have to be extreme, just consistent.',
  'The hard days are what make you stronger.',
  'Discipline is the bridge between goals and accomplishment.',
];

export type QuoteSource = 'builtin' | 'mine' | 'both';

export interface QuotePrefs {
  source: QuoteSource;
  custom: string[];
}

/** A little over the longest built-in line, which is 120 */
export const MAX_QUOTE_LENGTH = 150;
export const MAX_CUSTOM_QUOTES = 50;

export function defaultQuotePrefs(): QuotePrefs {
  return { source: 'builtin', custom: [] };
}

const OPENERS = '"“\'‘«';
const CLOSERS = '"”\'’»';

/** One line with no wrapping quote marks, since the card and widgets add their own */
export function cleanQuote(text: string): string {
  let out = text.replace(/\s+/g, ' ').trim();
  while (out.length > 1 && OPENERS.includes(out[0]) && CLOSERS.includes(out[out.length - 1])) {
    out = out.slice(1, -1).trim();
  }
  return out.slice(0, MAX_QUOTE_LENGTH);
}

const sameQuote = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Same rule as `loadSettings`: anything unknown takes its default */
export function parseQuotePrefs(raw: unknown): QuotePrefs {
  if (!raw || typeof raw !== 'object') return defaultQuotePrefs();
  const p = raw as Partial<Record<keyof QuotePrefs, unknown>>;
  const custom: string[] = [];
  for (const q of Array.isArray(p.custom) ? p.custom : []) {
    const text = typeof q === 'string' ? cleanQuote(q) : '';
    if (text && !custom.some((c) => sameQuote(c, text))) custom.push(text);
  }
  return {
    source: p.source === 'mine' || p.source === 'both' ? p.source : 'builtin',
    custom: custom.slice(0, MAX_CUSTOM_QUOTES),
  };
}

/** Why `text` can't go in at `index` (null adds one), or null when it can */
export function quoteProblem(
  custom: string[],
  index: number | null,
  text: string
): 'empty' | 'repeat' | 'full' | null {
  const clean = cleanQuote(text);
  if (!clean) return 'empty';
  if (custom.some((q, i) => i !== index && sameQuote(q, clean))) return 'repeat';
  if (index === null && custom.length >= MAX_CUSTOM_QUOTES) return 'full';
  return null;
}

/** Sets quote `index`, or adds one when null; text with a `quoteProblem` changes nothing */
export function placeQuote(custom: string[], index: number | null, text: string): string[] {
  if (quoteProblem(custom, index, text)) return custom;
  const clean = cleanQuote(text);
  return index === null ? [...custom, clean] : custom.map((q, i) => (i === index ? clean : q));
}

/** What the card and the widgets rotate through, and where the user's own quotes begin in it */
export interface QuoteList {
  quotes: string[];
  /** the list's length when it holds none of the user's */
  ownFrom: number;
}

export const BUILT_IN_HEADING = 'DISCIPLINE.';
export const OWN_HEADING = 'YOUR WORDS.';

/** "mine" with none added falls back to the built-in list */
export function activeQuotes(prefs: QuotePrefs): QuoteList {
  const builtIn = DISCIPLINE_QUOTES.length;
  if (prefs.source === 'builtin' || prefs.custom.length === 0) {
    return { quotes: DISCIPLINE_QUOTES, ownFrom: builtIn };
  }
  return prefs.source === 'mine'
    ? { quotes: prefs.custom, ownFrom: 0 }
    : { quotes: [...DISCIPLINE_QUOTES, ...prefs.custom], ownFrom: builtIn };
}

// calendar dates, not elapsed time: a daylight-saving hour must not move the day
function dayOfYear(date: Date): number {
  const year = date.getFullYear();
  return (Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, 0, 0)) / DAY;
}

/** Stable quote for a given date — changes once per day. */
export function quoteForDate(date: Date, quotes: readonly string[] = DISCIPLINE_QUOTES): string {
  const list = quotes.length ? quotes : DISCIPLINE_QUOTES;
  return list[dayOfYear(date) % list.length];
}

/** The heading over the day's quote, so the user's own words aren't filed under discipline */
export function quoteHeading(date: Date, { quotes, ownFrom }: QuoteList): string {
  const own = quotes.length > 0 && dayOfYear(date) % quotes.length >= ownFrom;
  return own ? OWN_HEADING : BUILT_IN_HEADING;
}
