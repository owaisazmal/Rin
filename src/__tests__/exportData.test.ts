import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  EXPORT_VERSION,
  ExportFile,
  ExportSource,
  buildExport,
  exportCsv,
  exportFileName,
  exportJson,
  exportNotice,
  gatherExport,
  scopeTitle,
} from '../exportData';
import { defaultLayout, parseLayout } from '../layout';
import { parseQuotePrefs } from '../quotes';
import { defaultNotifications, parseNotifications } from '../settings';
import type { Settings } from '../settings';
import { vouchMonthValue } from '../storage';
import { vouchTasksValue } from '../tasks';
import type { Task } from '../tasks';
import type { MonthData } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), getAllKeys: jest.fn() },
}));

const store = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

const NOW = new Date(2026, 9, 22, 9, 30).getTime();

const october: MonthData = {
  habits: [
    { id: '0', name: 'Run' },
    { id: '1', name: 'Read, then "sleep"' },
  ],
  grid: { '1:0': 1, '1:1': 2, '3:0': 1 },
  observations: ['Slept badly', ''],
  keyGoals: [
    { text: 'Ship it', done: true },
    { text: '', done: false },
    { text: '', done: false },
  ],
  cards: [{ id: 'c-abcd', title: 'Books', kind: 'list', items: [{ text: 'Dune', done: false }] }],
};

const september: MonthData = {
  habits: [{ id: '0', name: 'Run' }],
  grid: { '30:0': 2 },
  observations: ['', '', '', ''],
  keyGoals: october.keyGoals.map(() => ({ text: '', done: false })),
};

const rent: Task = {
  id: '0',
  text: 'Pay rent',
  due: new Date(2026, 10, 1, 9).getTime(),
  done: false,
  repeat: { every: 'month', day: 1 },
};
// due in November, ticked off in October
const invoice: Task = {
  id: '1',
  text: 'Send the invoice',
  due: new Date(2026, 10, 2).getTime(),
  done: true,
  completedAt: new Date(2026, 9, 30).getTime(),
};
const taxes: Task = { id: '2', text: 'Taxes', due: new Date(2025, 3, 15).getTime(), done: false };

function source(over: Partial<ExportSource> = {}): ExportSource {
  return {
    months: [
      { year: 2026, month: 9, read: { status: 'complete', data: october } },
      { year: 2026, month: 8, read: { status: 'complete', data: september } },
    ],
    tasks: { status: 'complete', data: [rent, invoice, taxes] },
    ...over,
  };
}

describe('buildExport', () => {
  it('carries the format and version the import checks first', () => {
    const file = buildExport(source(), { kind: 'all' }, NOW);
    expect(file.format).toBe('rin-export');
    expect(file.version).toBe(EXPORT_VERSION);
    expect(file.exportedAt).toBe(new Date(NOW).toISOString());
    expect(file.scope).toBe('all');
  });

  it('lists months oldest first under the names the backup uses', () => {
    const file = buildExport(source(), { kind: 'all' }, NOW);
    expect(file.months.map((m) => m.month)).toEqual(['2026-09', '2026-10']);
    expect(file.months[1].data).toEqual(october);
  });

  it('keeps one month, or one year, and nothing outside it', () => {
    const month = buildExport(source(), { kind: 'month', year: 2026, month: 8 }, NOW);
    expect(month.scope).toBe('2026-09');
    expect(month.months.map((m) => m.month)).toEqual(['2026-09']);

    const year = buildExport(source(), { kind: 'year', year: 2025 }, NOW);
    expect(year.scope).toBe('2025');
    expect(year.months).toEqual([]);
    expect(year.deadlines).toEqual([taxes]);
  });

  it('takes deadlines due in the scope or finished in it, rule and all', () => {
    const october26 = buildExport(source(), { kind: 'month', year: 2026, month: 9 }, NOW);
    expect(october26.deadlines).toEqual([invoice]);
    const november = buildExport(source(), { kind: 'month', year: 2026, month: 10 }, NOW);
    expect(november.deadlines).toEqual([rent, invoice]);
    expect(november.deadlines[0].repeat).toEqual({ every: 'month', day: 1 });
  });

  it('exports what a damaged month still holds and says what it lost', () => {
    const file = buildExport(
      source({
        months: [
          {
            year: 2026,
            month: 9,
            read: { status: 'partial', data: october, lost: '1 of 3 habits' },
          },
          { year: 2026, month: 8, read: { status: 'unreadable' } },
          { year: 2026, month: 7, read: { status: 'absent' } },
        ],
      }),
      { kind: 'all' },
      NOW
    );
    expect(file.months).toEqual([{ month: '2026-10', data: october, damaged: '1 of 3 habits' }]);
    expect(file.skipped).toEqual(['2026-09']);
  });

  it('marks a deadline list that could not be read in full', () => {
    const partial = buildExport(
      source({ tasks: { status: 'partial', data: [taxes], lost: '1 of 2 deadlines' } }),
      { kind: 'all' },
      NOW
    );
    expect(partial.deadlines).toEqual([taxes]);
    expect(partial.deadlinesDamaged).toBe('1 of 2 deadlines');

    const unreadable = buildExport(
      source({ tasks: { status: 'unreadable' } }),
      { kind: 'all' },
      NOW
    );
    expect(unreadable.deadlines).toEqual([]);
    expect(unreadable.deadlinesDamaged).toBe('unreadable');

    const none = buildExport(source({ tasks: { status: 'absent' } }), { kind: 'all' }, NOW);
    expect(none.deadlines).toEqual([]);
    expect(none).not.toHaveProperty('deadlinesDamaged');
  });
});

