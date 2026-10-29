import { MONTH_ABBR } from './dates';
import { EXPORT_FORMAT, EXPORT_VERSION, counted, listed, monthTitle } from './exportData';
import { taskShardKey } from './hooks/useTasks';
import { parseQuotePrefs } from './quotes';
import type { QuotePrefs } from './quotes';
import { parseSettings } from './settings';
import type { Settings } from './settings';
import { monthKey, readMonthVouched, vouchMonthValue, writeMany } from './storage';
import type { VouchedRead } from './storage';
import { clearUnvouched, markDirty } from './syncLedger';
import { TASKS_KEY, readTasksVouched, vouchTasksValue } from './tasks';
import type { Task } from './tasks';
import {
  MAX_CARD_ITEMS,
  MAX_HABITS,
  MAX_MONTH_CARDS,
  MAX_OBSERVATIONS,
  cellKey,
  isEmptyMonth,
  isRecord,
  nextId,
} from './types';
import type { CardItem, CustomCard, Habit, KeyGoal, MonthData } from './types';

/** Reading an export back in; pure apart from `previewImport` and `applyImport` */

export interface ImportedMonth {
  /** "2026-10" */
  key: string;
  year: number;
  /** 0-based */
  month: number;
  data: MonthData;
  /** the phone it came from could not read all of it */
  damaged: boolean;
}

export interface ImportFile {
  /** epoch ms, or null when the file doesn't say */
  exportedAt: number | null;
  /** oldest first */
  months: ImportedMonth[];
  /** months the exporting phone could not read, so the file lacks them */
  skipped: string[];
  deadlines: Task[];
  deadlinesDamaged: boolean;
  settings: Settings | null;
}

export type ImportRefusal =
  | { reason: 'unreadable' }
  | { reason: 'foreign' }
  | { reason: 'newer'; version: number }
  /** `part` failed the parsers: "March 2026", "the deadlines", ... */
  | { reason: 'damaged'; part: string };

export type ImportRead = { ok: true; file: ImportFile } | { ok: false; refusal: ImportRefusal };

const refuse = (refusal: ImportRefusal): ImportRead => ({ ok: false, refusal });
const damaged = (part: string) => refuse({ reason: 'damaged', part });

const MONTH_KEY = /^(\d{4})-(\d{2})$/;

function monthOf(key: unknown): { year: number; month: number } | null {
  const match = typeof key === 'string' ? MONTH_KEY.exec(key) : null;
  if (!match) return null;
  const month = Number(match[2]) - 1;
  return month >= 0 && month <= 11 ? { year: Number(match[1]), month } : null;
}

/** All or nothing: any month, the deadlines or the settings failing their parser refuses the file */
export function readImport(text: string): ImportRead {
  let raw: unknown;
  try {
    // some editors add a BOM on saving
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return refuse({ reason: 'unreadable' });
  }
  if (!isRecord(raw) || raw.format !== EXPORT_FORMAT) return refuse({ reason: 'foreign' });
  const { version } = raw;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return refuse({ reason: 'foreign' });
  }
  if (version > EXPORT_VERSION) return refuse({ reason: 'newer', version });

  if (!Array.isArray(raw.months)) return damaged('the month list');
  const months: ImportedMonth[] = [];
  for (const entry of raw.months) {
    const at = isRecord(entry) ? monthOf(entry.month) : null;
    if (!at || months.some((m) => m.key === entry.month)) return damaged('the month list');
    const key = entry.month as string;
    const read = vouchMonthValue(entry.data);
    if (read.status !== 'complete') return damaged(monthTitle(key));
    months.push({ key, ...at, data: read.data, damaged: typeof entry.damaged === 'string' });
  }
  months.sort((a, b) => a.key.localeCompare(b.key));

  const tasks = vouchTasksValue(raw.deadlines);
  if (tasks.status !== 'complete') return damaged('the deadlines');

  if (raw.settings !== undefined && !isRecord(raw.settings)) return damaged('the settings');
  const exportedAt = typeof raw.exportedAt === 'string' ? Date.parse(raw.exportedAt) : NaN;
  const skipped = Array.isArray(raw.skipped) ? raw.skipped.filter((k) => monthOf(k) !== null) : [];

  return {
    ok: true,
    file: {
      exportedAt: Number.isFinite(exportedAt) ? exportedAt : null,
      months,
      skipped: skipped as string[],
      deadlines: tasks.data,
      deadlinesDamaged: typeof raw.deadlinesDamaged === 'string',
      settings: raw.settings === undefined ? null : parseSettings(raw.settings),
    },
  };
}

