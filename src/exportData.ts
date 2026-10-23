import { MONTH_NAMES, monthLength } from './dates';
import { loadSettings } from './settings';
import { readMonthVouched, readStoredMonths } from './storage';
import { readTasksVouched } from './tasks';
import { cellKey } from './types';
import type { CellState, MonthData } from './types';
import type { Settings } from './settings';
import type { Task } from './tasks';
import type { VouchedRead } from './storage';

/** An unencrypted copy of the user's data for the share sheet; pure apart from `gatherExport` */

export const EXPORT_FORMAT = 'rin-export';
/** Raised whenever the file's shape changes; the import checks it before anything else */
export const EXPORT_VERSION = 1;

export type ExportFormat = 'json' | 'csv';

export type ExportScope =
  | { kind: 'month'; year: number; /** 0-based */ month: number }
  | { kind: 'year'; year: number }
  | { kind: 'all' };

export interface ExportedMonth {
  /** "2026-10", the name the backup files it under too */
  month: string;
  data: MonthData;
  /** what could not be read when the stored month was damaged; `data` holds the rest */
  damaged?: string;
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  /** ISO 8601, UTC */
  exportedAt: string;
  /** "2026-10", "2026" or "all" */
  scope: string;
  months: ExportedMonth[];
  /** stored months that could not be read at all, so nothing of them is in the file */
  skipped: string[];
  /** due in the scope, or finished in it */
  deadlines: Task[];
  /** set when the deadline list could not be read in full */
  deadlinesDamaged?: string;
  /** theme, chart, layout, reminders and quotes; the CSV never carries them */
  settings?: Settings;
}

/** What `buildExport` works from: every stored month as read, the deadlines and the settings */
export interface ExportSource {
  months: { year: number; month: number; read: VouchedRead<MonthData> }[];
  tasks: VouchedRead<Task[]>;
  settings?: Settings;
}

const pad = (n: number) => String(n).padStart(2, '0');
const monthKey = (year: number, month: number) => `${year}-${pad(month + 1)}`;

export function scopeKey(scope: ExportScope): string {
  if (scope.kind === 'month') return monthKey(scope.year, scope.month);
  return scope.kind === 'year' ? String(scope.year) : 'all';
}

function inScope(scope: ExportScope, year: number, month: number): boolean {
  if (scope.kind === 'all') return true;
  return year === scope.year && (scope.kind === 'year' || month === scope.month);
}

/** The scope's local start and end, epoch ms, or null for everything */
function scopeRange(scope: ExportScope): [number, number] | null {
  if (scope.kind === 'all') return null;
  if (scope.kind === 'year') {
    return [new Date(scope.year, 0, 1).getTime(), new Date(scope.year + 1, 0, 1).getTime()];
  }
  return [
    new Date(scope.year, scope.month, 1).getTime(),
    new Date(scope.year, scope.month + 1, 1).getTime(),
  ];
}

function deadlinesIn(scope: ExportScope, tasks: Task[]): Task[] {
  const range = scopeRange(scope);
  if (!range) return tasks;
  const within = (ms: number) => ms >= range[0] && ms < range[1];
  return tasks.filter((t) => within(t.due) || (t.completedAt != null && within(t.completedAt)));
}

/** Damaged months keep what could be read; unreadable ones are named in `skipped` */
export function buildExport(source: ExportSource, scope: ExportScope, now: number): ExportFile {
  const months: ExportedMonth[] = [];
  const skipped: string[] = [];
  const ordered = [...source.months].sort((a, b) => a.year - b.year || a.month - b.month);
  for (const { year, month, read } of ordered) {
    if (!inScope(scope, year, month)) continue;
    const key = monthKey(year, month);
    if (read.status === 'complete') months.push({ month: key, data: read.data });
    else if (read.status === 'partial') {
      months.push({ month: key, data: read.data, damaged: read.lost });
    }
    else if (read.status === 'unreadable') skipped.push(key);
  }

  const { tasks } = source;
  const all = tasks.status === 'complete' || tasks.status === 'partial' ? tasks.data : [];
  const damaged =
    tasks.status === 'partial' ? tasks.lost : tasks.status === 'unreadable' ? 'unreadable' : null;

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    scope: scopeKey(scope),
    months,
    skipped,
    deadlines: deadlinesIn(scope, all),
    ...(damaged && { deadlinesDamaged: damaged }),
    ...(source.settings && { settings: source.settings }),
  };
}

