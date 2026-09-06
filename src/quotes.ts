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

/** Stable quote for a given date — changes once per day. */
export function quoteForDate(date: Date): string {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / DAY
  );
  return DISCIPLINE_QUOTES[dayOfYear % DISCIPLINE_QUOTES.length];
}