export function refusalText(refusal: ImportRefusal): { title: string; body: string } {
  switch (refusal.reason) {
    case 'unreadable':
      return {
        title: 'This file cannot be read',
        body: 'It is not a Rin export, or it was cut short on the way. Nothing was imported.',
      };
    case 'foreign':
      return {
        title: 'Not a Rin export',
        body: 'Choose a .json file made with Export in Rin’s settings. Nothing was imported.',
      };
    case 'newer':
      return {
        title: 'Made by a newer Rin',
        body:
          `This file uses export format ${refusal.version}, and this version of Rin reads up to ` +
          `${EXPORT_VERSION}. Update Rin, then import it again. Nothing was imported.`,
      };
    case 'damaged': {
      const part = `${refusal.part[0].toUpperCase()}${refusal.part.slice(1)}`;
      return {
        title: 'Part of this file is damaged',
        body: `${part} could not be read in full, so nothing was imported.`,
      };
    }
  }
}

/** Sorted keys, so two copies of a month compare equal whatever order their marks were made in */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    isRecord(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v
  );
}

const norm = (text: string) => text.trim().toLowerCase();

/** Their lines that mine lacks, into my blank slots first, then appended up to `cap` */
function mergeLines<T>(
  mine: readonly T[],
  theirs: readonly T[],
  cap: number,
  textOf: (line: T) => string,
  isBlank: (line: T) => boolean
): { lines: T[]; left: number } {
  const lines = [...mine];
  const present = new Set(mine.filter((line) => !isBlank(line)).map(textOf));
  let left = 0;
  for (const line of theirs) {
    if (isBlank(line) || present.has(textOf(line))) continue;
    present.add(textOf(line));
    const free = lines.findIndex(isBlank);
    if (free >= 0) lines[free] = line;
    else if (lines.length < cap) lines.push(line);
    else left++;
  }
  return { lines, left };
}

const blankItem = (item: CardItem | KeyGoal) => item.text.trim() === '' && !item.done;
const itemText = (item: CardItem | KeyGoal) => norm(item.text);

/** Habits match by name, since ids are only counters; returns where each of theirs landed */
function mergeHabits(mine: Habit[], theirs: Habit[]) {
  const habits = [...mine];
  const ids = new Map<string, string>();
  const claimed = new Set<string>();
  let left = 0;
  for (const habit of theirs) {
    const same = (h: Habit) => !claimed.has(h.id) && norm(h.name) === norm(habit.name);
    const match = habits.find((h) => h.id === habit.id && same(h)) ?? habits.find(same);
    if (match) {
      claimed.add(match.id);
      ids.set(habit.id, match.id);
      continue;
    }
    if (habits.length >= MAX_HABITS) {
      left++;
      continue;
    }
    const id = habits.some((h) => h.id === habit.id) ? nextId(habits) : habit.id;
    habits.push({ id, name: habit.name });
    claimed.add(id);
    ids.set(habit.id, id);
  }
  return { habits, ids, left };
}

function mergeCards(mine: CustomCard[], theirs: CustomCard[]): { cards: CustomCard[]; left: number; lines: number } {
  const cards = [...mine];
  let left = 0;
  let lines = 0;
  for (const card of theirs) {
    const at = cards.findIndex((c) => c.id === card.id);
    if (at < 0) {
      if (cards.length < MAX_MONTH_CARDS) cards.push(card);
      else left++;
      continue;
    }
    const held = cards[at];
    const cap = held.kind === 'note' ? 1 : MAX_CARD_ITEMS;
    const merged = mergeLines(held.items, card.items, cap, itemText, blankItem);
    cards[at] = { ...held, items: merged.lines };
    lines += merged.left;
  }
  return { cards, left, lines };
}

