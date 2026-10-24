import { useMonthData } from '../hooks/useMonthData';
import { useTasks } from '../hooks/useTasks';
import { loadMonth, readMonthVouched, saveMonth } from '../storage';
import { loadTasks, readTasksVouched, saveTasks } from '../tasks';
import {
  digestOf,
  loadLedger,
  pendingKeys,
  recordPushed,
  resetFor,
  unvouchedKeys,
  unvouchedNote,
} from '../syncLedger';
import { NO_RUNS, statusOf } from '../hooks/autoBackupPolicy';
import { emptyMonthData } from '../types';
import type { Task } from '../tasks';

/** a fixed "today"; these tests never touch the grid */
const TODAY = { year: 2026, month: 8, day: 15 };

// React is faked with just the hooks these two use, so their save effects really run

interface MockCell {
  value: unknown;
}

interface MockEffect {
  deps?: unknown[];
  cleanup?: () => void;
}

const mockTree = {
  cells: [] as MockCell[],
  cursor: 0,
  effects: [] as MockEffect[],
  effectCursor: 0,
  pending: [] as (() => void)[],
  changed: false,
};

/** The slot this hook call owns, in the order the calls are made */
function mockCell(make: () => unknown): MockCell {
  const cell = mockTree.cells[mockTree.cursor] ?? { value: make() };
  mockTree.cells[mockTree.cursor++] = cell;
  return cell;
}

function mockSameDeps(before: unknown[] | undefined, after: unknown[] | undefined): boolean {
  if (!before || !after || before.length !== after.length) return false;
  return after.every((dep, i) => Object.is(dep, before[i]));
}

function mockUseState(initial: unknown): [unknown, (next: unknown) => void] {
  const cell = mockCell(() =>
    typeof initial === 'function' ? (initial as () => unknown)() : initial
  );
  return [
    cell.value,
    (next: unknown) => {
      const value =
        typeof next === 'function' ? (next as (prev: unknown) => unknown)(cell.value) : next;
      if (Object.is(value, cell.value)) return;
      cell.value = value;
      mockTree.changed = true;
    },
  ];
}

function mockUseRef(initial: unknown): { current: unknown } {
  return mockCell(() => ({ current: initial })).value as { current: unknown };
}

function mockUseMemo(make: () => unknown, deps?: unknown[]): unknown {
  const held = mockCell(() => ({ value: make(), deps })).value as {
    value: unknown;
    deps?: unknown[];
  };
  if (!mockSameDeps(held.deps, deps)) {
    held.value = make();
    held.deps = deps;
  }
  return held.value;
}

function mockUseCallback(fn: unknown, deps?: unknown[]): unknown {
  const held = mockCell(() => ({ fn, deps })).value as { fn: unknown; deps?: unknown[] };
  if (!mockSameDeps(held.deps, deps)) {
    held.fn = fn;
    held.deps = deps;
  }
  return held.fn;
}

function mockUseEffect(run: () => void | (() => void), deps?: unknown[]): void {
  const index = mockTree.effectCursor++;
  const previous = mockTree.effects[index];
  const slot: MockEffect = { deps, cleanup: previous?.cleanup };
  mockTree.effects[index] = slot;
  if (previous && mockSameDeps(previous.deps, deps)) return;
  mockTree.pending.push(() => {
    slot.cleanup?.();
    const cleanup = run();
    slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
}

jest.mock('react', () => ({
  __esModule: true,
  useState: mockUseState,
  useRef: mockUseRef,
  useMemo: mockUseMemo,
  useCallback: mockUseCallback,
  useEffect: mockUseEffect,
}));

const mockLocal = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockLocal.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockLocal.set(k, v);
    }),
    getAllKeys: jest.fn(async () => [...mockLocal.keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map((k) => [k, mockLocal.get(k) ?? null])),
  },
}));

/** Put a hook on screen and keep it there */
function mount<T>(screen: () => T) {
  mockTree.cells = [];
  mockTree.effects = [];
  mockTree.pending = [];
  let latest!: T;

  const draw = () => {
    mockTree.cursor = 0;
    mockTree.effectCursor = 0;
    mockTree.changed = false;
    latest = screen();
    const queued = mockTree.pending;
    mockTree.pending = [];
    for (const effect of queued) effect();
  };

  draw();
  return {
    /** what the hook handed back at the last draw */
    get shown(): T {
      return latest;
    },
    async settle(): Promise<T> {
      for (let turn = 0; turn < 24; turn++) {
        await Promise.resolve();
        if (mockTree.changed) draw();
      }
      return latest;
    },
  };
}

/** Long enough for the debounce in either hook, which is 400ms in both */
const AFTER_THE_TYPING_STOPS = 1_000;

