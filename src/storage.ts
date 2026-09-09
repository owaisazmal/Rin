import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CellState,
  Habit,
  KeyGoal,
  MAX_HABITS,
  MonthData,
  cellKey,
  emptyMonthData,
} from './types';

function monthKey(year: number, month: number): string {
  // month is 0-based
  return `@monthly-planning/${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * What a stored month is allowed to look like.
 *
 * Until now the only thing that ever wrote a month was this app, so the loaders
 * took the shape on disk more or less on trust. Once months can also arrive
 * from a server that trust is misplaced: a record edited by hand, written by an
 * older client, or planted by whoever got hold of the account must not be able
 * to crash the planner, the history or the widget sync — all of which call
 * `.trim()` on what they are handed. So every field is checked for type,
 * anything that fails is dropped, and unknown properties never make it through.
 *
 * `parseTasks` in tasks.ts does the same job for deadlines.
 */

/**
 * v1 stored habits as a fixed 8-slot string array and grid keys as `${day}:${slotIndex}`.
 * Converting each non-empty slot to { id: String(slotIndex), name } keeps every
 * existing grid key valid, so no grid rewrite is needed.
 */
function parseHabits(raw: unknown): Habit[] {
  if (!Array.isArray(raw)) return [];
  const habits: Habit[] = raw.every((h) => typeof h === 'string')
    ? (raw as string[])
        .map((name, i) => ({ id: String(i), name }))
        .filter((h) => h.name.trim() !== '')
    : raw
        .filter(
          (h): h is Habit => !!h && typeof h.id === 'string' && typeof h.name === 'string'
        )
        .map((h) => ({ id: h.id, name: h.name }));

  // A repeated id would have two rings claiming the same cells; the first one
  // wins. The cap is the same one the UI enforces when adding.
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

/**
 * A stored `${day}:${habitId}` split into its halves, or null when the string
 * is not one at all — no separator, or a day no month ever had.
 *
 * `vouchMonth` needs to ask the same question of a raw key that `parseGrid`
 * asks, so the two share this rather than each carrying their own copy of it:
 * a key the parser would keep but the voucher thought malformed would go
 * straight back to reporting loss that never happened.
 */
function splitCellKey(key: string): { day: number; id: string } | null {
  const sep = key.indexOf(':');
  if (sep <= 0) return null;
  const day = Number(key.slice(0, sep));
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return { day, id: key.slice(sep + 1) };
}

/**
 * Only cells that belong to a habit in the list, on a plausible day, holding a
 * real mark. A pending cell is the same as an absent one — the app deletes
 * rather than writes 0 — so those are dropped too, which also keeps
 * `habitHasMarks` honest. Keys are rebuilt, so `01:0` and `1:0` can't coexist.
 */
function parseGrid(raw: unknown, habits: Habit[]): Record<string, CellState> {
  const grid: Record<string, CellState> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return grid;
  const ids = new Set(habits.map((h) => h.id));
  for (const [key, state] of Object.entries(raw as Record<string, unknown>)) {
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

/** Always exactly three, each slot coerced on its own rather than all-or-nothing */
function parseKeyGoals(raw: unknown): KeyGoal[] {
  const base = emptyMonthData().keyGoals;
  if (!Array.isArray(raw)) return base;
  return base.map((empty, i) => {
    const g: unknown = raw[i];
    if (!g || typeof g !== 'object') return empty;
    const { text, done } = g as Record<string, unknown>;
    return { text: typeof text === 'string' ? text : '', done: done === true };
  });
}

export function parseMonthData(raw: unknown): MonthData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyMonthData();
  const r = raw as Record<string, unknown>;
  const habits = parseHabits(r.habits);
  return {
    habits,
    grid: parseGrid(r.grid, habits),
    observations: parseObservations(r.observations),
    keyGoals: parseKeyGoals(r.keyGoals),
  };
}

/** A stored month's JSON, or an empty month if there isn't one or it won't parse */
function decodeMonth(raw: string | null | undefined): MonthData {
  if (!raw) return emptyMonthData();
  try {
    return parseMonthData(JSON.parse(raw));
  } catch {
    return emptyMonthData();
  }
}

export async function loadMonth(year: number, month: number): Promise<MonthData> {
  try {
    return decodeMonth(await AsyncStorage.getItem(monthKey(year, month)));
  } catch {
    return emptyMonthData();
  }
}

/**
 * What a read of a stored record was able to vouch for.
 *
 * Every loader above is deliberately lossy: a month whose habit list is half
 * garbage still has to draw, so the parsers drop what they cannot rebuild and
 * hand back the survivors. That is right for the screen and ruinous for the
 * backup, which replaces the only other copy of the record that exists — the
 * survivors would be sealed and pushed over the complete one on the server.
 *
 * The loaders cannot say so, because `MonthData` has no way to mean "I read
 * something but could not read all of it". This is that way. The rule it
 * exists to enforce: never put a document on the wire that this phone cannot
 * vouch for as whole. `absent` is fine and means empty; `partial` never is.
 */
export type VouchedRead<T> =
  /** nothing is stored under the key; genuinely empty, safe to treat as such */
  | { status: 'absent' }
  /** the bytes parsed with nothing dropped, truncated or substituted */
  | { status: 'complete'; data: T }
  /** it parsed, but the parser discarded something; `lost` names what, briefly */
  | { status: 'partial'; data: T; lost: string }
  /** the store would not answer, or the bytes are not JSON at all */
  | { status: 'unreadable' };

/**
 * How many habits the raw array was actually offering.
 *
 * v1 stored habits as a fixed 8-slot array of names, and an empty slot is an
 * empty slot rather than a habit that went missing — `parseHabits` drops the
 * blanks on purpose. Counting them as loss would report every un-migrated
 * month as partial and stop it backing up forever, so the same test the parser
 * uses is applied here. Any other array is counted whole.
 */
function habitsOffered(raw: unknown[]): number {
  if (isV1HabitArray(raw)) {
    return raw.filter((name) => name.trim() !== '').length;
  }
  return raw.length;
}

/**
 * The v1 fixed-slot shape: an array of nothing but names.
 *
 * Both halves of the migration exemption below turn on this one test, and they
 * have to turn on the *same* one — `parseHabits` reads a habits array this way
 * or the modern way, never half of each, so the count of what it was offered
 * and the count of what the grid was offered must agree about which format
 * they are looking at.
 */
function isV1HabitArray(raw: unknown[]): raw is string[] {
  return raw.every((h) => typeof h === 'string');
}

/**
 * Which v1 slots were sitting empty, by the id their marks would carry.
 *
 * The other half of the exemption `habitsOffered` makes, and for the same
 * migration. v1 stored habits as a fixed 8-slot name array with grid keys
 * shaped `${day}:${slotIndex}`, so clearing a slot's name left that slot's
 * marks behind under an index that now names no habit. `parseGrid` drops them
 * and is right to — but they were orphaned by the old format, on the day
 * somebody emptied the slot, and not by anything wrong with this phone's copy.
 * Counting them would report an ordinary migrated month as partial and lock it
 * out of backing up for good, which is exactly the false positive the habits
 * side already guards against.
 *
 * `String(i)` is what `parseHabits` names the slots, so it is what is matched:
 * a key like `1:01` refers to no slot the migration ever created and stays
 * counted. Only this shape is exempt — in a modern record a mark on an id that
 * is not in the list is a habit that went missing, which is real loss and is
 * still reported as such.
 */
function blankV1Slots(rawHabits: unknown): Set<string> {
  const blank = new Set<string>();
  if (!Array.isArray(rawHabits) || !isV1HabitArray(rawHabits)) return blank;
  rawHabits.forEach((name, i) => {
    if (name.trim() === '') blank.add(String(i));
  });
  return blank;
}

/**
 * Whether one raw grid entry is a mark the migration orphaned, rather than one
 * this phone failed to read.
 *
 * Deliberately narrow: everything `parseGrid` would have kept had the slot
 * still held its name, and nothing else. A cell whose value is not a mark, or
 * whose day belongs to no month, is damaged in its own right — the empty slot
 * does not excuse it, and it stays counted as loss.
 */
function orphanedByMigration(key: string, state: unknown, blankSlots: Set<string>): boolean {
  if (state !== 1 && state !== 2) return false;
  const cell = splitCellKey(key);
  return cell !== null && blankSlots.has(cell.id);
}

/** `n` of a thing, or nothing at all when none of them went missing */
function lostCount(n: number, of: number, noun: string): string | null {
  return n > 0 ? `${n} of ${of} ${noun}` : null;
}

/**
 * Whether a month's stored JSON became the month it was meant to be.
 *
 * Each section is compared as the parser's OUTPUT against the raw INPUT, for
 * the specific things that parser is known to discard — nothing here parses
 * anything a second time, so this costs a few array lengths on data already in
 * memory and can run per document on every backup.
 *
 * Two lines are held throughout. A section that is present but the wrong shape
 * is `unreadable`, not partial: a habits key holding a string is not a habit
 * list that lost members, it is a record this phone cannot read. And a section
 * that is *missing* is not loss at all — a month saved before observations
 * existed is complete, and the parser substituting the documented default is
 * the design working rather than data going astray.
 */
function vouchMonth(raw: unknown): VouchedRead<MonthData> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { status: 'unreadable' };
  const r = raw as Record<string, unknown>;
  const data = parseMonthData(r);
  const lost: (string | null)[] = [];

  if (r.habits !== undefined) {
    if (!Array.isArray(r.habits)) return { status: 'unreadable' };
    const offered = habitsOffered(r.habits);
    lost.push(lostCount(offered - data.habits.length, offered, 'habits'));
  }

  if (r.grid !== undefined) {
    if (!r.grid || typeof r.grid !== 'object' || Array.isArray(r.grid)) {
      return { status: 'unreadable' };
    }
    // A cell holding 0 is a pending cell, which the app deletes rather than
    // writes; the parser dropping it loses nothing, and counting it would
    // flag any month an older build had written zeroes into. Everything else
    // present was meant to be a mark, including a value too broken to be one —
    // except a mark stranded on an empty v1 slot, which the migration orphaned
    // rather than this phone losing, and which `habitsOffered` already exempts
    // on the names side of the very same record.
    const orphans = blankV1Slots(r.habits);
    const offered = Object.entries(r.grid as Record<string, unknown>).filter(
      ([key, state]) => state !== 0 && !orphanedByMigration(key, state, orphans)
    ).length;
    const dropped = offered - Object.keys(data.grid).length;
    if (dropped > 0) lost.push(`${dropped} grid ${dropped === 1 ? 'entry' : 'entries'}`);
  }

  if (r.observations !== undefined) {
    if (!Array.isArray(r.observations)) return { status: 'unreadable' };
    // Counted against the raw array rather than against `data.observations`,
    // because when nothing survives the parser substitutes its four blank
    // lines — so the answer can come back *longer* than what was on disk, and
    // comparing lengths would read a total loss as no loss at all.
    const kept = r.observations.filter((o) => typeof o === 'string').length;
    lost.push(lostCount(r.observations.length - kept, r.observations.length, 'notes'));
  }

  if (r.keyGoals !== undefined) {
    if (!Array.isArray(r.keyGoals)) return { status: 'unreadable' };
    const goals = r.keyGoals;
    /**
     * The subtle one, because the parser always yields exactly three whatever
     * it was given, so its length says nothing. What is decided here:
     *
     * - fewer than three raw goals, or no key at all, is the documented
     *   default filling the empty slots. Not loss. The app has always written
     *   three, but a hand-trimmed or older record must still back up.
     * - more than three is real: goal four was on disk and will not be on the
     *   wire, and sending would delete it from the archive.
     * - a slot that exists but is not a goal — a null, or a numeric `text` —
     *   comes back blanked. That is a substitution, and a blanked goal
     *   overwriting a written one is exactly what this type exists to stop.
     * - so is the tick, which is the easier half to miss because nothing about
     *   it looks discarded: the goal is still there, with its text, and only
     *   the one bit saying it was finished has quietly flipped.
     *   `parseKeyGoals` writes `done === true`, so every `done` that is not a
     *   boolean becomes `false` and a completed goal goes over the wire
     *   unfinished. A present slot with no usable `done` is counted for the
     *   same reason a present slot with no usable `text` already is: a missing
     *   `keyGoals` key is the documented default, but half a goal somebody
     *   wrote is not.
     */
    let dropped = Math.max(0, goals.length - 3);
    for (const g of goals.slice(0, 3)) {
      const goal = g as Record<string, unknown> | null;
      if (!goal || typeof goal !== 'object') {
        dropped++;
        continue;
      }
      // one slot is one loss however many of its fields went, since what is
      // reported is goals rather than fields
      if (typeof goal.text !== 'string' || typeof goal.done !== 'boolean') dropped++;
    }
    lost.push(lostCount(dropped, goals.length, 'goals'));
  }

  const named = lost.filter((entry): entry is string => entry !== null);
  return named.length
    ? { status: 'partial', data, lost: named.join(', ') }
    : { status: 'complete', data };
}

/**
 * A month read the way the backup needs it, rather than the way a screen does.
 *
 * `loadMonth` stays exactly as it is — the planner is right to take whatever
 * survived and draw it. This is the same single read, saying afterwards how
 * much of the record it can actually answer for.
 */
export async function readMonthVouched(
  year: number,
  month: number
): Promise<VouchedRead<MonthData>> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(monthKey(year, month));
  } catch {
    // a store that will not answer is not a phone with no months
    return { status: 'unreadable' };
  }
  if (raw === null || raw === undefined) return { status: 'absent' };
  try {
    return vouchMonth(JSON.parse(raw));
  } catch {
    return { status: 'unreadable' };
  }
}

/** A month to draw, and whether the record it came from was understood in full */
export interface MonthForEditing {
  /** the survivors, or an empty month when there was nothing readable at all */
  data: MonthData;
  /** false when the bytes on disk held more than `data` does */
  complete: boolean;
}

/**
 * The reader for a screen that also writes what it read.
 *
 * `loadMonth` is the wrong one for that job, for a reason that has nothing to
 * do with the backup: it answers a half-readable record with the half it read,
 * and a screen that loads a month also saves it, so the survivors go back over
 * the record they survived. A month that lost a habit on disk is then one
 * debounced save away from having lost it for good — and the loss is real by
 * that point, so `readMonthVouched` afterwards says `complete` and the thinned
 * month backs up without a word. Losing data the user never touched is a bug
 * on its own; it also launders the only evidence the backup had.
 *
 * So this is the same single read as `readMonthVouched`, in the shape a screen
 * can render in every case: something to draw always, and one flag saying
 * whether writing it back would be a save or a deletion. A caller that writes
 * must not write when `complete` is false.
 *
 * `useMonthData` is the caller this exists for.
 */
export async function readMonthForEditing(
  year: number,
  month: number
): Promise<MonthForEditing> {
  const record = await readMonthVouched(year, month);
  switch (record.status) {
    case 'complete':
      return { data: record.data, complete: true };
    case 'partial':
      return { data: record.data, complete: false };
    case 'absent':
      // nothing is stored under the key, which is a month nobody has opened
      // yet. An empty month is exactly what is there, so writing one back
      // takes nothing away and the screen is free to save.
      return { data: emptyMonthData(), complete: true };
    default:
      // the store would not answer, or the bytes are not JSON. There is nothing
      // to draw but a blank month, and writing that blank month back over
      // whatever is on disk is precisely how the record stops being recoverable.
      return { data: emptyMonthData(), complete: false };
  }
}

export async function saveMonth(year: number, month: number, data: MonthData): Promise<void> {
  try {
    await AsyncStorage.setItem(monthKey(year, month), JSON.stringify(data));
  } catch {
    // best-effort persistence; nothing actionable on failure
  }
}

/** One stored month, with the year and month it came from */
export interface MonthRecord {
  year: number;
  /** 0-based, matching the app */
  month: number;
  data: MonthData;
}

/**
 * Full records for a run of months ending at (year, month), newest first.
 *
 * The year summary below is deliberately lossy — it counts marks without saying
 * which habit they belonged to — which is all a grid needs and not enough for a
 * log that names them. One multiGet either way, so reading whole months over a
 * short window costs about the same as reading tallies over a long one.
 */
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

/**
 * Every month this phone has actually stored, oldest first.
 *
 * The other readers here ask for a window they already know the bounds of;
 * backing up has no bounds to know, so it asks the store what is there. The
 * pattern is deliberately strict: the same prefix also holds settings, tasks
 * and the intro flag, none of which are months.
 */
export async function listStoredMonths(): Promise<{ year: number; month: number }[]> {
  return (await readStoredMonths()) ?? [];
}

/**
 * The same listing, for the one caller that must know the difference between
 * "this phone has stored no months" and "the store would not answer".
 *
 * `listStoredMonths` answers both with an empty array, which is right for every
 * screen: there is nothing to show either way. The backup is the exception, and
 * for the same reason the vouched reads above exist. It retires a month's
 * pending flag when the listing does not name it, on the grounds that a flag
 * for a month nothing is stored under can never be cleared by sending it — and
 * if a failed listing came back as "no months at all", that reasoning would
 * retire every flag on the phone and quietly settle a backup that never
 * happened. Null means do not conclude anything.
 */
export async function readStoredMonths(): Promise<{ year: number; month: number }[] | null> {
  try {
    const keys = await AsyncStorage.getAllKeys();
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
      // the parser has already rebuilt every key as `${day}:${id}` and kept
      // only real marks on real habits, so there is nothing left to check
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
