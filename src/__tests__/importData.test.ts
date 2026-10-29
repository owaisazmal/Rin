import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildExport, exportJson } from '../exportData';
import type { ExportSource } from '../exportData';
import {
  ImportFile,
  applyImport,
  applySettings,
  importDoneText,
  importNotice,
  importSummary,
  mergeMonth,
  monthList,
  monthToSave,
  newQuotes,
  planDeadlines,
  planImport,
  planMonth,
  readImport,
  refusalText,
} from '../importData';
import { defaultLayout } from '../layout';
import { MAX_CUSTOM_QUOTES } from '../quotes';
import { defaultNotifications } from '../settings';
import type { Settings } from '../settings';
import type { VouchedRead } from '../storage';
import { clearUnvouched, markDirty } from '../syncLedger';
import type { Task } from '../tasks';
import { MAX_HABITS, emptyMonthData } from '../types';
import type { MonthData } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), multiSet: jest.fn() },
}));

jest.mock('../syncLedger', () => ({
  markDirty: jest.fn(async () => undefined),
  clearUnvouched: jest.fn(async () => undefined),
}));

const store = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

/** Backs the mock with a plain object, as a phone's store */
function phone(records: Record<string, unknown> = {}) {
  const held: Record<string, string> = {};
  for (const [key, value] of Object.entries(records)) {
    held[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  store.getItem.mockImplementation(async (key: string) => held[key] ?? null);
  store.multiSet.mockImplementation(async (pairs: readonly (readonly [string, string])[]) => {
    for (const [key, value] of pairs) held[key] = value;
  });
  return held;
}

const NOW = new Date(2026, 9, 22, 9, 30).getTime();
const blankGoals = () => emptyMonthData().keyGoals;

const october: MonthData = {
  habits: [
    { id: '0', name: 'Run' },
    { id: '1', name: 'Read' },
  ],
  grid: { '1:0': 1, '1:1': 2, '3:0': 1 },
  observations: ['Slept badly', ''],
  keyGoals: [{ text: 'Ship it', done: true }, ...blankGoals().slice(1)],
  cards: [{ id: 'c-abcd', title: 'Books', kind: 'list', items: [{ text: 'Dune', done: false }] }],
};

const september: MonthData = {
  habits: [{ id: '0', name: 'Run' }],
  grid: { '30:0': 2 },
  observations: ['', '', '', ''],
  keyGoals: blankGoals(),
};

const rent: Task = {
  id: '0',
  text: 'Pay rent',
  due: new Date(2026, 10, 1, 9).getTime(),
  done: false,
  repeat: { every: 'month', day: 1 },
};
const invoice: Task = {
  id: '1',
  text: 'Send the invoice',
  due: new Date(2026, 10, 2).getTime(),
  done: true,
  completedAt: new Date(2026, 9, 30).getTime(),
};

const settings: Settings = {
  theme: 'light',
  chart: 'weeks',
  layout: defaultLayout(),
  notifications: { ...defaultNotifications(), habits: false },
  quotes: { source: 'mine', custom: ['Keep going', 'Small steps'] },
};

function source(over: Partial<ExportSource> = {}): ExportSource {
  return {
    months: [
      { year: 2026, month: 9, read: { status: 'complete', data: october } },
      { year: 2026, month: 8, read: { status: 'complete', data: september } },
    ],
    tasks: { status: 'complete', data: [rent, invoice] },
    settings,
    ...over,
  };
}

const exported = (over: Partial<ExportSource> = {}) =>
  exportJson(buildExport(source(over), { kind: 'all' }, NOW));

function read(text: string): ImportFile {
  const result = readImport(text);
  if (!result.ok) throw new Error(`refused: ${result.refusal.reason}`);
  return result.file;
}

/** The file as JSON, changed by `edit`, for files the export would never make */
function tampered(edit: (raw: Record<string, any>) => void): string {
  const raw = JSON.parse(exported());
  edit(raw);
  return JSON.stringify(raw);
}

describe('readImport', () => {
  it('reads back exactly what was exported', () => {
    const file = read(exported());
    expect(file.months.map((m) => [m.key, m.year, m.month])).toEqual([
      ['2026-09', 2026, 8],
      ['2026-10', 2026, 9],
    ]);
    expect(file.months[1].data).toEqual(october);
    expect(file.months[0].data).toEqual(september);
    expect(file.deadlines).toEqual([rent, invoice]);
    expect(file.settings).toEqual(settings);
    expect(file.exportedAt).toBe(NOW);
  });

  it('refuses a file cut short anywhere', () => {
    const text = exported();
    for (const end of [0, 1, 40, Math.floor(text.length / 2), text.length - 3]) {
      expect(readImport(text.slice(0, end))).toEqual({
        ok: false,
        refusal: { reason: 'unreadable' },
      });
    }
  });

  it('refuses JSON that is not a Rin export', () => {
    for (const text of ['[]', '{"format":"other","version":1}', '"rin-export"', 'null']) {
      expect(readImport(text)).toEqual({ ok: false, refusal: { reason: 'foreign' } });
    }
    for (const version of [0, -1, 1.5, '1', null]) {
      const text = tampered((raw) => (raw.version = version));
      expect(readImport(text)).toEqual({ ok: false, refusal: { reason: 'foreign' } });
    }
  });

  it('refuses a newer format by name', () => {
    const text = tampered((raw) => (raw.version = 2));
    const result = readImport(text);
    expect(result).toEqual({ ok: false, refusal: { reason: 'newer', version: 2 } });
    if (result.ok) return;
    const { title, body } = refusalText(result.refusal);
    expect(title).toBe('Made by a newer Rin');
    expect(body).toContain('export format 2');
    expect(body).toContain('Update Rin');
  });

  it('names the part that fails its parser', () => {
    const cases: [(raw: Record<string, any>) => void, string][] = [
      [(raw) => (raw.months[1].data.grid = []), 'October 2026'],
      [(raw) => (raw.months[0].data.habits = [{ id: 0 }]), 'September 2026'],
      [(raw) => (raw.months[0].data = 'gone'), 'September 2026'],
      [(raw) => raw.deadlines.push({ id: '9', text: 'no due date', done: false }), 'the deadlines'],
      [(raw) => delete raw.deadlines, 'the deadlines'],
      [(raw) => (raw.settings = []), 'the settings'],
      [(raw) => (raw.months = {}), 'the month list'],
      [(raw) => (raw.months[0].month = '2026-13'), 'the month list'],
      [(raw) => (raw.months[0].month = raw.months[1].month), 'the month list'],
    ];
    for (const [edit, part] of cases) {
      expect(readImport(tampered(edit))).toEqual({
        ok: false,
        refusal: { reason: 'damaged', part },
      });
    }
    expect(refusalText({ reason: 'damaged', part: 'the deadlines' }).body).toBe(
      'The deadlines could not be read in full, so nothing was imported.'
    );
  });

  it('takes a saved BOM and a file without settings', () => {
    const file = read(`﻿${exported({ settings: undefined })}`);
    expect(file.settings).toBeNull();
    expect(file.months).toHaveLength(2);
  });

  it('keeps what the exporting phone could not read', () => {
    const file = read(
      exported({
        months: [
          { year: 2026, month: 9, read: { status: 'partial', data: october, lost: '1 of 3 habits' } },
          { year: 2026, month: 8, read: { status: 'unreadable' } },
        ],
        tasks: { status: 'partial', data: [rent], lost: '1 of 2 deadlines' },
      })
    );
    expect(file.months.map((m) => [m.key, m.damaged])).toEqual([['2026-10', true]]);
    expect(file.skipped).toEqual(['2026-09']);
    expect(importSummary(file)).toEqual({
      line: '1 month · 1 deadline',
      made: 'Exported 22 Oct 2026',
      damage: '2 months and the deadlines not fully readable when exported',
    });
  });
});

describe('planMonth', () => {
  const [sep, oct] = read(exported()).months;

  it('treats a month stored here with nothing in it as new', () => {
    expect(planMonth(oct, { status: 'absent' }).status).toBe('new');
    expect(planMonth(oct, { status: 'complete', data: emptyMonthData() }).status).toBe('new');
  });

  it('sees the same month whatever order its marks were made in', () => {
    const reordered = { ...october, grid: { '3:0': 1, '1:1': 2, '1:0': 1 } } as MonthData;
    expect(planMonth(oct, { status: 'complete', data: reordered }).status).toBe('same');
  });

  it('offers a merge only over a copy read in full', () => {
    const clash = planMonth(sep, { status: 'complete', data: { ...september, grid: {} } });
    expect(clash).toMatchObject({ status: 'clash', damagedHere: false });
    expect(clash.merged?.data.grid).toEqual({ '30:0': 2 });

    for (const here of [
      { status: 'partial', data: september, lost: '1 of 2 habits' } as const,
      { status: 'unreadable' } as const,
    ]) {
      expect(planMonth(sep, here)).toEqual({
        key: '2026-09',
        status: 'clash',
        damagedHere: true,
        merged: null,
      });
    }
  });
});

describe('monthToSave', () => {
  const [sep] = read(exported()).months;
  const mine: MonthData = { ...september, grid: { '1:0': 1 } };
  const clash = planMonth(sep, { status: 'complete', data: mine });

  it('never writes over a clash without a choice', () => {
    expect(monthToSave(clash, sep, undefined)).toBeNull();
    expect(monthToSave(clash, sep, 'skip')).toBeNull();
  });

  it('writes the file, or the merge, as chosen', () => {
    expect(monthToSave(clash, sep, 'replace')).toEqual(september);
    expect(monthToSave(clash, sep, 'mine')?.grid).toEqual({ '1:0': 1, '30:0': 2 });
  });

  it('has nothing to keep when this copy is damaged or already holds it all', () => {
    const damaged = planMonth(sep, { status: 'unreadable' });
    expect(monthToSave(damaged, sep, 'mine')).toBeNull();
    expect(monthToSave(damaged, sep, 'replace')).toEqual(september);

    const superset = { ...september, grid: { '30:0': 2, '2:0': 1 } } as MonthData;
    const covered = planMonth(sep, { status: 'complete', data: superset });
    expect(covered.merged?.adds).toBe(false);
    expect(monthToSave(covered, sep, 'mine')).toBeNull();
  });

  it('writes a new month as it is', () => {
    expect(monthToSave(planMonth(sep, { status: 'absent' }), sep, undefined)).toEqual(september);
  });
});

describe('mergeMonth', () => {
  it('matches habits by name and moves their marks onto empty cells only', () => {
    const mine: MonthData = {
      ...emptyMonthData(),
      habits: [
        { id: '0', name: 'Read' },
        { id: '1', name: 'Walk' },
      ],
      grid: { '1:0': 1 },
    };
    const theirs: MonthData = {
      ...emptyMonthData(),
      habits: [
        { id: '0', name: 'run' },
        { id: '1', name: ' read ' },
      ],
      // day 1 of Read conflicts and the phone's mark wins
      grid: { '1:1': 2, '2:1': 1, '2:0': 2 },
    };
    const { data, left } = mergeMonth(mine, theirs);
    expect(data.habits).toEqual([
      { id: '0', name: 'Read' },
      { id: '1', name: 'Walk' },
      { id: '2', name: 'run' },
    ]);
    expect(data.grid).toEqual({ '1:0': 1, '2:0': 1, '2:2': 2 });
    expect(left).toBeNull();
  });

  it('keeps a free habit id and counts what has no room', () => {
    const ten = Array.from({ length: MAX_HABITS }, (_, i) => ({ id: String(i), name: `H${i}` }));
    const mine: MonthData = { ...emptyMonthData(), habits: ten.slice(0, 9) };
    const theirs: MonthData = {
      ...emptyMonthData(),
      habits: [
        { id: '7', name: 'Swim' },
        { id: '42', name: 'Stretch' },
      ],
      grid: { '5:7': 1, '5:42': 1 },
    };
    const { data, left } = mergeMonth(mine, theirs);
    expect(data.habits.slice(9)).toEqual([{ id: '9', name: 'Swim' }]);
    expect(data.grid).toEqual({ '5:9': 1 });
    expect(left).toBe('1 habit');
  });

  it('fills blank lines first, then appends, and keeps the phone’s wording', () => {
    const mine: MonthData = {
      ...emptyMonthData(),
      observations: ['Tired', '', 'Busy week'],
      keyGoals: [{ text: 'Ship', done: false }, ...blankGoals().slice(1)],
    };
    const theirs: MonthData = {
      ...emptyMonthData(),
      observations: ['tired', 'New job', '', 'Moved'],
      keyGoals: [
        { text: 'SHIP', done: true },
        { text: 'Rest', done: false },
        { text: '', done: false },
      ],
    };
    const { data } = mergeMonth(mine, theirs);
    expect(data.observations).toEqual(['Tired', 'New job', 'Busy week', 'Moved']);
    expect(data.keyGoals).toEqual([
      { text: 'Ship', done: false },
      { text: 'Rest', done: false },
      { text: '', done: false },
    ]);
  });

  it('merges cards by id and adds the ones this phone lacks', () => {
    const mine: MonthData = {
      ...emptyMonthData(),
      cards: [{ id: 'c-abcd', title: 'Books', kind: 'list', items: [{ text: 'Dune', done: false }] }],
    };
    const theirs: MonthData = {
      ...emptyMonthData(),
      cards: [
        {
          id: 'c-abcd',
          title: 'Reading',
          kind: 'list',
          items: [
            { text: 'dune', done: true },
            { text: 'Emma', done: false },
          ],
        },
        { id: 'c-wxyz', title: 'Note', kind: 'note', items: [{ text: 'Hi', done: false }] },
      ],
    };
    const { data } = mergeMonth(mine, theirs);
    expect(data.cards).toEqual([
      {
        id: 'c-abcd',
        title: 'Books',
        kind: 'list',
        items: [
          { text: 'Dune', done: false },
          { text: 'Emma', done: false },
        ],
      },
      theirs.cards![1],
    ]);
  });

  it('remembers habits cleared on purpose only while there are none', () => {
    const cleared: MonthData = { ...emptyMonthData(), habitsCleared: true };
    expect(mergeMonth(cleared, emptyMonthData()).data.habitsCleared).toBe(true);
    expect(mergeMonth(cleared, september).data).not.toHaveProperty('habitsCleared');
  });
});

describe('planDeadlines', () => {
  it('skips copies one for one and keeps free ids', () => {
    const plan = planDeadlines({ status: 'complete', data: [rent] }, [rent, rent, invoice]);
    expect(plan.already).toBe(1);
    expect(plan.add).toEqual([
      { ...rent, id: '1' },
      { ...invoice, id: '2' },
    ]);
    expect(plan.blocked).toBe(false);
  });

  it('keeps every id on a phone with no deadlines', () => {
    const plan = planDeadlines({ status: 'absent' }, [invoice, rent]);
    expect(plan.add).toEqual([invoice, rent]);
  });

  it('tells a different deadline from a copy', () => {
    const moved = { ...rent, due: rent.due + 1 };
    const weekly = { ...rent, repeat: { every: 'week' as const } };
    const plan = planDeadlines({ status: 'complete', data: [rent] }, [moved, weekly]);
    expect(plan.already).toBe(0);
    expect(plan.add.map((t) => t.id)).toEqual(['1', '2']);
  });

  it('adds nothing to a list this phone cannot read whole', () => {
    const reads: VouchedRead<Task[]>[] = [
      { status: 'partial', data: [rent], lost: '1 of 2 deadlines' },
      { status: 'unreadable' },
    ];
    for (const here of reads) {
      expect(planDeadlines(here, [invoice])).toEqual({ add: [], already: 0, blocked: true });
    }
  });
});

describe('settings and quotes', () => {
  const here: Settings = {
    theme: 'dark',
    chart: 'radial',
    layout: defaultLayout(),
    notifications: defaultNotifications(),
    quotes: { source: 'builtin', custom: [] },
  };

  it('changes nothing unless asked', () => {
    expect(applySettings(here, settings, { settings: false, quotes: false })).toBe(here);
  });

  it('takes the file’s settings without its quotes', () => {
    const next = applySettings(here, settings, { settings: true, quotes: false });
    expect(next).toEqual({ ...settings, quotes: { source: 'mine', custom: [] } });
  });

  it('adds quotes this phone lacks, and lets first ones show', () => {
    const next = applySettings(here, settings, { settings: false, quotes: true });
    expect(next.quotes).toEqual({ source: 'both', custom: ['Keep going', 'Small steps'] });
    expect(next.theme).toBe('dark');

    const own = { ...here, quotes: { source: 'builtin' as const, custom: ['small STEPS'] } };
    expect(applySettings(own, settings, { settings: false, quotes: true }).quotes).toEqual({
      source: 'builtin',
      custom: ['small STEPS', 'Keep going'],
    });
  });

  it('stops at the most Rin keeps', () => {
    const full = Array.from({ length: MAX_CUSTOM_QUOTES - 1 }, (_, i) => `Quote ${i}`);
    expect(newQuotes({ source: 'mine', custom: full }, settings.quotes)).toEqual(['Keep going']);
  });
});

describe('wording', () => {
  it('lists months by year', () => {
    expect(monthList(['2026-03', '2026-04', '2027-01'])).toBe('March, April 2026 and January 2027');
    expect(monthList(['2026-10'])).toBe('October 2026');
  });

  it('says what was saved', () => {
    const none = { settings: false, quotes: false };
    expect(importDoneText({ months: 2, deadlines: 1 }, none, 'phone')).toBe(
      'Saved 2 months and 1 deadline from the file on this phone.'
    );
    expect(importDoneText({ months: 0, deadlines: 0 }, { settings: true, quotes: true }, 'iPad')).toBe(
      'Saved the settings and the quotes from the file on this iPad.'
    );
    expect(importDoneText({ months: 0, deadlines: 0 }, none, 'phone')).toBe(
      'This phone already had everything in the file.'
    );
  });

  it('sums up what the import will do, or says it does nothing', () => {
    const file = read(exported());
    const plan = planImport(file, {
      months: {
        '2026-09': { status: 'absent' },
        '2026-10': { status: 'complete', data: { ...october, grid: {} } },
      },
      tasks: { status: 'complete', data: [rent] },
    });
    const none = { settings: false, quotes: false };
    expect(importNotice(file, plan, {}, none)).toBe(
      'Adds 1 month and 1 deadline.\n\nThis cannot be undone.'
    );
    expect(importNotice(file, plan, { '2026-10': 'mine' }, none)).toBe(
      'Adds 1 month and 1 deadline.\nMerges 1 month into yours.\n\nThis cannot be undone.'
    );
    expect(importNotice(file, plan, { '2026-10': 'replace' }, { settings: true, quotes: true })).toBe(
      'Adds 1 month, 1 deadline and the file’s quotes.\n' +
        'Replaces 1 month and your settings with the file’s.\n\nThis cannot be undone.'
    );

    const same = planImport(file, {
      months: {
        '2026-09': { status: 'complete', data: september },
        '2026-10': { status: 'complete', data: october },
      },
      tasks: { status: 'complete', data: [rent, invoice] },
    });
    expect(importNotice(file, same, {}, none)).toBeNull();
  });
});

describe('applyImport', () => {
  it('reproduces the export on a clean install, in one write', async () => {
    const held = phone();
    const result = await applyImport(read(exported()), {});
    expect(result).toEqual({ months: 2, deadlines: 2 });
    expect(store.multiSet).toHaveBeenCalledTimes(1);
    expect(JSON.parse(held['@monthly-planning/2026-10'])).toEqual(october);
    expect(JSON.parse(held['@monthly-planning/2026-09'])).toEqual(september);
    expect(JSON.parse(held['@monthly-planning/tasks'])).toEqual([rent, invoice]);
    // and what was written exports to the same file again
    const again = buildExport(
      {
        months: [
          { year: 2026, month: 9, read: { status: 'complete', data: JSON.parse(held['@monthly-planning/2026-10']) } },
          { year: 2026, month: 8, read: { status: 'complete', data: JSON.parse(held['@monthly-planning/2026-09']) } },
        ],
        tasks: { status: 'complete', data: JSON.parse(held['@monthly-planning/tasks']) },
        settings,
      },
      { kind: 'all' },
      NOW
    );
    expect(exportJson(again)).toBe(exported());
  });

  it('tells the backup about every record it wrote', async () => {
    phone({ '@monthly-planning/tasks': [rent] });
    await applyImport(read(exported()), {});
    const dirty = (markDirty as jest.Mock).mock.calls.map(([key]) => key);
    // the finished invoice files under the year it was finished
    expect(dirty).toEqual(['2026-09', '2026-10', 'current', '2026']);
    expect((clearUnvouched as jest.Mock).mock.calls.map(([key]) => key)).toEqual([
      '2026-09',
      '2026-10',
    ]);
  });

  it('leaves a month alone that gained data after the preview', async () => {
    const held = phone({ '@monthly-planning/2026-10': { ...october, grid: {} } });
    // the preview saw only October here, so September had no choice to make
    const result = await applyImport(read(exported()), { '2026-10': 'skip' });
    expect(result.months).toBe(1);
    expect(JSON.parse(held['@monthly-planning/2026-10'])).toEqual({ ...october, grid: {} });

    phone({ '@monthly-planning/2026-09': { ...september, grid: { '2:0': 1 } } });
    const later = await applyImport(read(exported()), { '2026-10': 'replace' });
    expect(later.months).toBe(1);
  });

  it('writes nothing, and tells nobody, when the file adds nothing', async () => {
    phone({
      '@monthly-planning/2026-09': september,
      '@monthly-planning/2026-10': october,
      '@monthly-planning/tasks': [rent, invoice],
    });
    expect(await applyImport(read(exported()), {})).toEqual({ months: 0, deadlines: 0 });
    expect(store.multiSet).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();
  });

  it('leaves the ledger alone when the write fails', async () => {
    phone();
    store.multiSet.mockRejectedValueOnce(new Error('disk full'));
    await expect(applyImport(read(exported()), {})).rejects.toThrow('disk full');
    expect(markDirty).not.toHaveBeenCalled();
  });
});
