import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadMonth,
  loadMonthWindow,
  loadYearSummary,
  parseMonthData,
  readMonthForEditing,
  readMonthVouched,
  vouchMonthValue,
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

/**
 * Reading a month for the backup rather than for the screen.
 *
 * The planner is right to take whatever survived the parser and draw it. The
 * backup is not: what it sends replaces the only other copy that exists, so it
 * has to know the difference between a month that is empty and a month that
 * arrived thinner than it was written. These check both halves — that a real
 * loss is named, and, far more importantly, that the ordinary shapes the app
 * has written over the years still read as complete. A check that cried partial
 * over a v1 habit list or an absent notes key would quietly stop people backing
 * up at all.
 */
describe('readMonthVouched', () => {
  it('says absent when the month has never been written', async () => {
    store.getItem.mockResolvedValue(null);
    await expect(readMonthVouched(2026, 8)).resolves.toEqual({ status: 'absent' });
  });

  it('vouches for a well-formed month and hands back what it parsed', async () => {
    stored(valid);
    await expect(readMonthVouched(2026, 8)).resolves.toEqual({
      status: 'complete',
      data: valid,
    });
    expect(store.getItem).toHaveBeenCalledWith('@monthly-planning/2026-09');
  });

  it('reads the month exactly once', async () => {
    stored(valid);
    await readMonthVouched(2026, 8);
    expect(store.getItem).toHaveBeenCalledTimes(1);
  });

  it('says unreadable for bytes that are not JSON', async () => {
    store.getItem.mockResolvedValue('{not json');
    await expect(readMonthVouched(2026, 8)).resolves.toEqual({ status: 'unreadable' });
  });

  it('says unreadable when the store itself will not answer', async () => {
    store.getItem.mockRejectedValue(new Error('disk'));
    await expect(readMonthVouched(2026, 8)).resolves.toEqual({ status: 'unreadable' });
  });

  it.each([null, 'a string', 42, [], true])(
    'says unreadable, not partial, for a month stored as %p',
    async (raw) => {
      stored(raw);
      await expect(readMonthVouched(2026, 8)).resolves.toEqual({ status: 'unreadable' });
    }
  );

  it.each([
    { section: 'habits', month: { habits: 'nope' } },
    { section: 'grid', month: { grid: [1, 2] } },
    { section: 'observations', month: { observations: 'text' } },
    { section: 'keyGoals', month: { keyGoals: 'none' } },
    { section: 'a nulled habits list', month: { habits: null } },
  ])('says unreadable when $section is not the shape it should be', async ({ month }) => {
    stored(month);
    await expect(readMonthVouched(2026, 8)).resolves.toEqual({ status: 'unreadable' });
  });

  describe('what it calls partial', () => {
    it('reports habits lost to the cap', async () => {
      const habits = Array.from({ length: MAX_HABITS + 2 }, (_, i) => ({
        id: String(i),
        name: `h${i}`,
      }));
      stored({ habits });
      const read = await readMonthVouched(2026, 8);
      expect(read.status).toBe('partial');
      expect(read).toMatchObject({ lost: `2 of ${MAX_HABITS + 2} habits` });
    });

    it('reports a habit the parser could not make sense of', async () => {
      stored({ habits: [{ id: '0', name: 'Run' }, { name: 'no id' }] });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '1 of 2 habits',
      });
    });

    it('reports the loser of two habits sharing an id', async () => {
      stored({
        habits: [
          { id: '0', name: 'First' },
          { id: '0', name: 'Second' },
        ],
      });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '1 of 2 habits',
      });
    });

    it('reports marks the grid could not keep', async () => {
      stored({
        habits: [{ id: '0', name: 'Run' }],
        grid: { '1:0': 1, '5:9': 1, '40:0': 2, '3:0': '1' },
      });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '3 grid entries',
      });
    });

    it('reports one lost mark in the singular', async () => {
      stored({ habits: [{ id: '0', name: 'Run' }], grid: { '1:0': 1, '0:0': 1 } });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '1 grid entry',
      });
    });

    it('reports a mark on an id no modern habit list has', async () => {
      // the control for the v1 exemption below: in a record written the modern
      // way, a mark whose habit is not in the list means the habit went
      // missing, and that is real loss however ordinary the cell looks
      stored({ habits: [{ id: '0', name: 'Run' }], grid: { '1:0': 1, '2:1': 1 } });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '1 grid entry',
      });
    });

    it('reports a mark stranded on a v1 slot that still has its name', async () => {
      // slot 0 was typed into, so nothing about this cell is explained by the
      // migration: day 40 is damage, and an empty slot elsewhere in the array
      // does not excuse it
      stored({ habits: ['Run', ''], grid: { '40:0': 1 } });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '1 grid entry',
      });
    });

    it('reports a v1 mark on a slot index the array never had', async () => {
      // slot 1 really was emptied, so this record has an exemption to make —
      // but slot 5 was never there to empty, and a mark on it is loss like any
      // other. Being a v1 record is not on its own a licence to stop counting
      // what the grid could not keep.
      stored({ habits: ['Run', '', 'Read'], grid: { '1:0': 1, '3:5': 1 } });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '1 grid entry',
      });
    });

    it('reports a mark on an empty v1 slot that is also on an impossible day', async () => {
      // the exemption covers exactly what the parser would have kept had the
      // slot still held a name. v1 never wrote a fortieth of the month, so this
      // cell is damaged in its own right and stays counted.
      stored({ habits: ['Run', ''], grid: { '40:1': 1 } });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '1 grid entry',
      });
    });

    it('reports a v1 cell whose value was never a mark', async () => {
      stored({ habits: ['Run', ''], grid: { '1:1': 3 } });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '1 grid entry',
      });
    });

    it('reports marks belonging to named v1 slots that fell off the end of the cap', async () => {
      // those slots were typed into and their names are counted as lost, so
      // their marks are lost too — the exemption turns on the slot being
      // *empty*, not merely on its id being absent from the parsed list
      const names = Array.from({ length: MAX_HABITS + 2 }, (_, i) => `h${i}`);
      stored({ habits: names, grid: { '1:0': 1, [`2:${MAX_HABITS}`]: 1 } });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: `2 of ${MAX_HABITS + 2} habits, 1 grid entry`,
      });
    });

    it('reports notes that were not strings', async () => {
      stored({ observations: ['keep', 3, null, 'also'] });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '2 of 4 notes',
      });
    });

    it('reports notes even when none of them survived', async () => {
      // the parser substitutes its four blank lines here, so the answer is
      // longer than what was on disk and comparing lengths would miss the loss
      stored({ observations: [1, 2] });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '2 of 2 notes',
      });
    });

    it('reports goals past the third', async () => {
      const five = Array.from({ length: 5 }, (_, i) => ({ text: `g${i}`, done: false }));
      stored({ keyGoals: five });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '2 of 5 goals',
      });
    });

    it('reports a goal whose text was blanked on the way out', async () => {
      stored({
        keyGoals: [{ text: 123, done: true }, { text: 'ok', done: false }, 'junk'],
      });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '2 of 3 goals',
      });
    });

    it('reports a goal whose tick was blanked on the way out', async () => {
      // `parseKeyGoals` writes `done === true`, so anything else at all comes
      // back unticked. Nothing about that looks like a discarded value — the
      // goal is still there, with its text — and a finished goal going over
      // the wire unfinished is the same substitution as a blanked one.
      stored({
        keyGoals: [
          { text: 'Ship it', done: 'yes' },
          { text: '', done: false },
          { text: '', done: false },
        ],
      });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '1 of 3 goals',
      });
    });

    it('reports a goal slot with no tick at all beside its text', async () => {
      // a missing `keyGoals` key is the documented default; a goal somebody
      // wrote, with half of it gone, is not
      stored({ keyGoals: [{ text: 'Ship it' }, { text: '', done: false }] });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '1 of 2 goals',
      });
    });

    it('counts a goal that lost both its text and its tick only once', async () => {
      stored({ keyGoals: [{ text: 1, done: 1 }] });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '1 of 1 goals',
      });
    });

    it('names every section that lost something', async () => {
      stored({
        habits: [{ id: '0', name: 'Run' }, { name: 'no id' }],
        grid: { '1:0': 1, '2:5': 1 },
        observations: ['ok', 7],
      });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
        status: 'partial',
        lost: '1 of 2 habits, 1 grid entry, 1 of 2 notes',
      });
    });

    it('still hands back what it did parse, so the caller can show it', async () => {
      stored({ habits: [{ id: '0', name: 'Run' }, { name: 'no id' }] });
      const read = await readMonthVouched(2026, 8);
      expect(read).toMatchObject({ status: 'partial' });
      if (read.status !== 'partial') throw new Error('expected a partial read');
      expect(read.data.habits).toEqual([{ id: '0', name: 'Run' }]);
    });
  });

  describe('what it refuses to call partial', () => {
    it('vouches for a month with nothing in it', async () => {
      stored({});
      await expect(readMonthVouched(2026, 8)).resolves.toEqual({
        status: 'complete',
        data: emptyMonthData(),
      });
    });

    it('vouches for a month an older build saved without notes or goals', async () => {
      stored({ habits: [{ id: '0', name: 'Run' }], grid: { '1:0': 1 } });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({ status: 'complete' });
    });

    it('vouches for the v1 fixed-slot habit array, empty slots and all', async () => {
      // eight slots, three of them typed into: the blanks were never habits
      stored({ habits: ['Run', '', 'Read', '', '', 'Stretch', '', ''] });
      const read = await readMonthVouched(2026, 8);
      expect(read).toMatchObject({ status: 'complete' });
      if (read.status !== 'complete') throw new Error('expected a complete read');
      expect(read.data.habits).toHaveLength(3);
    });

    it('vouches for a v1 month whose marks all sit on slots that kept their names', async () => {
      // the control: nothing here is orphaned, and it has to stay complete for
      // the reason it always was, not because of the exemption below
      stored({ habits: ['Run', '', 'Read', '', '', '', '', ''], grid: { '1:0': 1, '2:2': 2 } });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({ status: 'complete' });
    });

    it('vouches for a v1 month whose emptied slot left its marks behind', async () => {
      // Somebody cleared slot 1's name years ago and its marks stayed on disk
      // under `${day}:1`, which now names no habit. `parseHabits` has always
      // treated the blank slot as a slot rather than a lost habit; the marks
      // it stranded are the same migration and not this phone losing anything,
      // so an ordinary month like this must still be able to back up.
      stored({ habits: ['Run', '', '', '', '', '', '', ''], grid: { '1:0': 1, '2:1': 1 } });
      const read = await readMonthVouched(2026, 8);
      expect(read).toMatchObject({ status: 'complete' });
      if (read.status !== 'complete') throw new Error('expected a complete read');
      // the orphan is still gone from the data — it is unreachable either way;
      // what changed is that its absence is no longer called damage
      expect(read.data.grid).toEqual({ '1:0': 1 });
    });

    it('vouches for a grid holding a pending cell written as zero', async () => {
      stored({ habits: [{ id: '0', name: 'Run' }], grid: { '1:0': 1, '2:0': 0 } });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({ status: 'complete' });
    });

    it('vouches for an empty notes array', async () => {
      stored({ observations: [] });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({ status: 'complete' });
    });

    it.each([1, 2, 3])('vouches for a raw goal list of %i', async (length) => {
      const goals = Array.from({ length }, (_, i) => ({ text: `g${i}`, done: false }));
      stored({ keyGoals: goals });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({ status: 'complete' });
    });

    it('vouches for a goal list that is missing entirely', async () => {
      stored({ habits: [] });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({ status: 'complete' });
    });

    it('ignores properties it has never heard of', async () => {
      // a month written by a later build must still back up from this one
      stored({ ...valid, mood: 'fine', habits: valid.habits.map((h) => ({ ...h, colour: 'red' })) });
      await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({ status: 'complete' });
    });
  });
});