export function exportJson(file: ExportFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

const STATUS: Record<CellState, string> = { 0: '', 1: 'done', 2: 'missed' };

/** RFC 4180: quoted only when it has to be, with inner quotes doubled */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** One row per habit per day; the BOM is what makes Excel read it as UTF-8 */
export function exportCsv(file: ExportFile): string {
  const rows = [['date', 'habit', 'status']];
  for (const { month, data } of file.months) {
    const [year, m] = month.split('-').map(Number);
    for (let day = 1; day <= monthLength(year, m - 1); day++) {
      for (const habit of data.habits) {
        const state = data.grid[cellKey(day, habit.id)] ?? 0;
        rows.push([`${month}-${pad(day)}`, habit.name.trim() || 'Untitled habit', STATUS[state]]);
      }
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** What the preview card lists: what the file holds, and what could not be read */
export function exportSummary(
  file: ExportFile,
  format: ExportFormat
): { lines: string[]; damage: string | null } {
  const months = counted(file.months.length, 'month');
  let rows = 0;
  for (const { month, data } of file.months) {
    const [year, m] = month.split('-').map(Number);
    rows += monthLength(year, m - 1) * data.habits.length;
  }
  const lines =
    format === 'json'
      ? [
          `${months} · ${counted(file.deadlines.length, 'deadline')}`,
          ...(file.settings ? ['settings and quotes'] : []),
        ]
      : [`${counted(rows, 'row')} · ${months}`, 'one per habit per day'];
  const hurt = file.months.filter((m) => m.damaged).length + file.skipped.length;
  const deadlines = format === 'json' && !!file.deadlinesDamaged;
  const what = [hurt ? counted(hurt, 'month') : null, deadlines ? 'the deadlines' : null]
    .filter((x): x is string => x !== null)
    .join(' and ');
  const damage = what ? `${what[0].toUpperCase()}${what.slice(1)} not fully readable` : null;
  return { lines, damage };
}

export function exportFileName(scope: ExportScope, format: ExportFormat, now: number): string {
  const d = new Date(now);
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `rin-${scope.kind === 'all' ? `all-${today}` : scopeKey(scope)}.${format}`;
}

/** "March 2026" */
function monthName(year: number, month: number): string {
  const name = MONTH_NAMES[month];
  return `${name[0]}${name.slice(1).toLowerCase()} ${year}`;
}

function monthTitle(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return monthName(year, month - 1);
}

/** "March 2026", "2026" or "Everything" */
export function scopeTitle(scope: ExportScope): string {
  if (scope.kind === 'month') return monthName(scope.year, scope.month);
  return scope.kind === 'year' ? String(scope.year) : 'Everything';
}

function listed(names: string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The body of the confirmation shown before the file is made */
export function exportNotice(file: ExportFile, format: ExportFormat): string {
  const lines = [
    'Anyone who gets it can read everything in it. Rin uploads nothing: ' +
      'the file goes only where you send it.',
  ];
  const partial = file.months.filter((m) => m.damaged).map((m) => monthTitle(m.month));
  if (partial.length) {
    const what = listed(partial);
    lines.push(`${what} could not be read in full, so the file has only the part that could.`);
  }
  if (file.skipped.length) {
    const verb = file.skipped.length === 1 ? 'is' : 'are';
    const what = listed(file.skipped.map(monthTitle));
    lines.push(`${what} could not be read at all and ${verb} left out.`);
  }
  if (format === 'json' && file.deadlinesDamaged) {
    lines.push(
      file.deadlinesDamaged === 'unreadable'
        ? 'Your deadlines could not be read, so none are in the file.'
        : 'Some deadlines could not be read and are left out.'
    );
  }
  return lines.join('\n\n');
}

/** Reads the store for one export; a listing that fails is an error rather than an empty file */
export async function gatherExport(scope: ExportScope, now = Date.now()): Promise<ExportFile> {
  const stored = await readStoredMonths();
  if (!stored) throw new Error('The months could not be listed');
  const wanted = stored.filter((m) => inScope(scope, m.year, m.month));
  const [months, tasks, settings] = await Promise.all([
    Promise.all(wanted.map(async (m) => ({ ...m, read: await readMonthVouched(m.year, m.month) }))),
    readTasksVouched(),
    loadSettings(),
  ]);
  return buildExport({ months, tasks, settings }, scope, now);
}
