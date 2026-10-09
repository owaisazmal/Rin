import {
  BUILTIN_CARDS,
  PlannerLayout,
  addCard,
  adoptCards,
  canAddCard,
  defaultLayout,
  moveCard,
  parseLayout,
  removeCard,
  renameCard,
  toggleCard,
} from '../layout';
import { CustomCard, MAX_CARD_TITLE, MAX_CUSTOM_CARDS, isCardId } from '../types';

/** The stored-layout parser, then one function per editor action. */

const ids = (layout: PlannerLayout) => layout.slots.map((slot) => slot.id);

/** A layout with `n` custom cards after the built-in ones */
function withCards(n: number): PlannerLayout {
  let layout = defaultLayout();
  for (let i = 0; i < n; i++) layout = addCard(layout, `Card ${i}`, 'list');
  return layout;
}

const held = (id: string, title = 'Ideas'): CustomCard => ({
  id,
  title,
  kind: 'checklist',
  items: [{ text: 'one', done: false }],
});

describe('defaultLayout', () => {
  it('shows every built-in card, in the order the planner always had them', () => {
    expect(defaultLayout()).toEqual({
      slots: [
        { id: 'deadlines', shown: true },
        { id: 'goals', shown: true },
        { id: 'observations', shown: true },
        { id: 'quote', shown: true },
      ],
      removed: [],
    });
  });
});

describe('parseLayout', () => {
  it.each([undefined, null, 'cards', 7, [], { slots: 'all' }])(
    'falls back to the default for %p',
    (raw) => {
      expect(parseLayout(raw)).toEqual(defaultLayout());
    }
  );

  it('keeps a stored order and which cards are hidden', () => {
    const stored = {
      slots: [
        { id: 'quote', shown: true },
        { id: 'deadlines', shown: false },
        { id: 'observations', shown: true },
        { id: 'goals', shown: false },
      ],
      removed: [],
    };
    expect(parseLayout(stored)).toEqual(stored);
  });

  it('adds a built-in card the stored list has never heard of, shown', () => {
    const layout = parseLayout({ slots: [{ id: 'quote', shown: false }] });
    expect(ids(layout)).toEqual(['quote', 'deadlines', 'goals', 'observations']);
    expect(layout.slots[0].shown).toBe(false);
    expect(layout.slots.slice(1).every((slot) => slot.shown)).toBe(true);
  });

  it('drops what it cannot draw and keeps the first of a repeated card', () => {
    const layout = parseLayout({
      slots: [
        null,
        { id: 'weather', shown: true },
        { id: 'goals', shown: false },
        { id: 'goals', shown: true },
        { id: 'c-abcd', shown: true },
        { id: 'c-abce', shown: true, custom: { title: 7, kind: 'list' } },
        { id: 'c-abcf', shown: true, custom: { title: 'Plan', kind: 'table' } },
        { id: 'not an id', shown: true, custom: { title: 'Plan', kind: 'list' } },
      ],
    });
    expect(ids(layout)).toEqual(['goals', 'deadlines', 'observations', 'quote']);
    expect(layout.slots[0].shown).toBe(false);
  });

  it('keeps a custom card, its name cut to the length the editor allows', () => {
    const layout = parseLayout({
      slots: [{ id: 'c-abcd', shown: false, custom: { title: 'x'.repeat(60), kind: 'note' } }],
    });
    expect(layout.slots[0]).toEqual({
      id: 'c-abcd',
      shown: false,
      custom: { title: 'x'.repeat(MAX_CARD_TITLE), kind: 'note' },
    });
  });

  it(`keeps no more than ${MAX_CUSTOM_CARDS} custom cards`, () => {
    const slots = Array.from({ length: MAX_CUSTOM_CARDS + 3 }, (_, i) => ({
      id: `c-card${i}`,
      shown: true,
      custom: { title: `Card ${i}`, kind: 'list' },
    }));
    const layout = parseLayout({ slots });
    expect(layout.slots.filter((slot) => slot.custom)).toHaveLength(MAX_CUSTOM_CARDS);
  });

  it('remembers deleted cards, but not one that is back on the page', () => {
    const layout = parseLayout({
      slots: [{ id: 'c-live', shown: true, custom: { title: 'Live', kind: 'list' } }],
      removed: ['c-gone', 'c-gone', 'c-live', 'nonsense', 4],
    });
    expect(layout.removed).toEqual(['c-gone']);
  });
});