/**
 * The judgement itself, with no store underneath it.
 *
 * `readMonthVouched` used to be the only way to ask "did this parse with
 * nothing lost", and it can only ask it of AsyncStorage. A month arriving from
 * the backup needs the same question asked of a value that never touched a
 * disk, and asking it a second way would be two standards — the looser of which
 * would be the one guarding whichever copy of somebody's history was about to
 * be overwritten. So the rule is one function, and these check that the reader
 * is genuinely made of it rather than agreeing with it by coincidence.
 */
describe('vouchMonthValue', () => {
  it.each([
    ['a month with nothing wrong with it', valid],
    ['a habit that rotted to a number', { habits: [{ id: '0', name: 'Run' }, { id: '1', name: 42 }] }],
    ['a fourth key goal nobody can keep', { keyGoals: [1, 2, 3, 4].map(() => ({ text: 'a', done: false })) }],
    ['a habits list that is not a list', { habits: 'nope' }],
    ['something that is not a month at all', 'a string'],
  ])('answers for %s exactly as a read off the disk does', async (_case, raw) => {
    stored(raw);
    await expect(readMonthVouched(2026, 8)).resolves.toEqual(vouchMonthValue(raw));
  });

  it('has no way of calling a value absent, because a payload never is', () => {
    // absence is a question about a key in a store. A decrypted document that
    // holds nothing is a document this phone cannot read, and treating it as an
    // empty month is how the empty month gets written over a full one.
    expect(vouchMonthValue(null)).toEqual({ status: 'unreadable' });
    expect(vouchMonthValue(undefined)).toEqual({ status: 'unreadable' });
  });
});

