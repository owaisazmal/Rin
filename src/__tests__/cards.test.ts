import { MAX_MONTH_CT, ciphertextChars } from '../backup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dropCardFromMonths, parseMonthData, vouchMonthValue } from '../storage';
import {
  MAX_CARD_ITEMS,
  MAX_CARD_ITEM_LEN,
  MAX_CARD_TITLE,
  MAX_CUSTOM_CARDS,
  MAX_GOAL_LEN,
  MAX_HABITS,
  MAX_HABIT_NAME,
  MAX_MONTH_CARDS,
  MAX_OBSERVATIONS,
  MAX_OBSERVATION_LEN,
  MonthData,
  cardHasContent,
  cardItemsIn,
  emptyMonthData,
} from '../types';

/** Custom cards live in the month record, so the parser and the voucher both cover them. */

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), multiGet: jest.fn(), getAllKeys: jest.fn() },
}));

// `backup.ts` is here for its size arithmetic alone; nothing below seals anything
jest.mock('expo-crypto', () => ({ __esModule: true, getRandomBytes: jest.fn() }));

const ideas = {
  id: 'c-ideas',
  title: 'Ideas',
  kind: 'checklist',
  items: [
    { text: 'Ship it', done: true },
    { text: '', done: false },
  ],
};

describe('parseMonthData, on cards', () => {
  it('passes a well-formed card through untouched', () => {
    expect(parseMonthData({ cards: [ideas] }).cards).toEqual([ideas]);
  });

  it('leaves the key off a month that has none, so old months read back unchanged', () => {
    const month = { ...emptyMonthData(), habits: [{ id: '0', name: 'Run' }] };
    expect(JSON.stringify(parseMonthData(month))).toBe(JSON.stringify(month));
    expect('cards' in parseMonthData({ ...month, cards: [] })).toBe(false);
    expect('cards' in parseMonthData({ ...month, cards: 'none' })).toBe(false);
  });

  it('drops a card missing any part of what makes it one', () => {
    const month = parseMonthData({
      cards: [
        null,
        { ...ideas, id: 'ideas' },
        { ...ideas, id: 'c-notitle', title: 7 },
        { ...ideas, id: 'c-nokind', kind: 'table' },
        { ...ideas, id: 'c-noitems', items: 'none' },
        ideas,
      ],
    });
    expect(month.cards).toEqual([ideas]);
  });

  it('keeps the first of two cards sharing an id', () => {
    const month = parseMonthData({ cards: [ideas, { ...ideas, title: 'Second' }] });
    expect(month.cards).toEqual([ideas]);
  });

  it('drops a line that is not one, and strips unknown fields from the rest', () => {
    const month = parseMonthData({
      cards: [
        {
          ...ideas,
          colour: 'red',
          items: [{ text: 'kept', done: false, pinned: true }, 'loose', { text: 3, done: false }],
        },
      ],
    });
    expect(month.cards).toEqual([{ ...ideas, items: [{ text: 'kept', done: false }] }]);
  });

  it(`holds no more than ${MAX_MONTH_CARDS} cards`, () => {
    const cards = Array.from({ length: MAX_MONTH_CARDS + 2 }, (_, i) => ({
      ...ideas,
      id: `c-card${i}`,
    }));
    expect(parseMonthData({ cards }).cards).toHaveLength(MAX_MONTH_CARDS);
  });
});

describe('vouchMonthValue, on cards', () => {
  it('vouches for a month whose cards parsed whole', () => {
    expect(vouchMonthValue({ cards: [ideas] })).toMatchObject({ status: 'complete' });
  });

  it('vouches for an empty list of cards', () => {
    expect(vouchMonthValue({ cards: [] })).toEqual({
      status: 'complete',
      data: emptyMonthData(),
    });
  });

  it('says unreadable when the cards are not a list', () => {
    expect(vouchMonthValue({ cards: { 'c-ideas': ideas } })).toEqual({ status: 'unreadable' });
  });

  it('reports a card the parser could not keep', () => {
    expect(vouchMonthValue({ cards: [ideas, { ...ideas, id: 'c-other', kind: 'table' }] })).toMatchObject(
      { status: 'partial', lost: '1 of 2 cards' }
    );
  });

  it('reports the loser of two cards sharing an id', () => {
    expect(vouchMonthValue({ cards: [ideas, ideas] })).toMatchObject({
      status: 'partial',
      lost: '1 of 2 cards',
    });
  });

  it('reports lines lost from a card that itself survived', () => {
    const torn = { ...ideas, items: [...ideas.items, { text: 'no tick' }, null] };
    expect(vouchMonthValue({ cards: [torn] })).toMatchObject({
      status: 'partial',
      lost: '2 of 4 card lines',
    });
  });

  it('names the cards beside every other section that lost something', () => {
    expect(
      vouchMonthValue({
        observations: ['ok', 7],
        cards: [{ ...ideas, items: [{ text: 'kept', done: false }, 'loose'] }, 'not a card'],
      })
    ).toMatchObject({ status: 'partial', lost: '1 of 2 notes, 1 of 2 cards, 1 of 2 card lines' });
  });
});