describe('toggleCard', () => {
  it('hides a card without moving it, and shows it again', () => {
    const hidden = toggleCard(defaultLayout(), 'goals');
    expect(ids(hidden)).toEqual([...BUILTIN_CARDS]);
    expect(hidden.slots.map((slot) => slot.shown)).toEqual([true, false, true, true]);
    expect(toggleCard(hidden, 'goals')).toEqual(defaultLayout());
  });
});

describe('moveCard', () => {
  it('swaps a card with its neighbour', () => {
    expect(ids(moveCard(defaultLayout(), 'quote', -1))).toEqual([
      'deadlines',
      'goals',
      'quote',
      'observations',
    ]);
    expect(ids(moveCard(defaultLayout(), 'deadlines', 1))).toEqual([
      'goals',
      'deadlines',
      'observations',
      'quote',
    ]);
  });

  it('leaves the layout alone at either end, and for a card that is not there', () => {
    const layout = defaultLayout();
    expect(moveCard(layout, 'deadlines', -1)).toBe(layout);
    expect(moveCard(layout, 'quote', 1)).toBe(layout);
    expect(moveCard(layout, 'c-nope', 1)).toBe(layout);
  });
});

describe('addCard', () => {
  it('puts a new card at the bottom, shown, under an id of its own', () => {
    const layout = addCard(defaultLayout(), '  Ideas  ', 'checklist');
    const added = layout.slots[layout.slots.length - 1];
    expect(added).toMatchObject({ shown: true, custom: { title: 'Ideas', kind: 'checklist' } });
    expect(isCardId(added.id)).toBe(true);
  });

  it('never hands out an id twice', () => {
    const made = withCards(MAX_CUSTOM_CARDS).slots.filter((slot) => slot.custom);
    expect(new Set(made.map((slot) => slot.id)).size).toBe(MAX_CUSTOM_CARDS);
  });

  it('declines a blank name', () => {
    const layout = defaultLayout();
    expect(addCard(layout, '   ', 'note')).toBe(layout);
  });

  it(`declines once there are ${MAX_CUSTOM_CARDS}`, () => {
    const full = withCards(MAX_CUSTOM_CARDS);
    expect(canAddCard(full)).toBe(false);
    expect(addCard(full, 'One more', 'list')).toBe(full);
  });
});

describe('renameCard', () => {
  it('renames a custom card and leaves the built-in ones alone', () => {
    const layout = withCards(1);
    const id = layout.slots[layout.slots.length - 1].id;
    expect(renameCard(layout, id, 'Reading').slots.at(-1)?.custom?.title).toBe('Reading');
    expect(renameCard(layout, 'goals', 'Aims')).toEqual(layout);
  });
});

describe('removeCard', () => {
  it('deletes a custom card and remembers that it did', () => {
    const layout = withCards(1);
    const id = layout.slots[layout.slots.length - 1].id;
    expect(removeCard(layout, id)).toEqual({ slots: defaultLayout().slots, removed: [id] });
  });

  it('will not delete a built-in card', () => {
    const layout = defaultLayout();
    expect(removeCard(layout, 'observations')).toBe(layout);
  });
});

describe('adoptCards', () => {
  it('takes in a card a month holds that the layout has never seen', () => {
    const layout = adoptCards(defaultLayout(), [held('c-fromold', 'Ideas')]);
    expect(layout.slots.at(-1)).toEqual({
      id: 'c-fromold',
      shown: true,
      custom: { title: 'Ideas', kind: 'checklist' },
    });
  });

  it('hands back the same layout when every card is already known', () => {
    const layout = adoptCards(defaultLayout(), [held('c-fromold')]);
    expect(adoptCards(layout, [held('c-fromold', 'Renamed since')])).toBe(layout);
    expect(adoptCards(layout, [])).toBe(layout);
  });

  it('does not bring back a card this phone deleted', () => {
    const deleted = removeCard(adoptCards(defaultLayout(), [held('c-fromold')]), 'c-fromold');
    expect(adoptCards(deleted, [held('c-fromold')])).toBe(deleted);
  });

  it('takes in only as many as there is room for', () => {
    const nearlyFull = withCards(MAX_CUSTOM_CARDS - 1);
    const layout = adoptCards(nearlyFull, [held('c-first'), held('c-second')]);
    expect(layout.slots.filter((slot) => slot.custom)).toHaveLength(MAX_CUSTOM_CARDS);
    expect(ids(layout)).toContain('c-first');
    expect(ids(layout)).not.toContain('c-second');
  });
});