export interface MergedMonth {
  data: MonthData;
  /** false when the phone already has everything the file does */
  adds: boolean;
  /** what of the file had no room, e.g. "1 habit, 2 notes"; null when everything fit */
  left: string | null;
}

/** "Keep mine": everything on the phone stays, and what only the file has is added where it fits */
export function mergeMonth(mine: MonthData, theirs: MonthData): MergedMonth {
  const { habits, ids, left: habitsLeft } = mergeHabits(mine.habits, theirs.habits);

  const grid = { ...mine.grid };
  for (const [key, state] of Object.entries(theirs.grid)) {
    const sep = key.indexOf(':');
    const id = ids.get(key.slice(sep + 1));
    // marks of a habit that had no room go with it
    if (id === undefined) continue;
    const at = cellKey(Number(key.slice(0, sep)), id);
    if (grid[at] === undefined) grid[at] = state;
  }

  const notes = mergeLines(
    mine.observations,
    theirs.observations,
    MAX_OBSERVATIONS,
    norm,
    (line) => line.trim() === ''
  );
  const goals = mergeLines(mine.keyGoals, theirs.keyGoals, 3, itemText, blankItem);
  const cards = mergeCards(mine.cards ?? [], theirs.cards ?? []);

  const left = [
    habitsLeft ? counted(habitsLeft, 'habit') : null,
    notes.left ? counted(notes.left, 'note') : null,
    goals.left ? counted(goals.left, 'goal') : null,
    cards.left ? counted(cards.left, 'card') : null,
    cards.lines ? counted(cards.lines, 'card line') : null,
  ].filter((x): x is string => x !== null);

  const data: MonthData = {
    habits,
    ...(habits.length === 0 && mine.habitsCleared ? { habitsCleared: true as const } : {}),
    grid,
    observations: notes.lines,
    keyGoals: goals.lines,
    ...(cards.cards.length ? { cards: cards.cards } : {}),
  };
  return { data, adds: canonical(data) !== canonical(mine), left: left.length ? left.join(', ') : null };
}

export type MonthChoice = 'mine' | 'replace' | 'skip';

export interface MonthPlan {
  key: string;
  /** new also covers a month stored here with nothing in it */
  status: 'new' | 'same' | 'clash';
  /** clash only: this phone's copy can't be read in full, so only replace or skip is offered */
  damagedHere: boolean;
  /** clash only: what "keep mine" would save; null when this phone's copy is damaged */
  merged: MergedMonth | null;
}

export function planMonth(file: ImportedMonth, here: VouchedRead<MonthData>): MonthPlan {
  const plan = (status: MonthPlan['status'], merged: MergedMonth | null = null): MonthPlan => ({
    key: file.key,
    status,
    damagedHere: status === 'clash' && merged === null,
    merged,
  });
  if (here.status === 'absent') return plan('new');
  if (here.status !== 'complete') return plan('clash');
  if (isEmptyMonth(here.data)) return plan('new');
  if (canonical(here.data) === canonical(file.data)) return plan('same');
  return plan('clash', mergeMonth(here.data, file.data));
}

export interface DeadlinePlan {
  /** what joins the list, each with an id this phone isn't using */
  add: Task[];
  /** deadlines in the file that this phone already has */
  already: number;
  /** this phone's list can't be read in full, so nothing is added to it */
  blocked: boolean;
}

function sameTask(a: Task, b: Task): boolean {
  return (
    a.text === b.text &&
    a.due === b.due &&
    a.done === b.done &&
    a.repeat?.every === b.repeat?.every &&
    a.repeat?.day === b.repeat?.day
  );
}

