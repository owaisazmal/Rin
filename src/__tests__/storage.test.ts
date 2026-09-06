import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadMonth,
  loadMonthWindow,
  loadYearSummary,
  parseMonthData,
} from '../storage';
import { MAX_HABITS, emptyMonthData } from '../types';

/**
 * The parser is the guard between whatever is on disk — or, one day, whatever
 * a server sends — and everything that renders it. These feed it shapes the app
 * would never write and check that what comes out is always a month the rest
 * of the code can hold without crashing.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), multiGet: jest.fn() },
}));

const store = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

/** Puts arbitrary JSON on "disk", including shapes the app would never write */
function stored(value: unknown) {
  store.getItem.mockResolvedValue(JSON.stringify(value));
}

const valid = {
  habits: [
    { id: '0', name: 'Run' },
    { id: '1', name: 'Read' },
  ],
  grid: { '1:0': 1, '2:0': 2, '2:1': 1 },
  observations: ['Slept badly', ''],
  keyGoals: [
    { text: 'Ship it', done: true },
    { text: '', done: false },
    { text: '', done: false },
  ],
};

describe('parseMonthData', () => {
  it('passes a well-formed month through untouched', () => {
    expect(parseMonthData(valid)).toEqual(valid);
  });

  it.each([null, undefined, 'a string', 42, [], true])(
    'returns an empty month for %p',
    (raw) => {
      expect(parseMonthData(raw)).toEqual(emptyMonthData());
    }
  );

  describe('habits', () => {
    it('migrates the v1 fixed-slot string array', () => {
      expect(parseMonthData({ habits: ['Run', '', 'Read'] }).habits).toEqual([
        { id: '0', name: 'Run' },
        { id: '2', name: 'Read' },
      ]);
    });

    it('drops malformed entries and strips unknown fields', () => {
      const habits = [
        { id: '0', name: 'Run', colour: 'red' },
        { id: 1, name: 'numeric id' },
        { name: 'no id' },
        null,
        'stray',
      ];
      expect(parseMonthData({ habits }).habits).toEqual([{ id: '0', name: 'Run' }]);
    });

    it('keeps the first of two habits sharing an id', () => {
      const habits = [
        { id: '0', name: 'First' },
        { id: '0', name: 'Second' },
      ];
      expect(parseMonthData({ habits }).habits).toEqual([{ id: '0', name: 'First' }]);
    });

    it(`caps the list at ${MAX_HABITS}`, () => {
      const habits = Array.from({ length: MAX_HABITS + 5 }, (_, i) => ({
        id: String(i),
        name: `h${i}`,
      }));
      expect(parseMonthData({ habits }).habits).toHaveLength(MAX_HABITS);
    });
  });

  describe('grid', () => {
    it('keeps only real marks on known habits and plausible days', () => {
      const grid = {
        '1:0': 1, // kept
        '2:0': 0, // pending is the same as absent
        '3:0': 3, // not a state
        '4:0': '1', // not a number
        '5:9': 1, // no such habit
        '0:0': 1, // no such day
        '32:0': 2, // no such day
        abc: 1, // not a key
        ':0': 1, // no day at all
        '6:0': 2, // kept
      };
      expect(parseMonthData({ habits: [{ id: '0', name: 'Run' }], grid }).grid).toEqual({
        '1:0': 1,
        '6:0': 2,
      });
    });

    it('normalises a zero-padded day so it lines up with cellKey', () => {
      const data = parseMonthData({ habits: [{ id: '0', name: 'Run' }], grid: { '01:0': 1 } });
      expect(data.grid).toEqual({ '1:0': 1 });
    });

    it('tolerates a grid that is not an object', () => {
      const habits = [{ id: '0', name: 'Run' }];
      expect(parseMonthData({ habits, grid: [1, 2] }).grid).toEqual({});
      expect(parseMonthData({ habits, grid: 'nope' }).grid).toEqual({});
      expect(parseMonthData({ habits, grid: null }).grid).toEqual({});
    });
  });

  describe('observations', () => {
    it('drops anything that is not a string', () => {
      expect(parseMonthData({ observations: ['keep', 3, null, 'also'] }).observations).toEqual([
        'keep',
        'also',
      ]);
    });

    it('falls back to the blank lines when nothing usable is left', () => {
      const blank = emptyMonthData().observations;
      expect(parseMonthData({ observations: [1, 2] }).observations).toEqual(blank);
      expect(parseMonthData({ observations: 'text' }).observations).toEqual(blank);
      expect(parseMonthData({ observations: [] }).observations).toEqual(blank);
    });
  });

  describe('key goals', () => {
    it('never lets a non-string goal reach the code that trims it', () => {
      const data = parseMonthData({
        keyGoals: [{ text: 123, done: true }, { text: 'ok', done: 'yes' }, 'junk'],
      });
      expect(data.keyGoals).toEqual([
        { text: '', done: true },
        { text: 'ok', done: false },
        { text: '', done: false },
      ]);
      // the exact call that used to throw
      expect(() => data.keyGoals.map((g) => g.text.trim())).not.toThrow();
    });

    it('always yields exactly three', () => {
      expect(parseMonthData({ keyGoals: [{ text: 'one', done: false }] }).keyGoals).toHaveLength(3);
      const five = Array.from({ length: 5 }, () => ({ text: 'x', done: false }));
      expect(parseMonthData({ keyGoals: five }).keyGoals).toHaveLength(3);
      expect(parseMonthData({ keyGoals: 'none' }).keyGoals).toEqual(emptyMonthData().keyGoals);
    });
  });
});

