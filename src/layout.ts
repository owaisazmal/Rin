import {
  CardKind,
  CustomCard,
  MAX_CARD_TITLE,
  MAX_CUSTOM_CARDS,
  isCardId,
  isCardKind,
} from './types';

/**
 * Which cards sit below the daily check, and in what order. Pure, so it can be
 * tested without storage or rendering.
 */

/** The cards the app ships with, in the order a new install shows them */
export const BUILTIN_CARDS = ['deadlines', 'goals', 'observations', 'quote'] as const;
export type BuiltinCardId = (typeof BUILTIN_CARDS)[number];

/** What the editor calls each built-in card; the cards title themselves */
export const BUILTIN_TITLES: Record<BuiltinCardId, string> = {
  deadlines: 'Deadlines',
  goals: 'Key goals',
  observations: 'Observations',
  quote: 'Daily quote',
};

export interface CardSlot {
  id: string;
  shown: boolean;
  /** only on a card somebody made; the built-in ones are named by the app */
  custom?: { title: string; kind: CardKind };
}

export interface PlannerLayout {
  /** every card, top to bottom, hidden ones included so they keep their place */
  slots: CardSlot[];
  /** Deleted custom card ids, so `adoptCards` does not bring them back. */
  removed: string[];
}

/** Enough to outlast any plausible run of deletions; the oldest go first */
const MAX_REMOVED = 48;

export function isBuiltinCard(id: string): id is BuiltinCardId {
  return (BUILTIN_CARDS as readonly string[]).includes(id);
}

export function defaultLayout(): PlannerLayout {
  return { slots: BUILTIN_CARDS.map((id) => ({ id, shown: true })), removed: [] };
}

export function customCount(layout: PlannerLayout): number {
  return layout.slots.filter((slot) => slot.custom).length;
}

/** Whether there is room for one more custom card */
export function canAddCard(layout: PlannerLayout): boolean {
  return customCount(layout) < MAX_CUSTOM_CARDS;
}

/** Coerces a stored layout: unknown cards are dropped, missing built-ins are added as shown. */
export function parseLayout(raw: unknown): PlannerLayout {
  const stored = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const slots: CardSlot[] = [];
  const seen = new Set<string>();
  let custom = 0;

  for (const entry of Array.isArray(stored.slots) ? stored.slots : []) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, shown, custom: made } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || seen.has(id)) continue;

    if (isBuiltinCard(id)) {
      seen.add(id);
      slots.push({ id, shown: shown !== false });
      continue;
    }

    if (!isCardId(id) || !made || typeof made !== 'object' || custom >= MAX_CUSTOM_CARDS) {
      continue;
    }
    const { title, kind } = made as Record<string, unknown>;
    if (typeof title !== 'string' || !isCardKind(kind)) continue;
    seen.add(id);
    custom++;
    slots.push({
      id,
      shown: shown !== false,
      custom: { title: title.slice(0, MAX_CARD_TITLE), kind },
    });
  }

  for (const id of BUILTIN_CARDS) {
    if (!seen.has(id)) slots.push({ id, shown: true });
  }

  const removed = (Array.isArray(stored.removed) ? stored.removed : [])
    .filter((id): id is string => isCardId(id) && !seen.has(id))
    .slice(-MAX_REMOVED);

  return { slots, removed: [...new Set(removed)] };
}

/** Show a hidden card, or hide a shown one. It keeps its place either way. */
export function toggleCard(layout: PlannerLayout, id: string): PlannerLayout {
  return {
    ...layout,
    slots: layout.slots.map((slot) => (slot.id === id ? { ...slot, shown: !slot.shown } : slot)),
  };
}

/** Move a card one place up (`-1`) or down (`1`); at either end it stays put */
export function moveCard(layout: PlannerLayout, id: string, by: -1 | 1): PlannerLayout {
  const from = layout.slots.findIndex((slot) => slot.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= layout.slots.length) return layout;
  const slots = [...layout.slots];
  [slots[from], slots[to]] = [slots[to], slots[from]];
  return { ...layout, slots };
}

/** Random rather than counted, so a restored phone cannot reuse an old id. */
function newCardId(layout: PlannerLayout): string {
  const taken = new Set([...layout.slots.map((slot) => slot.id), ...layout.removed]);
  for (;;) {
    const id = `c-${Date.now().toString(36)}${Math.floor(Math.random() * 46656)
      .toString(36)
      .padStart(3, '0')}`;
    if (!taken.has(id)) return id;
  }
}

/** Appends a custom card. Hands back the same layout for a blank name or at the limit. */
export function addCard(layout: PlannerLayout, title: string, kind: CardKind): PlannerLayout {
  const name = title.trim().slice(0, MAX_CARD_TITLE);
  if (!name || !canAddCard(layout)) return layout;
  return {
    ...layout,
    slots: [...layout.slots, { id: newCardId(layout), shown: true, custom: { title: name, kind } }],
  };
}

/** Renames a custom card. The built-in ones have no name to change. */
export function renameCard(layout: PlannerLayout, id: string, title: string): PlannerLayout {
  return {
    ...layout,
    slots: layout.slots.map((slot) =>
      slot.id === id && slot.custom
        ? { ...slot, custom: { ...slot.custom, title: title.slice(0, MAX_CARD_TITLE) } }
        : slot
    ),
  };
}

/** Deletes a custom card and records its id. Built-in cards can only be hidden. */
export function removeCard(layout: PlannerLayout, id: string): PlannerLayout {
  if (!layout.slots.some((slot) => slot.id === id && slot.custom)) return layout;
  return {
    slots: layout.slots.filter((slot) => slot.id !== id),
    removed: [...layout.removed, id].slice(-MAX_REMOVED),
  };
}

/**
 * Adds cards a month holds that the layout does not know, skipping deleted ones.
 * The layout is not in the backup, so this is how cards return after a restore.
 */
export function adoptCards(layout: PlannerLayout, held: readonly CustomCard[]): PlannerLayout {
  const known = new Set([...layout.slots.map((slot) => slot.id), ...layout.removed]);
  const slots = [...layout.slots];
  let room = MAX_CUSTOM_CARDS - customCount(layout);
  for (const card of held) {
    if (room <= 0) break;
    if (known.has(card.id) || !isCardId(card.id)) continue;
    known.add(card.id);
    room--;
    slots.push({
      id: card.id,
      shown: true,
      custom: { title: card.title.slice(0, MAX_CARD_TITLE), kind: card.kind },
    });
  }
  return slots.length === layout.slots.length ? layout : { ...layout, slots };
}