const MONTH_BLOB = '@monthly-planning/2026-09';
const TASKS_BLOB = '@monthly-planning/tasks';
const LEDGER_BLOB = '@monthly-planning/sync-ledger';

const month = {
  ...emptyMonthData(),
  habits: [
    { id: '0', name: 'Run' },
    { id: '1', name: 'Read' },
  ],
  grid: { '1:0': 1 as const, '2:1': 2 as const },
};

/** The same month with one habit rotted on disk — a number where its name was */
const halfReadableMonth = JSON.stringify({
  ...month,
  habits: [month.habits[0], { id: '1', name: 42 }],
});

const deadline: Task = { id: '0', text: 'Send the invoice', due: 1_800_000_000_000, done: false };

/** One good row and one that is not a task at all */
const halfReadableTasks = JSON.stringify([deadline, { id: '1' }]);

beforeEach(() => {
  mockLocal.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('a month this phone could only half read', () => {
  it('is not written back merely because somebody opened it', async () => {
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await planner.settle();

    // byte for byte what was there before the month was opened
    expect(mockLocal.get(MONTH_BLOB)).toBe(halfReadableMonth);
    await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
      status: 'partial',
      lost: '1 of 2 habits, 1 grid entry',
    });
  });

  it('shows what survived, and says it cannot save', async () => {
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();

    expect(planner.shown.loaded).toBe(true);
    expect(planner.shown.data.habits).toEqual([{ id: '0', name: 'Run' }]);
    expect(planner.shown.vouched).toBe(false);
  });

  it('saves what somebody deliberately types into it, because that is the repair', async () => {
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();
    planner.shown.renameHabit('0', 'Walk');
    await planner.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await planner.settle();

    const written = mockLocal.get(MONTH_BLOB);
    expect(written).not.toBe(halfReadableMonth);
    expect(JSON.parse(written!).habits).toEqual([{ id: '0', name: 'Walk' }]);
    // and what it wrote is something this phone can now vouch for
    await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({ status: 'complete' });
  });

  it('still tells the ledger the phone holds something the backup has not seen', async () => {
    // saved or not, the phone now holds something the backup has not seen
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();
    planner.shown.renameHabit('0', 'Walk');
    await planner.settle();
    planner.shown.flushSave();
    await planner.settle();

    expect(pendingKeys(await loadLedger())).toEqual(['2026-09']);
  });
});

describe('a month this phone read in full', () => {
  it('saves an edit once the typing stops', async () => {
    await saveMonth(2026, 8, month);

    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();
    expect(planner.shown.vouched).toBe(true);

    planner.shown.renameHabit('1', 'Read more');
    await planner.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await planner.settle();

    await expect(loadMonth(2026, 8)).resolves.toMatchObject({
      habits: [
        { id: '0', name: 'Run' },
        { id: '1', name: 'Read more' },
      ],
    });
  });

  it('writes on the way out of the month without waiting for the pause', async () => {
    await saveMonth(2026, 8, month);

    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();
    planner.shown.setObservation(0, 'Quieter week');
    await planner.settle();
    planner.shown.flushSave();
    await planner.settle();

    await expect(loadMonth(2026, 8)).resolves.toMatchObject({
      observations: ['Quieter week', '', '', ''],
    });
  });

  it('writes an empty month back, because an empty month is what is there', async () => {
    // nothing stored at all is a month nobody has opened, not damage
    const planner = mount(() => useMonthData(2025, 3, TODAY));
    await planner.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await planner.settle();

    expect(planner.shown.vouched).toBe(true);
    expect(mockLocal.has('@monthly-planning/2025-04')).toBe(true);
  });
});

