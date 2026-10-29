import AsyncStorage from '@react-native-async-storage/async-storage';
import { monthDocKey } from './dates';
import {
  CardItem,
  CellState,
  CustomCard,
  Habit,
  KeyGoal,
  MAX_HABITS,
  MAX_MONTH_CARDS,
  MonthData,
  cellKey,
  emptyMonthData,
  isCardId,
  isCardKind,
  isRecord,
} from './types';

export function monthKey(year: number, month: number): string {
  return `@monthly-planning/${monthDocKey(year, month)}`;
}

/** The JSON stored under `key`, or undefined when there is none, it won't parse or the store fails */
export async function readJson(key: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort write; nothing is actionable on failure */
export async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignored on purpose
  }
}

/** Several records in one store call, which throws rather than swallowing a failure */
export async function writeMany(entries: [string, unknown][]): Promise<void> {
  await AsyncStorage.multiSet(entries.map(([key, value]) => [key, JSON.stringify(value)]));
}

// Months also arrive from the server, so every field is type-checked and anything malformed is dropped.

/** The v1 shape: a fixed 8-slot array of names, where slot i became habit id String(i) */
function isV1HabitArray(raw: unknown[]): raw is string[] {
  return raw.every((h) => typeof h === 'string');
}

function parseHabits(raw: unknown): Habit[] {
  if (!Array.isArray(raw)) return [];
  const habits: Habit[] = isV1HabitArray(raw)
    ? raw.map((name, i) => ({ id: String(i), name })).filter((h) => h.name.trim() !== '')
    : raw
        .filter((h): h is Habit => !!h && typeof h.id === 'string' && typeof h.name === 'string')
        .map((h) => ({ id: h.id, name: h.name }));

  // a repeated id keeps the first; the cap is the one the UI enforces
  const seen = new Set<string>();
  const unique: Habit[] = [];
  for (const h of habits) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    unique.push(h);
    if (unique.length === MAX_HABITS) break;
  }
  return unique;
}

/** A stored `${day}:${habitId}` split in two, or null when it isn't one or names an impossible day */
function splitCellKey(key: string): { day: number; id: string } | null {
  const sep = key.indexOf(':');
  if (sep <= 0) return null;
  const day = Number(key.slice(0, sep));
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return { day, id: key.slice(sep + 1) };
}

/** Real marks on known habits only; keys are rebuilt, so `01:0` and `1:0` can't coexist */
function parseGrid(raw: unknown, habits: Habit[]): Record<string, CellState> {
  const grid: Record<string, CellState> = {};
  if (!isRecord(raw)) return grid;
  const ids = new Set(habits.map((h) => h.id));
  for (const [key, state] of Object.entries(raw)) {
    if (state !== 1 && state !== 2) continue;
    const cell = splitCellKey(key);
    if (!cell || !ids.has(cell.id)) continue;
    grid[cellKey(cell.day, cell.id)] = state;
  }
  return grid;
}

function parseObservations(raw: unknown): string[] {
  const lines = Array.isArray(raw) ? raw.filter((o): o is string => typeof o === 'string') : [];
  return lines.length ? lines : emptyMonthData().observations;
}

/** Always exactly three, each slot coerced on its own */
function parseKeyGoals(raw: unknown): KeyGoal[] {
  const base = emptyMonthData().keyGoals;
  if (!Array.isArray(raw)) return base;
  return base.map((empty, i) => {
    const g: unknown = raw[i];
    if (!isRecord(g)) return empty;
    return { text: typeof g.text === 'string' ? g.text : '', done: g.done === true };
  });
}

/** Both halves intact; a key goal has the same shape */
function isCardItem(item: unknown): item is CardItem {
  return isRecord(item) && typeof item.text === 'string' && typeof item.done === 'boolean';
}

type CardShell = Omit<CustomCard, 'items'> & { items: unknown[] };