/**
 * The reader a screen that also *writes* has to use.
 *
 * `loadMonth` answers a half-readable record with the half it read, which is
 * right for drawing and ruinous for saving: the survivors go back over the
 * record they survived, and the loss becomes real. This says the same thing
 * `readMonthVouched` says, in a shape a screen can render in every case, so
 * the caller has something to draw and something to refuse to save.
 */
describe('readMonthForEditing', () => {
  it('hands back a whole month and says so', async () => {
    stored(valid);
    await expect(readMonthForEditing(2026, 8)).resolves.toEqual({
      data: parseMonthData(valid),
      complete: true,
    });
  });

  it('calls a month nobody has opened yet complete, because it is', async () => {
    store.getItem.mockResolvedValue(null);
    await expect(readMonthForEditing(2026, 8)).resolves.toEqual({
      data: emptyMonthData(),
      complete: true,
    });
  });

  it('hands back the survivors of a half-read month and refuses to vouch for them', async () => {
    stored({ habits: [{ id: '0', name: 'Run' }, { name: 'no id' }] });
    const read = await readMonthForEditing(2026, 8);
    expect(read.complete).toBe(false);
    // there is still a month to draw: what a caller must not do is write it back
    expect(read.data.habits).toEqual([{ id: '0', name: 'Run' }]);
  });

  it.each([
    ['bytes that are not JSON', '{not json'],
    ['a month stored as something else entirely', '"a string"'],
  ])('gives a blank month for %s, and never vouches for it', async (_case, raw) => {
    store.getItem.mockResolvedValue(raw);
    await expect(readMonthForEditing(2026, 8)).resolves.toEqual({
      data: emptyMonthData(),
      complete: false,
    });
  });

  it('never vouches for a month the store would not answer for', async () => {
    store.getItem.mockRejectedValue(new Error('disk'));
    await expect(readMonthForEditing(2026, 8)).resolves.toEqual({
      data: emptyMonthData(),
      complete: false,
    });
  });
});
