/** 0 = empty, 1 = done (green), 2 = missed (red) */
export type CellState = 0 | 1 | 2;

export interface Habit {
  /** Stable id — grid keys reference this, so renames/reorders/removals never shift data */
  id: string;
  name: string;
}

export interface KeyGoal {
  text: string;
  done: boolean;
}

/** What a custom card holds: free text, plain lines, or lines that can be ticked. */
export type CardKind = 'note' | 'list' | 'checklist';

export const CARD_KINDS: readonly CardKind[] = ['note', 'list', 'checklist'];

/** One line of a custom card. A note is a single item; only a checklist reads `done`. */
export interface CardItem {
  text: string;
  done: boolean;
}

/**
 * A custom card as a month stores it. Title and kind are kept so a restored
 * month can rebuild its own cards.
 */
export interface CustomCard {
  /** matches the layout's id for the card, so a rename never detaches its lines */
  id: string;
  title: string;
  kind: CardKind;
  items: CardItem[];
}

/** Enough of a card to file lines under it: which one, and what to call it */
export type CardRef = Pick<CustomCard, 'id' | 'title' | 'kind'>;

export interface MonthData {
  habits: Habit[];
  /** every habit was removed on purpose, so none are carried in from an earlier month */
  habitsCleared?: true;
  /** key: `${day}:${habitId}` */
  grid: Record<string, CellState>;
  observations: string[];
  keyGoals: KeyGoal[];
  /** Absent rather than empty when there are none, so older months serialize unchanged. */
  cards?: CustomCard[];
}

/**
 * How much text a field will take from here on.
 *
 * A month's ciphertext has a ceiling in the security rules, but these numbers
 * are not that ceiling divided up: a full month of ordinary use sits at a few
 * percent of it, and each limit below is simply the most anyone plausibly
 * wants to type into that particular field. The rule is the backstop for a
 * record that somehow arrives oversized — a paste of a whole document into a
 * multiline box is the obvious way — not the budget these are spent against.
 *
 * They apply to new typing only. Anything already saved, including values
 * written before these existed, is left exactly as it is.
 *
 * Every field that uses one sets it twice, as a `maxLength` prop and as a
 * slice inside `onChangeText`. The prop is what stops the keyboard and shows
 * the user where the end is; the slice is what actually holds, because
 * `maxLength` on a multiline input is not honoured by every Android IME.
 */
export const MAX_HABITS = 10;
export const MAX_HABIT_NAME = 24;
export const MAX_OBSERVATION_LEN = 280;
export const MAX_OBSERVATIONS = 12;
export const MAX_GOAL_LEN = 120;
/** Sized so a month with every card full still fits under the backup cap. */
export const MAX_CUSTOM_CARDS = 4;
export const MAX_CARD_TITLE = 24;
export const MAX_CARD_ITEMS = 12;
export const MAX_CARD_ITEM_LEN = 160;
export const MAX_CARD_NOTE_LEN = 1000;
/** A month can hold leftovers of deleted cards, so its cap is above the live one. */
export const MAX_MONTH_CARDS = 12;

/** The shape every custom card id has; the parsers hold stored ids to it */
const CARD_ID = /^c-[0-9a-z]{4,20}$/;

export function isCardId(id: unknown): id is string {
  return typeof id === 'string' && CARD_ID.test(id);
}

export function isCardKind(kind: unknown): kind is CardKind {
  return CARD_KINDS.includes(kind as CardKind);
}

/** What a card shows in a month that has nothing filed under it yet */
export function emptyCardItems(kind: CardKind): CardItem[] {
  const blank = (): CardItem => ({ text: '', done: false });
  return kind === 'note' ? [blank()] : [blank(), blank(), blank()];
}

/** The lines a month holds for one card, or the blank ones it starts with */
export function cardItemsIn(data: MonthData, id: string, kind: CardKind): CardItem[] {
  return data.cards?.find((c) => c.id === id)?.items ?? emptyCardItems(kind);
}

/** Whether a card holds anything somebody would miss */
export function cardHasContent(items: readonly CardItem[]): boolean {
  return items.some((item) => item.text.trim() !== '' || item.done);
}

export function emptyMonthData(): MonthData {
  return {
    habits: [],
    grid: {},
    observations: ['', '', '', ''],
    keyGoals: [
      { text: '', done: false },
      { text: '', done: false },
      { text: '', done: false },
    ],
  };
}

export function cellKey(day: number, habitId: string): string {
  return `${day}:${habitId}`;
}

export function nextHabitId(habits: Habit[]): string {
  const max = habits.reduce((m, h) => {
    const n = parseInt(h.id, 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, -1);
  return String(max + 1);
}

/** Per-day tally across all habits */
export function dayTally(
  grid: Record<string, CellState>,
  habits: Habit[],
  day: number
): { done: number; missed: number } {
  let done = 0;
  let missed = 0;
  for (const h of habits) {
    const s = grid[cellKey(day, h.id)] ?? 0;
    if (s === 1) done++;
    else if (s === 2) missed++;
  }
  return { done, missed };
}
