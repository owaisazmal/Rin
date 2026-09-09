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
const LEDGER_BLOB = '@monthly-planning/sync-ledger';

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

/**
 * What the screen tells the backup about the record it just read.
 *
 * The guards above stop a half-read record being written back, which saves the
 * data and leaves the evidence on disk. They do not tell anybody. A backup run
 * only ever looks at documents whose contents changed; a month that rotted on
 * disk changed nothing, so no run examined it, nothing was ever blocked, and
 * the card in Settings said "Backed up. Everything on this phone is in the
 * backup." over a September missing a third of itself — with no way offered to
 * fetch the whole one the server was holding. Reading the record is the only
 * moment anybody finds out, so reading it is when it gets written down.
 */
describe('telling the backup about a record this phone cannot read', () => {
  /** A backup id of the shape `deriveBackupId` produces, without the crypto */
  const ID = 'a'.repeat(64);

  /**
   * Give the ledger's own read-modify-write queue its turns. It is a chain of
   * promises behind the same storage the hooks use, so it lands a few
   * microtasks after the render that started it.
   */
  async function ledgerSettled() {
    for (let turn = 0; turn < 24; turn++) await Promise.resolve();
    return loadLedger();
  }

  it('writes down what was lost, in the words the voucher used', async () => {
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, null));
    await planner.settle();

    const ledger = await ledgerSettled();
    expect(unvouchedKeys(ledger)).toEqual(['2026-09']);
    expect(unvouchedNote(ledger, '2026-09')).toBe('1 of 2 habits, 1 grid entry');
  });

  it('does not mark the month dirty, and does not give the backup a reason to run', async () => {
    // The one that matters most. A dirty flag here would carry the surviving
    // third of September to the server over the whole copy already sitting
    // there — the exact loss the guard above refuses to commit to disk, done to
    // the one copy that is not on this phone. Nothing was edited, so nothing is
    // waiting, and a phone that has noticed a damaged month still costs no
    // request, no anonymous sign-in and nothing on the wire.
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, null));
    await planner.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await planner.settle();

    const ledger = await ledgerSettled();
    expect(ledger.dirty).toEqual({});
    expect(pendingKeys(ledger)).toEqual([]);
  });

  it('leaves the note where the next launch will find it', async () => {
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, null));
    await planner.settle();
    await ledgerSettled();

    // nothing in this process: the ledger is a file, and this is the file
    expect(JSON.parse(mockLocal.get(LEDGER_BLOB)!)).toMatchObject({
      unvouched: { '2026-09': '1 of 2 habits, 1 grid entry' },
    });
  });

  it('stops the card claiming everything on this phone is in the backup', async () => {
    // End to end, and the sentence this whole change exists to stop. The phone
    // has backed up, nothing is dirty, nothing was refused; every other signal
    // says settled, and September is missing half of itself.
    await resetFor(ID);
    await recordPushed('2026-09', digestOf('september as it was'), 0);
    expect(statusOf(await loadLedger(), NO_RUNS).reconciled).toBe(true);

    mockLocal.set(MONTH_BLOB, halfReadableMonth);
    const planner = mount(() => useMonthData(2026, 8, null));
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
    // An undamaged phone does not so much as create the file.
    await saveMonth(2026, 8, month);

    const planner = mount(() => useMonthData(2026, 8, null));
    await planner.settle();
    jest.advanceTimersByTime(AFTER_THE_TYPING_STOPS);
    await planner.settle();
    await ledgerSettled();

    expect(mockLocal.has(LEDGER_BLOB)).toBe(false);
  });

  it('takes the note back when somebody repairs the month', async () => {
    // The first way out, and the one both backup screens describe: write in the
    // month and the record goes back to disk whole. The card has to stop
    // calling it damaged the moment that lands, because a way out that does not
    // say it worked is not one.
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, null));
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
    // The narrow case `flushSave` reports without saving. The flag is right —
    // the phone holds something the backup has not seen — and the note is right
    // too, because the record on disk is still the damaged one. Clearing it
    // here would be the app going quiet about a month it knows it cannot read.
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const planner = mount(() => useMonthData(2026, 8, null));
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
    // The second way out. `restoreMonth` writes the backup's copy straight to
    // disk without going anywhere near this hook, so what retires the note here
    // is the next read: a record this phone can vouch for is the only proof of
    // a whole one there is.
    mockLocal.set(MONTH_BLOB, halfReadableMonth);

    const damaged = mount(() => useMonthData(2026, 8, null));
    await damaged.settle();
    expect(unvouchedKeys(await ledgerSettled())).toEqual(['2026-09']);

    // what the restore leaves behind: both habits and both marks, on disk
    await saveMonth(2026, 8, month);

    const restored = mount(() => useMonthData(2026, 8, null));
    await restored.settle();

    expect(restored.shown.vouched).toBe(true);
    expect(unvouchedKeys(await ledgerSettled())).toEqual([]);
  });

  it('names a document even when it cannot say what was lost', async () => {
    // Bytes that are not a month at all. Nothing survived to be counted against
    // anything, so there is no phrase — and the month is named anyway, because
    // being unable to describe the damage is not being unable to see it.
    mockLocal.set(MONTH_BLOB, '{not json');

    const planner = mount(() => useMonthData(2026, 8, null));
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
    // The deadlines are one record on this phone; the year shards are only how
    // that record is divided up on the way to the server. `current` is the one
    // every edit touches, so it is the one to name.
    mockLocal.set(TASKS_BLOB, halfReadableTasks);

    const deadlines = mount(() => useTasks());
    await deadlines.settle();

    const ledger = await ledgerSettled();
    expect(unvouchedKeys(ledger)).toEqual(['current']);
    expect(unvouchedNote(ledger, 'current')).toBe('1 of 2 deadlines');
    // and nothing is waiting: the only list this phone holds is the rows that
    // survived, and sending those would empty the archive of the ones that did not
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