describe('exportJson', () => {
  const file = buildExport(source(), { kind: 'month', year: 2026, month: 8 }, NOW);

  it('writes this exact shape, which the import will rely on', () => {
    expect(exportJson(file)).toBe(
      [
        '{',
        '  "format": "rin-export",',
        '  "version": 1,',
        `  "exportedAt": "${new Date(NOW).toISOString()}",`,
        '  "scope": "2026-09",',
        '  "months": [',
        '    {',
        '      "month": "2026-09",',
        '      "data": {',
        '        "habits": [',
        '          {',
        '            "id": "0",',
        '            "name": "Run"',
        '          }',
        '        ],',
        '        "grid": {',
        '          "30:0": 2',
        '        },',
        '        "observations": [',
        '          "",',
        '          "",',
        '          "",',
        '          ""',
        '        ],',
        '        "keyGoals": [',
        '          {',
        '            "text": "",',
        '            "done": false',
        '          },',
        '          {',
        '            "text": "",',
        '            "done": false',
        '          },',
        '          {',
        '            "text": "",',
        '            "done": false',
        '          }',
        '        ]',
        '      }',
        '    }',
        '  ],',
        '  "skipped": [],',
        '  "deadlines": []',
        '}',
        '',
      ].join('\n')
    );
  });

  it('reads back through the app’s own parsers with nothing lost', () => {
    const all = buildExport(source(), { kind: 'all' }, NOW);
    const back = JSON.parse(exportJson(all)) as ExportFile;
    expect(back).toEqual(all);
    for (const { data } of back.months) {
      expect(vouchMonthValue(data)).toEqual({ status: 'complete', data });
    }
    expect(vouchTasksValue(back.deadlines)).toEqual({
      status: 'complete',
      data: [rent, invoice, taxes],
    });
  });
});

describe('the settings block', () => {
  const settings: Settings = {
    theme: 'system',
    chart: 'github',
    layout: {
      ...defaultLayout(),
      slots: [
        ...defaultLayout().slots,
        { id: 'c-abcd', shown: true, custom: { title: 'Books', kind: 'list' } },
      ],
    },
    notifications: { ...defaultNotifications(), slots: [{ on: true, hour: 7, minute: 15 }] },
    quotes: { source: 'mine', custom: ['Keep the streak honest.'] },
  };

  it('rides in the JSON whole and reads back through the settings parsers', () => {
    const file = buildExport(source({ settings }), { kind: 'month', year: 2026, month: 9 }, NOW);
    const back = JSON.parse(exportJson(file)) as ExportFile;
    expect(back.settings).toEqual(settings);
    expect(parseLayout(back.settings!.layout)).toEqual(settings.layout);
    expect(parseNotifications(back.settings!.notifications)).toEqual(settings.notifications);
    expect(parseQuotePrefs(back.settings!.quotes)).toEqual(settings.quotes);
  });

  it('is left out of the file when there is none, and never reaches the CSV', () => {
    const without = buildExport(source(), { kind: 'all' }, NOW);
    expect(without).not.toHaveProperty('settings');
    const csv = exportCsv(buildExport(source({ settings }), { kind: 'all' }, NOW));
    expect(csv).toBe(exportCsv(without));
    expect(csv).not.toContain('streak');
  });
});

describe('exportCsv', () => {
  const file = buildExport(source(), { kind: 'all' }, NOW);
  const csv = exportCsv(file);
  const rows = csv.replace(/^﻿/, '').split('\r\n');

  it('starts with a BOM and a header, and ends every row with CRLF', () => {
    expect(csv.startsWith('﻿date,habit,status\r\n')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/\n/);
  });

  it('has one row per habit per day', () => {
    // September: 30 days, one habit; October: 31 days, two habits
    expect(rows.length - 2).toBe(30 + 31 * 2);
  });

  it('writes the marks as words and quotes what needs quoting', () => {
    expect(rows).toContain('2026-09-30,Run,missed');
    expect(rows).toContain('2026-10-01,Run,done');
    expect(rows).toContain('2026-10-01,"Read, then ""sleep""",missed');
    expect(rows).toContain('2026-10-02,Run,');
    expect(rows.slice(1, 3)).toEqual(['2026-09-01,Run,', '2026-09-02,Run,']);
  });

  it('names a habit with no name, and puts a line break inside quotes', () => {
    const month: MonthData = {
      ...september,
      habits: [
        { id: '0', name: ' ' },
        { id: '1', name: 'Two\nlines' },
      ],
      grid: {},
    };
    const out = exportCsv(
      buildExport(
        source({ months: [{ year: 2026, month: 1, read: { status: 'complete', data: month } }] }),
        { kind: 'all' },
        NOW
      )
    );
    expect(out).toContain('\r\n2026-02-01,Untitled habit,\r\n2026-02-01,"Two\nlines",\r\n');
    expect(out).toContain('\r\n2026-02-28,"Two\nlines",\r\n');
    expect(out).not.toContain('2026-02-29');
  });
});