/** Copies are matched one for one; the rest keep their id when it is free here */
export function planDeadlines(here: VouchedRead<Task[]>, file: Task[]): DeadlinePlan {
  if (here.status === 'partial' || here.status === 'unreadable') {
    return { add: [], already: 0, blocked: true };
  }
  const mine = here.status === 'complete' ? here.data : [];
  const unmatched = [...mine];
  const add: Task[] = [];
  let already = 0;
  for (const task of file) {
    const twin = unmatched.findIndex((t) => sameTask(t, task));
    if (twin >= 0) {
      unmatched.splice(twin, 1);
      already++;
      continue;
    }
    const held = [...mine, ...add];
    add.push({ ...task, id: held.some((t) => t.id === task.id) ? nextId(held) : task.id });
  }
  return { add, already, blocked: false };
}

/** What the phone holds that the file could touch */
export interface PhoneState {
  months: Record<string, VouchedRead<MonthData>>;
  tasks: VouchedRead<Task[]>;
}

export interface ImportPlan {
  months: MonthPlan[];
  deadlines: DeadlinePlan;
}

export function planImport(file: ImportFile, here: PhoneState): ImportPlan {
  return {
    months: file.months.map((m) => planMonth(m, here.months[m.key] ?? { status: 'unreadable' })),
    deadlines: planDeadlines(here.tasks, file.deadlines),
  };
}

/** What a month's choice saves, or null to leave it; a clash with no choice is never written */
export function monthToSave(
  plan: MonthPlan,
  file: ImportedMonth,
  choice: MonthChoice | undefined
): MonthData | null {
  if (plan.status === 'new') return file.data;
  if (plan.status === 'same') return null;
  if (choice === 'replace') return file.data;
  return choice === 'mine' && plan.merged?.adds ? plan.merged.data : null;
}

/** The file's quotes this phone lacks, as many as there is room for */
export function newQuotes(here: QuotePrefs, file: QuotePrefs): string[] {
  const all = parseQuotePrefs({ custom: [...here.custom, ...file.custom] }).custom;
  return all.slice(here.custom.length);
}

export interface SettingsChoice {
  /** theme, chart, layout, reminders and which quotes show */
  settings: boolean;
  /** the user's own quotes, added to this phone's */
  quotes: boolean;
}

export function applySettings(here: Settings, file: Settings, choice: SettingsChoice): Settings {
  let next = choice.settings
    ? { ...file, quotes: { ...here.quotes, source: file.quotes.source } }
    : here;
  if (choice.quotes) {
    const custom = [...here.quotes.custom, ...newQuotes(here.quotes, file.quotes)];
    // as in the editor: first quotes added on built-in would never show
    const joins = !choice.settings && here.quotes.custom.length === 0 && custom.length > 0;
    const source = joins && next.quotes.source === 'builtin' ? 'both' : next.quotes.source;
    next = { ...next, quotes: { source, custom } };
  }
  return next;
}

/** "5 months · 12 deadlines", when it was made, and what the exporting phone could not read */
export function importSummary(file: ImportFile): {
  line: string;
  made: string | null;
  damage: string | null;
} {
  const line = `${counted(file.months.length, 'month')} · ${counted(file.deadlines.length, 'deadline')}`;
  const at = file.exportedAt === null ? null : new Date(file.exportedAt);
  const made = at && `Exported ${at.getDate()} ${MONTH_ABBR[at.getMonth()]} ${at.getFullYear()}`;
  const hurt = file.months.filter((m) => m.damaged).length + file.skipped.length;
  const what = [hurt ? counted(hurt, 'month') : null, file.deadlinesDamaged ? 'the deadlines' : null]
    .filter((x): x is string => x !== null)
    .join(' and ');
  const damage = what ? `${what[0].toUpperCase()}${what.slice(1)} not fully readable when exported` : null;
  return { line, made, damage };
}