describe('what a card shows', () => {
  it('starts a note as one blank block and the others as three blank lines', () => {
    const month = emptyMonthData();
    expect(cardItemsIn(month, 'c-new', 'note')).toHaveLength(1);
    expect(cardItemsIn(month, 'c-new', 'list')).toHaveLength(3);
    expect(cardItemsIn(month, 'c-new', 'checklist')).toHaveLength(3);
  });

  it('shows what the month holds once there is something', () => {
    const month = parseMonthData({ cards: [ideas] });
    expect(cardItemsIn(month, 'c-ideas', 'checklist')).toEqual(ideas.items);
  });

  it('counts a tick as content, and blank lines as none', () => {
    expect(cardHasContent(cardItemsIn(emptyMonthData(), 'c-new', 'list'))).toBe(false);
    expect(cardHasContent([{ text: '  ', done: false }])).toBe(false);
    expect(cardHasContent([{ text: '', done: true }])).toBe(true);
    expect(cardHasContent([{ text: 'x', done: false }])).toBe(true);
  });
});

describe('the size of a month with every card full', () => {
  /** Every field at its limit, in three-byte characters. */
  it('still fits under the cap the server enforces', () => {
    const wide = (n: number) => 'あ'.repeat(n);
    const habits = Array.from({ length: MAX_HABITS }, (_, i) => ({
      id: String(i),
      name: wide(MAX_HABIT_NAME),
    }));
    const grid: MonthData['grid'] = {};
    for (let day = 1; day <= 31; day++) {
      for (const habit of habits) grid[`${day}:${habit.id}`] = 2;
    }
    const month: MonthData = {
      habits,
      grid,
      observations: Array.from({ length: MAX_OBSERVATIONS }, () => wide(MAX_OBSERVATION_LEN)),
      keyGoals: Array.from({ length: 3 }, () => ({ text: wide(MAX_GOAL_LEN), done: true })),
      cards: Array.from({ length: MAX_CUSTOM_CARDS }, (_, i) => ({
        id: `c-${'z'.repeat(19)}${i}`,
        title: wide(MAX_CARD_TITLE),
        kind: 'checklist' as const,
        items: Array.from({ length: MAX_CARD_ITEMS }, () => ({
          text: wide(MAX_CARD_ITEM_LEN),
          done: false,
        })),
      })),
    };
    // the parser keeps all of it, so this is the record the backup would send
    expect(vouchMonthValue(month)).toMatchObject({ status: 'complete' });
    expect(ciphertextChars(JSON.stringify(parseMonthData(month)))).toBeLessThan(MAX_MONTH_CT);
  });
});

describe('dropCardFromMonths', () => {
  const store = new Map<string, string>();
  const notes = { id: 'c-notes', title: 'Notes', kind: 'note', items: [{ text: 'keep', done: false }] };
  const put = (key: string, month: unknown) =>
    store.set(`@monthly-planning/${key}`, JSON.stringify(month));
  const cardsIn = (key: string) => JSON.parse(store.get(`@monthly-planning/${key}`)!).cards;

  beforeEach(() => {
    store.clear();
    jest.mocked(AsyncStorage.getAllKeys).mockImplementation(async () => [...store.keys()]);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => store.get(key) ?? null);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      store.set(key, value);
    });
  });

  it('takes the card out of the other months and says which it rewrote', async () => {
    put('2026-07', { ...emptyMonthData(), cards: [ideas, notes] });
    put('2026-08', { ...emptyMonthData(), cards: [ideas] });
    put('2026-09', { ...emptyMonthData(), cards: [notes] });
    put('2026-10', { ...emptyMonthData(), cards: [ideas] });

    const changed = await dropCardFromMonths('c-ideas', { year: 2026, month: 9 });

    expect(changed).toEqual([
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
    ]);
    expect(cardsIn('2026-07')).toEqual([notes]);
    // the key goes with the last card, so the month reads as it did before cards
    expect(cardsIn('2026-08')).toBeUndefined();
    expect(cardsIn('2026-09')).toEqual([notes]);
    // the open month belongs to the screen
    expect(cardsIn('2026-10')).toEqual([ideas]);
  });

  it('leaves a month it cannot read in full alone', async () => {
    const damaged = { ...emptyMonthData(), cards: [ideas, { id: 'nope' }] };
    put('2026-08', damaged);

    expect(await dropCardFromMonths('c-ideas', { year: 2026, month: 9 })).toEqual([]);
    expect(JSON.parse(store.get('@monthly-planning/2026-08')!)).toEqual(damaged);
  });
});