describe('a month with no habits of its own', () => {
  const NEW_MONTH_BLOB = '@monthly-planning/2026-09';

  /** August 2026, the month before the one being opened */
  const lastMonth = { ...month, habits: [...month.habits, { id: '2', name: ' ' }] };

  async function open() {
    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();
    await planner.settle();
    return planner;
  }

  async function saved(planner: { settle(): Promise<unknown> }) {
    await planner.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await planner.settle();
    return JSON.parse(mockLocal.get(NEW_MONTH_BLOB)!);
  }

  it('shows the habits of the month before, without their marks or blank rows', async () => {
    await saveMonth(2026, 7, lastMonth);

    const planner = await open();

    expect(planner.shown.data.habits).toEqual(month.habits);
    expect(planner.shown.data.grid).toEqual({});
  });

  it('looks past months that were opened and left empty', async () => {
    await saveMonth(2026, 5, lastMonth);
    await saveMonth(2026, 6, emptyMonthData());
    await saveMonth(2026, 7, emptyMonthData());

    const planner = await open();

    expect(planner.shown.data.habits).toEqual(month.habits);
  });

  it('keeps following the earlier month until something is marked', async () => {
    await saveMonth(2026, 7, lastMonth);

    const planner = await open();
    planner.shown.setGoalText(0, 'Ship it');

    expect((await saved(planner)).habits).toEqual([]);
  });

  it('takes the habits as its own once one is marked', async () => {
    await saveMonth(2026, 7, lastMonth);

    const planner = await open();
    planner.shown.setCell(15, '0', 1);

    expect(await saved(planner)).toMatchObject({ habits: month.habits, grid: { '15:0': 1 } });
  });

  it('stays empty once every habit has been removed', async () => {
    await saveMonth(2026, 7, lastMonth);

    const planner = await open();
    planner.shown.removeHabit('0');
    planner.shown.removeHabit('1');
    await saved(planner);

    expect((await open()).shown.data.habits).toEqual([]);
  });

  it('carries nothing past a month that was emptied on purpose', async () => {
    await saveMonth(2026, 6, lastMonth);
    await saveMonth(2026, 7, { ...emptyMonthData(), habitsCleared: true });

    expect((await open()).shown.data.habits).toEqual([]);
  });

  it('carries from December into January', async () => {
    await saveMonth(2026, 11, lastMonth);

    const planner = mount(() => useMonthData(2027, 0, { year: 2027, month: 0, day: 1 }));
    await planner.settle();
    await planner.settle();

    expect(planner.shown.data.habits).toEqual(month.habits);
  });
});

describe('a deadline list this phone could only half read', () => {
  it('is not written back merely because the planner opened', async () => {
    mockLocal.set(TASKS_BLOB, halfReadableTasks);

    const deadlines = mount(() => useTasks());
    await deadlines.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await deadlines.settle();

    expect(mockLocal.get(TASKS_BLOB)).toBe(halfReadableTasks);
    await expect(readTasksVouched()).resolves.toMatchObject({
      status: 'partial',
      lost: '1 of 2 deadlines',
    });
  });

  it('shows the rows that survived, and says it cannot save', async () => {
    mockLocal.set(TASKS_BLOB, halfReadableTasks);

    const deadlines = mount(() => useTasks());
    await deadlines.settle();

    expect(deadlines.shown.tasks).toEqual([deadline]);
    expect(deadlines.shown.vouched).toBe(false);
  });

  it('saves a deadline somebody deliberately adds, because that is the repair', async () => {
    mockLocal.set(TASKS_BLOB, halfReadableTasks);

    const deadlines = mount(() => useTasks());
    await deadlines.settle();
    deadlines.shown.addTask();
    await deadlines.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await deadlines.settle();

    expect(mockLocal.get(TASKS_BLOB)).not.toBe(halfReadableTasks);
    await expect(readTasksVouched()).resolves.toMatchObject({ status: 'complete' });
  });
});

describe('a deadline list this phone read in full', () => {
  it('saves one somebody adds', async () => {
    await saveTasks([deadline]);

    const deadlines = mount(() => useTasks());
    await deadlines.settle();
    expect(deadlines.shown.vouched).toBe(true);

    deadlines.shown.addTask();
    await deadlines.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await deadlines.settle();

    await expect(loadTasks()).resolves.toHaveLength(2);
  });

  it('treats a phone that has never written one as an empty list rather than damage', async () => {
    const deadlines = mount(() => useTasks());
    await deadlines.settle();

    expect(deadlines.shown.tasks).toEqual([]);
    expect(deadlines.shown.vouched).toBe(true);
  });
});