/** "March, April 2026 and January 2027" */
export function monthList(keys: string[]): string {
  const years = new Map<string, string[]>();
  for (const key of keys) {
    const [year] = key.split('-');
    const name = monthTitle(key).split(' ')[0];
    years.set(year, [...(years.get(year) ?? []), name]);
  }
  return listed([...years].map(([year, names]) => `${names.join(', ')} ${year}`));
}

/** The body of the confirmation, a line per kind of change; null when importing would change nothing */
export function importNotice(
  file: ImportFile,
  plan: ImportPlan,
  choices: Record<string, MonthChoice>,
  settings: SettingsChoice
): string | null {
  let added = 0;
  let merged = 0;
  let replaced = 0;
  plan.months.forEach((m, i) => {
    if (!monthToSave(m, file.months[i], choices[m.key])) return;
    if (m.status === 'new') added++;
    else if (choices[m.key] === 'replace') replaced++;
    else merged++;
  });
  const deadlines = plan.deadlines.add.length;
  const adds = [
    added ? counted(added, 'month') : null,
    deadlines ? counted(deadlines, 'deadline') : null,
    settings.quotes ? 'the file’s quotes' : null,
  ].filter((x): x is string => x !== null);
  const replaces = [
    replaced ? counted(replaced, 'month') : null,
    settings.settings ? 'your settings' : null,
  ].filter((x): x is string => x !== null);
  const lines = [
    adds.length ? `Adds ${listed(adds)}.` : null,
    merged ? `Merges ${counted(merged, 'month')} into yours.` : null,
    replaces.length ? `Replaces ${listed(replaces)} with the file’s.` : null,
  ].filter((x): x is string => x !== null);
  return lines.length ? `${lines.join('\n')}\n\nThis cannot be undone.` : null;
}

/** What the alert says once the import is saved */
export function importDoneText(result: ImportResult, settings: SettingsChoice, where: string): string {
  const saved = [
    result.months ? counted(result.months, 'month') : null,
    result.deadlines ? counted(result.deadlines, 'deadline') : null,
    settings.settings ? 'the settings' : null,
    settings.quotes ? 'the quotes' : null,
  ].filter((x): x is string => x !== null);
  return saved.length
    ? `Saved ${listed(saved)} from the file on this ${where}.`
    : `This ${where} already had everything in the file.`;
}

async function readPhone(file: ImportFile): Promise<PhoneState> {
  const [months, tasks] = await Promise.all([
    Promise.all(file.months.map(async (m) => [m.key, await readMonthVouched(m.year, m.month)] as const)),
    readTasksVouched(),
  ]);
  return { months: Object.fromEntries(months), tasks };
}

/** Reads this phone's copies of what the file holds and works out what each would do */
export async function previewImport(file: ImportFile): Promise<ImportPlan> {
  return planImport(file, await readPhone(file));
}

export interface ImportResult {
  months: number;
  deadlines: number;
}

/** Re-reads the phone, then writes every record in one store call before telling the ledger */
export async function applyImport(
  file: ImportFile,
  choices: Record<string, MonthChoice>
): Promise<ImportResult> {
  const here = await readPhone(file);
  const plan = planImport(file, here);
  const writes: [string, unknown][] = [];
  const months: string[] = [];
  plan.months.forEach((m, i) => {
    const imported = file.months[i];
    const data = monthToSave(m, imported, choices[m.key]);
    if (!data) return;
    writes.push([monthKey(imported.year, imported.month), data]);
    months.push(m.key);
  });
  const { add } = plan.deadlines;
  if (add.length) {
    const mine = here.tasks.status === 'complete' ? here.tasks.data : [];
    writes.push([TASKS_KEY, [...mine, ...add]]);
  }
  if (!writes.length) return { months: 0, deadlines: 0 };
  await writeMany(writes);

  for (const key of months) {
    await markDirty(key);
    await clearUnvouched(key);
  }
  if (add.length) {
    for (const key of new Set(['current', ...add.map(taskShardKey)])) await markDirty(key);
  }
  return { months: months.length, deadlines: add.length };
}
