import { monthDocKey } from '../hooks/useMonthData';
import { taskShardKey } from '../hooks/useTasks';
import type { Task } from '../tasks';

/**
 * The names this phone gives the documents it backs up.
 *
 * Everything downstream is a string comparison against these: the ledger files
 * a dirty flag under one, the backup writes a document under one, and the rules
 * refuse anything that isn't shaped the way they expect. Nothing here would
 * throw if a key came out wrong — the flag would simply be set on a document
 * nobody pushes, and the month or the year it named would stop being sent while
 * every screen carried on looking fine. So the keys are pinned in a test even
 * though they are three lines of string handling.
 *
 * The hooks these come from need a React renderer to exercise; the key
 * functions are pure and deliberately exported on their own, so this covers
 * what the sync run has to agree with without pretending to test the hooks.
 */

/** Both modules reach storage through their imports; none of it is called here */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

/** What `firestore.rules` will accept as a document id in each collection */
const MONTH_ID = /^\d{4}-\d{2}$/;
const TASK_ID = /^(current|20[0-9]{2})$/;

const open: Task = { id: '0', text: 'Send the invoice', due: 1_800_000_000_000, done: false };

/** Local time, so the year asserted is the year the device would read back */
function at(year: number, month: number, day: number): number {
  return new Date(year, month, day, 12).getTime();
}

describe('what a month is called', () => {
  it('names the month the way the server does', () => {
    expect(monthDocKey(2026, 8)).toBe('2026-09');
  });

  it('pads, so January is not a second document for the same month', () => {
    expect(monthDocKey(2026, 0)).toBe('2026-01');
    expect(monthDocKey(2026, 0)).not.toBe('2026-1');
  });

  it('counts December as the twelfth month rather than the eleventh', () => {
    expect(monthDocKey(2026, 11)).toBe('2026-12');
  });

  it('produces an id the rules accept, every month of the year', () => {
    for (let month = 0; month < 12; month++) {
      expect(monthDocKey(2026, month)).toMatch(MONTH_ID);
    }
  });
});

describe('which document a deadline travels in', () => {
  it('carries an open deadline in the current list', () => {
    expect(taskShardKey(open)).toBe('current');
  });

  it('files a finished one under the year it was finished in', () => {
    expect(taskShardKey({ ...open, done: true, completedAt: at(2024, 5, 1) })).toBe('2024');
  });

  it('sends a deadline to a different document when it is ticked off', () => {
    const before = open;
    const after = { ...open, done: true, completedAt: at(2026, 0, 3) };
    expect(taskShardKey(before)).toBe('current');
    expect(taskShardKey(after)).toBe('2026');
    // both ends of that move have to be rewritten, which is only true if the
    // two keys really are different documents
    expect(taskShardKey(before)).not.toBe(taskShardKey(after));
  });

  it('brings it back to the current list when it is un-ticked', () => {
    const before = { ...open, done: true, completedAt: at(2024, 5, 1) };
    const after = { ...open, done: false, completedAt: undefined };
    expect(taskShardKey(before)).toBe('2024');
    expect(taskShardKey(after)).toBe('current');
  });

  it('keeps a task finished at an unknown time where it already is', () => {
    expect(taskShardKey({ ...open, done: true })).toBe('current');
  });

  it('does not invent a year for an unfinished task that carries a completion time', () => {
    expect(taskShardKey({ ...open, done: false, completedAt: at(2024, 5, 1) })).toBe('current');
  });

  it('refuses to address a year the rules would reject', () => {
    // a device whose clock has wandered; the shard id has to be 20xx or the
    // write is refused and the task goes nowhere at all
    expect(taskShardKey({ ...open, done: true, completedAt: at(1999, 11, 31) })).toBe('current');
    expect(taskShardKey({ ...open, done: true, completedAt: at(2100, 0, 1) })).toBe('current');
  });

  it('never names anything the rules would not take', () => {
    const years = [1970, 1999, 2000, 2024, 2099, 2100];
    for (const year of years) {
      expect(taskShardKey({ ...open, done: true, completedAt: at(year, 6, 1) })).toMatch(TASK_ID);
    }
    expect(taskShardKey({ ...open, done: true, completedAt: Number.NaN })).toMatch(TASK_ID);
  });
});