describe('loadMonth', () => {
  it('reads a stored month back', async () => {
    stored(valid);
    await expect(loadMonth(2026, 8)).resolves.toEqual(valid);
    expect(store.getItem).toHaveBeenCalledWith('@monthly-planning/2026-09');
  });

  it('returns an empty month when nothing is stored', async () => {
    store.getItem.mockResolvedValue(null);
    await expect(loadMonth(2026, 8)).resolves.toEqual(emptyMonthData());
  });

  it('returns an empty month for unreadable JSON', async () => {
    store.getItem.mockResolvedValue('{not json');
    await expect(loadMonth(2026, 8)).resolves.toEqual(emptyMonthData());
  });

  it('returns an empty month when storage itself fails', async () => {
    store.getItem.mockRejectedValue(new Error('disk'));
    await expect(loadMonth(2026, 8)).resolves.toEqual(emptyMonthData());
  });
});

describe('loadMonthWindow', () => {
  it('parses each month on its own, so one bad record does not take the others down', async () => {
    store.multiGet.mockResolvedValue([
      ['@monthly-planning/2026-09', JSON.stringify(valid)],
      ['@monthly-planning/2026-08', '{broken'],
      ['@monthly-planning/2026-07', null],
    ]);
    const window = await loadMonthWindow(2026, 8, 3);
    expect(window.map((r) => [r.year, r.month])).toEqual([
      [2026, 8],
      [2026, 7],
      [2026, 6],
    ]);
    expect(window[0].data).toEqual(valid);
    expect(window[1].data).toEqual(emptyMonthData());
    expect(window[2].data).toEqual(emptyMonthData());
  });
});

describe('loadYearSummary', () => {
  it('tallies only the marks the parser accepted', async () => {
    const months: [string, string | null][] = Array.from({ length: 12 }, (_, m) => [
      `@monthly-planning/2026-${String(m + 1).padStart(2, '0')}`,
      null,
    ]);
    months[8][1] = JSON.stringify({
      habits: [
        { id: '0', name: 'Run' },
        { id: '1', name: 'Read' },
      ],
      grid: { '1:0': 1, '1:1': 2, '2:0': 1, '2:9': 1, '3:0': 'x' },
    });
    store.multiGet.mockResolvedValue(months);

    const summary = await loadYearSummary(2026);
    expect(summary).toHaveLength(12);
    expect(summary[8]).toEqual({
      habitCount: 2,
      tallies: { 1: { done: 1, missed: 1 }, 2: { done: 1, missed: 0 } },
    });
    expect(summary[0]).toEqual({ habitCount: 0, tallies: {} });
  });
});