/** What the screen tells the backup about the record it just read */
describe('telling the backup about a record this phone cannot read', () => {
  /** A backup id of the shape `deriveBackupId` produces, without the crypto */
  const ID = 'a'.repeat(64);

  /** Give the ledger's own read-modify-write queue its turns */
  async function ledgerSettled() {
    for (let turn = 0; turn < 24; turn++) await Promise.resolve();
    return loadLedger();
  }

  it('writes down what was lost, in the words the voucher used', async () => {
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();

    const ledger = await ledgerSettled();
    expect(unvouchedKeys(ledger)).toEqual(['2026-09']);
    expect(unvouchedNote(ledger, '2026-09')).toBe('1 of 2 habits, 1 grid entry');
  });

  it('does not mark the month dirty, and does not give the backup a reason to run', async () => {
    // a dirty flag would send the surviving third over the whole copy on the server
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await planner.settle();

    const ledger = await ledgerSettled();
    expect(ledger.dirty).toEqual({});
    expect(pendingKeys(ledger)).toEqual([]);
  });

  it('leaves the note where the next launch will find it', async () => {
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();
    await ledgerSettled();

    // nothing in this process: the ledger is a file, and this is the file
    expect(JSON.parse(mockLocal.get(LEDGER_BLOB)!)).toMatchObject({
      unvouched: { '2026-09': '1 of 2 habits, 1 grid entry' },
    });
  });

  it('stops the card claiming everything on this phone is in the backup', async () => {
    // every other signal says settled
    await resetFor(ID);
    await recordPushed('2026-09', digestOf('september as it was'), 0);
    expect(statusOf(await loadLedger(), NO_RUNS).reconciled).toBe(true);

    mockLocal.set(MONTH_BLOB, halfReadableMonth);
    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();

    const status = statusOf(await ledgerSettled(), NO_RUNS);
    expect(status.reconciled).toBe(false);
    expect(status.damaged).toEqual([
      { key: '2026-09', lost: '1 of 2 habits, 1 grid entry' },
    ]);
    // and still nothing waiting, because there is nothing here to send
    expect(status.waiting).toEqual([]);
  });

  it('says nothing at all about a month it read in full', async () => {
    // an undamaged phone does not so much as create the file
    await saveMonth(2026, 8, month);

    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await planner.settle();
    await ledgerSettled();

    expect(mockLocal.has(LEDGER_BLOB)).toBe(false);
  });

  it('takes the note back when somebody repairs the month', async () => {
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();
    expect(unvouchedKeys(await ledgerSettled())).toEqual(['2026-09']);

    planner.shown.renameHabit('0', 'Walk');
    await planner.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await planner.settle();

    const ledger = await ledgerSettled();
    expect(unvouchedKeys(ledger)).toEqual([]);
    // and the edit is waiting to go, exactly as any other edit would be
    expect(pendingKeys(ledger)).toEqual(['2026-09']);
  });

  it('keeps the note when somebody typed but nothing was written', async () => {
    // the record on disk is still the damaged one
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();
    planner.shown.renameHabit('0', 'Walk');
    // no settle, so the save effect has not run and there is nothing pending
    planner.shown.flushSave();
    await planner.settle();

    const ledger = await ledgerSettled();
    expect(mockLocal.get(MONTH_BLOB)).toBe(halfReadableMonth);
    expect(unvouchedKeys(ledger)).toEqual(['2026-09']);
  });

  it('takes it back when the whole month is put back from the backup', async () => {
    // `restoreMonth` writes straight to disk, so the next read is what retires the note
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const damaged = mount(() => useMonthData(2026, 8, TODAY));
    await damaged.settle();
    expect(unvouchedKeys(await ledgerSettled())).toEqual(['2026-09']);

    // what the restore leaves behind: both habits and both marks, on disk
    await saveMonth(2026, 8, month);

    const restored = mount(() => useMonthData(2026, 8, TODAY));
    await restored.settle();

    expect(restored.shown.vouched).toBe(true);
    expect(unvouchedKeys(await ledgerSettled())).toEqual([]);
  });

  it('names a document even when it cannot say what was lost', async () => {
    // nothing survived to describe, but the month is named anyway
    mockLocal.set(MONTH_BLOB, '{not json');

    const planner = mount(() => useMonthData(2026, 8, TODAY));
    await planner.settle();

    const ledger = await ledgerSettled();
    expect(unvouchedKeys(ledger)).toEqual(['2026-09']);
    expect(unvouchedNote(ledger, '2026-09')).toBe('');
    expect(statusOf(ledger, NO_RUNS).damaged).toEqual([{ key: '2026-09' }]);
  });
});

describe('telling the backup about a deadline list this phone cannot read', () => {
  async function ledgerSettled() {
    for (let turn = 0; turn < 24; turn++) await Promise.resolve();
    return loadLedger();
  }

  it('writes it down under the document the open list travels in', async () => {
    mockLocal.set(TASKS_BLOB, halfReadableTasks);

    const deadlines = mount(() => useTasks());
    await deadlines.settle();

    const ledger = await ledgerSettled();
    expect(unvouchedKeys(ledger)).toEqual(['current']);
    expect(unvouchedNote(ledger, 'current')).toBe('1 of 2 deadlines');
    expect(pendingKeys(ledger)).toEqual([]);
  });

  it('takes it back when somebody rebuilds the list', async () => {
    mockLocal.set(TASKS_BLOB, halfReadableTasks);

    const deadlines = mount(() => useTasks());
    await deadlines.settle();
    expect(unvouchedKeys(await ledgerSettled())).toEqual(['current']);

    deadlines.shown.addTask();
    await deadlines.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await deadlines.settle();

    expect(unvouchedKeys(await ledgerSettled())).toEqual([]);
  });

  it('says nothing at all about a list it read in full', async () => {
    await saveTasks([deadline]);

    const deadlines = mount(() => useTasks());
    await deadlines.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await deadlines.settle();
    await ledgerSettled();

    expect(mockLocal.has(LEDGER_BLOB)).toBe(false);
  });
});