function isCardShell(card: unknown): card is CardShell {
  return (
    isRecord(card) &&
    isCardId(card.id) &&
    typeof card.title === 'string' &&
    isCardKind(card.kind) &&
    Array.isArray(card.items)
  );
}

/** Malformed cards are dropped whole; a repeated id keeps the first. */
function parseCards(raw: unknown): CustomCard[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const cards: CustomCard[] = [];
  for (const card of raw) {
    if (!isCardShell(card) || seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push({
      id: card.id,
      title: card.title,
      kind: card.kind,
      items: card.items.filter(isCardItem).map(({ text, done }) => ({ text, done })),
    });
    if (cards.length === MAX_MONTH_CARDS) break;
  }
  return cards;
}

export function parseMonthData(raw: unknown): MonthData {
  if (!isRecord(raw)) return emptyMonthData();
  const habits = parseHabits(raw.habits);
  const cards = parseCards(raw.cards);
  return {
    habits,
    ...(raw.habitsCleared === true && habits.length === 0 ? { habitsCleared: true as const } : {}),
    grid: parseGrid(raw.grid, habits),
    observations: parseObservations(raw.observations),
    keyGoals: parseKeyGoals(raw.keyGoals),
    // last, and only when there are some: see the note on `MonthData.cards`
    ...(cards.length ? { cards } : {}),
  };
}

/** A stored month's JSON, or an empty month if there isn't one or it won't parse */
function decodeMonth(raw: string | null | undefined): MonthData {
  try {
    return parseMonthData(raw ? JSON.parse(raw) : undefined);
  } catch {
    return emptyMonthData();
  }
}

/** The lossy read a screen draws from: whatever survived the parser */
export async function loadMonth(year: number, month: number): Promise<MonthData> {
  return parseMonthData(await readJson(monthKey(year, month)));
}

/** What a parse can vouch for; only `complete` may ever be written over another copy of a record */
export type VouchedValue<T> =
  | { status: 'complete'; data: T }
  /** it parsed, but the parser discarded something; `lost` names what, briefly */
  | { status: 'partial'; data: T; lost: string }
  | { status: 'unreadable' };

/** A store read adds `absent`: nothing is filed under the key, which is genuinely empty */
export type VouchedRead<T> = { status: 'absent' } | VouchedValue<T>;

/** One read of `key`, judged by `vouch`; a store that fails or bytes that aren't JSON are unreadable */
export async function readVouched<T>(
  key: string,
  vouch: (raw: unknown) => VouchedValue<T>
): Promise<VouchedRead<T>> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    return { status: 'unreadable' };
  }
  if (raw === null || raw === undefined) return { status: 'absent' };
  try {
    return vouch(JSON.parse(raw));
  } catch {
    return { status: 'unreadable' };
  }
}

/** `n` of a thing, or nothing at all when none of them went missing */
function lostCount(n: number, of: number, noun: string): string | null {
  return n > 0 ? `${n} of ${of} ${noun}` : null;
}