describe('exportFileName', () => {
  it('names the file after what is in it', () => {
    expect(exportFileName({ kind: 'month', year: 2026, month: 0 }, 'json', NOW)).toBe(
      'rin-2026-01.json'
    );
    expect(exportFileName({ kind: 'year', year: 2026 }, 'csv', NOW)).toBe('rin-2026.csv');
    expect(exportFileName({ kind: 'all' }, 'json', NOW)).toBe('rin-all-2026-10-22.json');
  });
});

describe('scopeTitle', () => {
  it('reads as the stepper shows it', () => {
    expect(scopeTitle({ kind: 'month', year: 2026, month: 2 })).toBe('March 2026');
    expect(scopeTitle({ kind: 'year', year: 2026 })).toBe('2026');
    expect(scopeTitle({ kind: 'all' })).toBe('Everything');
  });
});

describe('exportNotice', () => {
  const plain =
    'Anyone who gets it can read everything in it. Rin uploads nothing: ' +
    'the file goes only where you send it.';

  it('says who can read it and where it goes', () => {
    expect(exportNotice(buildExport(source(), { kind: 'all' }, NOW), 'json')).toBe(plain);
  });

  it('names damaged and unreadable months, and deadlines only when the file has them', () => {
    const file = buildExport(
      source({
        months: [
          {
            year: 2026,
            month: 2,
            read: { status: 'partial', data: september, lost: '1 grid entry' },
          },
          { year: 2026, month: 4, read: { status: 'unreadable' } },
          { year: 2026, month: 5, read: { status: 'unreadable' } },
        ],
        tasks: { status: 'partial', data: [], lost: '1 of 1 deadlines' },
      }),
      { kind: 'all' },
      NOW
    );
    const months = [
      plain,
      'March 2026 could not be read in full, so the file has only the part that could.',
      'May 2026 and June 2026 could not be read at all and are left out.',
    ];
    expect(exportNotice(file, 'csv')).toBe(months.join('\n\n'));
    expect(exportNotice(file, 'json')).toBe(
      [...months, 'Some deadlines could not be read and are left out.'].join('\n\n')
    );
    const lost = { ...file, months: [], skipped: ['2026-05'], deadlinesDamaged: 'unreadable' };
    expect(exportNotice(lost, 'json')).toBe(
      [
        plain,
        'May 2026 could not be read at all and is left out.',
        'Your deadlines could not be read, so none are in the file.',
      ].join('\n\n')
    );
  });
});

describe('gatherExport', () => {
  const disk: Record<string, string> = {
    '@monthly-planning/2026-09': JSON.stringify(september),
    '@monthly-planning/2026-10': JSON.stringify(october),
    '@monthly-planning/2025-04': '{not json',
    '@monthly-planning/tasks': JSON.stringify([rent, invoice, taxes]),
    '@monthly-planning/settings': JSON.stringify({
      theme: 'light',
      quotes: { source: 'both', custom: ['Keep the streak honest.'] },
    }),
  };

  beforeEach(() => {
    store.getAllKeys.mockResolvedValue(Object.keys(disk));
    store.getItem.mockImplementation(async (key: string) => disk[key] ?? null);
  });

  it('reads the stored months in scope and the deadline list', async () => {
    const file = await gatherExport({ kind: 'year', year: 2026 }, NOW);
    expect(file.months.map((m) => m.month)).toEqual(['2026-09', '2026-10']);
    expect(file.skipped).toEqual([]);
    expect(file.deadlines).toEqual([rent, invoice]);
    expect(store.getItem).not.toHaveBeenCalledWith('@monthly-planning/2025-04');
  });

  it('carries the stored settings, own quotes included', async () => {
    const file = await gatherExport({ kind: 'month', year: 2026, month: 9 }, NOW);
    expect(file.settings?.theme).toBe('light');
    expect(file.settings?.quotes).toEqual({ source: 'both', custom: ['Keep the streak honest.'] });
    expect(file.settings?.notifications).toEqual(defaultNotifications());
  });

  it('names a month that will not parse', async () => {
    const file = await gatherExport({ kind: 'all' }, NOW);
    expect(file.skipped).toEqual(['2025-04']);
    expect(file.months).toHaveLength(2);
  });

  it('fails rather than exporting nothing when the store will not list its months', async () => {
    store.getAllKeys.mockRejectedValue(new Error('locked'));
    await expect(gatherExport({ kind: 'all' }, NOW)).rejects.toThrow();
  });
});
