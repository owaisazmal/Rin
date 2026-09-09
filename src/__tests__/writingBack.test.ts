import { useMonthData } from '../hooks/useMonthData';
import { useTasks } from '../hooks/useTasks';
import { loadMonth, readMonthVouched, saveMonth } from '../storage';
import { loadTasks, readTasksVouched, saveTasks } from '../tasks';
import { loadLedger, pendingKeys } from '../syncLedger';
import { emptyMonthData } from '../types';
import type { Task } from '../tasks';

/**
 * What a screen writes back over what it was given.
 *
 * The bug these are written from is not a judgement that could be lifted out
 * into a pure function, which is how everything else about the backup is
 * tested. It is *when an effect fires*. Both of these hooks save on a debounce
 * that is scheduled whenever the data changes — and the data changes once when
 * the month finishes loading, so merely opening a month wrote it straight back.
 * For a record this phone could only half read, that is the surviving half
 * going back over the record it survived: a habit that rotted on disk is gone
 * for good, nobody typed anything, and the record now reads as whole, so the
 * backup carries the thinned month over the good copy on the server without a
 * word. Nothing short of running the effect shows that.
 *
 * So React is replaced below by the five hooks these two files actually use.
 * It is faithful in the ways that decide the answer — a ref that survives a
 * render and state that replaces it, an effect that re-runs only when its deps
 * change and is cleaned up before it does, a callback that keeps its identity —
 * and it is a fake, so what it proves is about these two hooks rather than
 * about React.
 */

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
      // React bails out of a render when the state is the value it already
      // holds, and so does the `edit` door in both hooks
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

/**
 * Put a hook on screen and keep it there.
 *
 * `settle` is the only unusual part: the loads are promises, so a render
 * schedules a read that lands a few microtasks later and sets state, which
 * needs another render. Rather than reaching for a scheduler this simply gives
 * the promises their turns and draws again for as long as anything changed.
 */
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

const month = {
  ...emptyMonthData(),
  habits: [
    { id: '0', name: 'Run' },
    { id: '1', name: 'Read' },
  ],
  grid: { '1:0': 1 as const, '2:1': 2 as const },
};

/**
 * The same month with one habit rotted on disk — a number where its name was.
 * It parses, so nothing throws and nothing looks broken; the parser drops that
 * habit and the marks that belonged to it, and what is left is an ordinary
 * month with a third of it missing.
 */
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

    const planner = mount(() => useMonthData(2026, 8, null));
    await planner.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await planner.settle();

    // byte for byte what was there before the month was opened
    expect(mockLocal.get(MONTH_BLOB)).toBe(halfReadableMonth);
    // and still readable as damaged, which is the evidence the backup needs:
    // a rewritten record would read as whole and go up over the good copy
    await expect(readMonthVouched(2026, 8)).resolves.toMatchObject({
      status: 'partial',
      lost: '1 of 2 habits, 1 grid entry',
    });
  });

  it('shows what survived, and says it cannot save', async () => {
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, null));
    await planner.settle();

    expect(planner.shown.loaded).toBe(true);
    expect(planner.shown.data.habits).toEqual([{ id: '0', name: 'Run' }]);
    expect(planner.shown.vouched).toBe(false);
  });

  it('saves what somebody deliberately types into it, because that is the repair', async () => {
    // The line is intent, not damage. Refusing a write nobody asked for is the
    // whole point of the guard; refusing one somebody typed would freeze the
    // month — and if the damaged month is the current one, freeze the app for
    // the only thing it does. Both backup screens tell people to edit a stuck
    // month to fix it, so swallowing the edit would be the app giving advice it
    // had made impossible to take.
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, null));
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
    // The flag is right either way. If the repair saved, the phone holds an
    // edit the backup has not seen; if it did not, the phone holds a record the
    // backup cannot read. Both are "something the next run must look at", and a
    // flag withheld here would be the app going quiet about a month it knows it
    // cannot vouch for.
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, null));
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

    const planner = mount(() => useMonthData(2026, 8, null));
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

    const planner = mount(() => useMonthData(2026, 8, null));
    await planner.settle();
    planner.shown.setObservation(0, 'Quieter week');
    await planner.settle();
    // no timer is advanced: this is the flush that happens when somebody pages
    // to another month before the debounce has run
    planner.shown.flushSave();
    await planner.settle();

    await expect(loadMonth(2026, 8)).resolves.toMatchObject({
      observations: ['Quieter week', '', '', ''],
    });
  });

  it('writes an empty month back, because an empty month is what is there', async () => {
    // Nothing is stored under the key at all, which is a month nobody has
    // opened. That is not damage — writing an empty month over nothing takes
    // nothing away — and the backup depends on it: this is how paging back
    // through last year materialises the months it then declines to send.
    const planner = mount(() => useMonthData(2025, 3, null));
    await planner.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await planner.settle();

    expect(planner.shown.vouched).toBe(true);
    expect(mockLocal.has('@monthly-planning/2025-04')).toBe(true);
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
    // Same reasoning as the month above: a list nobody can add to is a list
    // nobody can use, and adding to it is how someone rebuilds one.
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