/** Whether a month's raw JSON parses with nothing lost; the disk read and the backup pull share it */
export function vouchMonthValue(raw: unknown): VouchedValue<MonthData> {
  if (!isRecord(raw)) return { status: 'unreadable' };
  const data = parseMonthData(raw);
  const lost: (string | null)[] = [];
  // a section of the wrong shape is unreadable; a missing one is the default, not loss

  if (raw.habits !== undefined) {
    if (!Array.isArray(raw.habits)) return { status: 'unreadable' };
    // blank v1 slots were never habits
    const offered = isV1HabitArray(raw.habits)
      ? raw.habits.filter((name) => name.trim() !== '').length
      : raw.habits.length;
    lost.push(lostCount(offered - data.habits.length, offered, 'habits'));
  }

  if (raw.grid !== undefined) {
    if (!isRecord(raw.grid)) return { status: 'unreadable' };
    // marks left under an emptied v1 slot were orphaned by the old format, not lost here
    const blankSlots = new Set(
      Array.isArray(raw.habits) && isV1HabitArray(raw.habits)
        ? raw.habits.flatMap((name, i) => (name.trim() === '' ? [String(i)] : []))
        : []
    );
    // a 0 is a pending cell, which the app deletes rather than writes
    const offered = Object.entries(raw.grid).filter(([key, state]) => {
      if (state === 0) return false;
      const cell = (state === 1 || state === 2) && splitCellKey(key);
      return !(cell && blankSlots.has(cell.id));
    }).length;
    const dropped = offered - Object.keys(data.grid).length;
    if (dropped > 0) lost.push(`${dropped} grid ${dropped === 1 ? 'entry' : 'entries'}`);
  }

  if (raw.observations !== undefined) {
    if (!Array.isArray(raw.observations)) return { status: 'unreadable' };
    // counted on the raw array, since the parser pads an emptied list back to blank lines
    const kept = raw.observations.filter((o) => typeof o === 'string').length;
    lost.push(lostCount(raw.observations.length - kept, raw.observations.length, 'notes'));
  }

  if (raw.keyGoals !== undefined) {
    if (!Array.isArray(raw.keyGoals)) return { status: 'unreadable' };
    // the parser always yields three: goals past the third are lost, as is any slot it blanks or unticks
    const goals = raw.keyGoals;
    const dropped =
      Math.max(0, goals.length - 3) + goals.slice(0, 3).filter((g) => !isCardItem(g)).length;
    lost.push(lostCount(dropped, goals.length, 'goals'));
  }

  if (raw.cards !== undefined) {
    if (!Array.isArray(raw.cards)) return { status: 'unreadable' };
    const cards = raw.cards;
    const kept = data.cards ?? [];
    lost.push(lostCount(cards.length - kept.length, cards.length, 'cards'));
    // lines lost inside a card that itself survived
    let offered = 0;
    let read = 0;
    for (const card of kept) {
      offered += cards.find((c): c is CardShell => isCardShell(c) && c.id === card.id)!.items.length;
      read += card.items.length;
    }
    lost.push(lostCount(offered - read, offered, 'card lines'));
  }

  const named = lost.filter((entry): entry is string => entry !== null);
  return named.length
    ? { status: 'partial', data, lost: named.join(', ') }
    : { status: 'complete', data };
}

/** A month read the way the backup needs it: the same single read, saying how much it can answer for */
export function readMonthVouched(year: number, month: number): Promise<VouchedRead<MonthData>> {
  return readVouched(monthKey(year, month), vouchMonthValue);
}

/** Something to draw in every case, and whether saving it back would be a save or a deletion */
export interface ForEditing<T> {
  data: T;
  /** false when the bytes on disk held more than `data`; a caller must not write then */
  complete: boolean;
  /** the voucher's words for what was lost, when anything survived to be counted */
  lost?: string;
}

/** Absent is a record nobody has written yet, so its empty value is safe to save */
export function forEditing<T>(read: VouchedRead<T>, empty: T): ForEditing<T> {
  switch (read.status) {
    case 'complete':
      return { data: read.data, complete: true };
    case 'partial':
      return { data: read.data, complete: false, lost: read.lost };
    case 'absent':
      return { data: empty, complete: true };
    default:
      return { data: empty, complete: false };
  }
}

/** The reader for a screen that also saves what it read */
export async function readMonthForEditing(
  year: number,
  month: number
): Promise<ForEditing<MonthData>> {
  return forEditing(await readMonthVouched(year, month), emptyMonthData());
}

/** The latest earlier month's habits, for a month with none; stops at a list emptied on purpose */
export async function loadCarriedHabits(year: number, month: number): Promise<Habit[]> {
  const earlier = (await listStoredMonths())
    .filter((m) => m.year < year || (m.year === year && m.month < month))
    .reverse();
  for (const m of earlier) {
    const data = await loadMonth(m.year, m.month);
    if (data.habitsCleared) return [];
    const habits = data.habits.filter((h) => h.name.trim() !== '');
    if (habits.length) return habits;
  }
  return [];
}

export function saveMonth(year: number, month: number, data: MonthData): Promise<void> {
  return writeJson(monthKey(year, month), data);
}

/** Takes a deleted card out of every stored month but the open one; damaged months are left alone */
export async function dropCardFromMonths(
  id: string,
  open: { year: number; month: number }
): Promise<{ year: number; month: number }[]> {
  const changed: { year: number; month: number }[] = [];
  for (const m of await listStoredMonths()) {
    if (m.year === open.year && m.month === open.month) continue;
    const read = await readMonthVouched(m.year, m.month);
    if (read.status !== 'complete' || !read.data.cards?.some((c) => c.id === id)) continue;
    const { cards, ...rest } = read.data;
    const left = cards.filter((c) => c.id !== id);
    await saveMonth(m.year, m.month, left.length ? { ...rest, cards: left } : rest);
    changed.push(m);
  }
  return changed;
}

/** One stored month, with the year and month it came from */
export interface MonthRecord {
  year: number;
  /** 0-based, matching the app */
  month: number;
  data: MonthData;
}

/** Full records for a run of months ending at (year, month), newest first, in one multiGet */
export async function loadMonthWindow(
  year: number,
  month: number,
  count: number
): Promise<MonthRecord[]> {
  try {
    const span = Array.from({ length: count }, (_, i) => {
      const d = new Date(year, month - i, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
    const pairs = await AsyncStorage.multiGet(span.map((s) => monthKey(s.year, s.month)));
    return span.map((s, i) => ({ ...s, data: decodeMonth(pairs[i]?.[1]) }));
  } catch {
    return [];
  }
}

/** Every month this phone has stored, oldest first; empty when the store won't answer */
export async function listStoredMonths(): Promise<{ year: number; month: number }[]> {
  return (await readStoredMonths()) ?? [];
}

/** The same listing, but null when the store won't answer, so the backup never reads that as "no months" */
export async function readStoredMonths(): Promise<{ year: number; month: number }[] | null> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    // strict, because the same prefix also holds settings, tasks and the intro flag
    return keys
      .map((key) => /^@monthly-planning\/(\d{4})-(\d{2})$/.exec(key))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ year: Number(match[1]), month: Number(match[2]) - 1 }))
      .filter((m) => m.month >= 0 && m.month <= 11)
      .sort((a, b) => a.year - b.year || a.month - b.month);
  } catch {
    return null;
  }
}

/** Per-day done/missed counts for one month, used by the yearly grid */
export interface YearMonthSummary {
  habitCount: number;
  tallies: Record<number, { done: number; missed: number }>;
}

const EMPTY_MONTH_SUMMARY: YearMonthSummary = { habitCount: 0, tallies: {} };

/** Loads lightweight tallies for all 12 months of a year in one multiGet. */
export async function loadYearSummary(year: number): Promise<YearMonthSummary[]> {
  try {
    const keys = Array.from({ length: 12 }, (_, m) => monthKey(year, m));
    const pairs = await AsyncStorage.multiGet(keys);
    return pairs.map(([, raw]) => {
      if (!raw) return EMPTY_MONTH_SUMMARY;
      const data = decodeMonth(raw);
      const tallies: YearMonthSummary['tallies'] = {};
      // the parser kept only real marks on real habits, keyed `${day}:${id}`
      for (const [key, state] of Object.entries(data.grid)) {
        const t = (tallies[parseInt(key, 10)] ??= { done: 0, missed: 0 });
        if (state === 1) t.done++;
        else t.missed++;
      }
      return { habitCount: data.habits.length, tallies };
    });
  } catch {
    return Array.from({ length: 12 }, () => EMPTY_MONTH_SUMMARY);
  }
}
