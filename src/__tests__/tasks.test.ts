import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadTasks,
  nextTaskId,
  readTasksForEditing,
  readTasksVouched,
  saveTasks,
  toggleDone,
  vouchTasksValue,
} from '../tasks';
import type { Task } from '../tasks';

/**
 * The only module here that touches storage, so it is the only one that needs a
 * stand-in. Everything worth testing is in what comes back out of a read — the
 * parser is the guard between whatever is on disk and the rest of the app.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const store = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const KEY = '@monthly-planning/tasks';

/** Puts arbitrary JSON on "disk", including shapes the app would never write */
function stored(value: unknown) {
  store.getItem.mockResolvedValue(JSON.stringify(value));
}

const valid = {
  id: '0',
  text: 'Send the invoice',
  due: 1_800_000_000_000,
  done: false,
};

describe('loadTasks', () => {
  it('returns nothing when the key has never been written', async () => {
    store.getItem.mockResolvedValue(null);
    await expect(loadTasks()).resolves.toEqual([]);
  });

  it('reads back what was stored', async () => {
    stored([valid]);
    await expect(loadTasks()).resolves.toEqual([{ ...valid, completedAt: undefined }]);
  });

  it('survives a corrupted value rather than throwing', async () => {
    store.getItem.mockResolvedValue('{ not json');
    await expect(loadTasks()).resolves.toEqual([]);
  });

  it('survives storage itself failing', async () => {
    store.getItem.mockRejectedValue(new Error('disk gone'));
    await expect(loadTasks()).resolves.toEqual([]);
  });

  it('ignores a value that is not a list', async () => {
    stored({ id: '0' });
    await expect(loadTasks()).resolves.toEqual([]);
  });

  it.each([
    { missing: 'id', row: { ...valid, id: undefined } },
    { missing: 'text', row: { ...valid, text: undefined } },
    { missing: 'due', row: { ...valid, due: undefined } },
    { missing: 'done', row: { ...valid, done: undefined } },
  ])('drops a row with no $missing', async ({ row }) => {
    stored([row, valid]);
    const tasks = await loadTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('0');
  });

  it.each([
    { kind: 'a due date that is not a number', row: { ...valid, due: 'tomorrow' } },
    { kind: 'a due date that is not finite', row: { ...valid, due: Infinity } },
    { kind: 'a done flag that is not a boolean', row: { ...valid, done: 'yes' } },
    { kind: 'a null row', row: null },
  ])('drops $kind', async ({ row }) => {
    stored([row]);
    await expect(loadTasks()).resolves.toEqual([]);
  });

  it('clears a completion time left on an unfinished task', async () => {
    // nothing the app writes looks like this, but a hand-edited or half-migrated
    // record could — and history would otherwise file it as finished
    stored([{ ...valid, done: false, completedAt: 1_800_000_000_000 }]);
    const [task] = await loadTasks();
    expect(task.completedAt).toBeUndefined();
  });

  it('keeps the completion time on a finished task', async () => {
    const when = 1_800_000_000_000;
    stored([{ ...valid, done: true, completedAt: when }]);
    const [task] = await loadTasks();
    expect(task.completedAt).toBe(when);
  });

  it('clears a completion time that is not a number', async () => {
    stored([{ ...valid, done: true, completedAt: 'yesterday' }]);
    const [task] = await loadTasks();
    expect(task.completedAt).toBeUndefined();
  });

  it('reads a record from before repeats existed as a one-off', async () => {
    stored([valid]);
    const [task] = await loadTasks();
    expect(task).not.toHaveProperty('repeat');
  });

  it('keeps a repeat rule', async () => {
    stored([{ ...valid, repeat: { every: 'month', day: 31 } }]);
    const [task] = await loadTasks();
    expect(task.repeat).toEqual({ every: 'month', day: 31 });
  });

  it('keeps the deadline but drops a repeat rule it cannot read', async () => {
    stored([{ ...valid, repeat: { every: 'fortnight' } }]);
    const [task] = await loadTasks();
    expect(task.id).toBe('0');
    expect(task).not.toHaveProperty('repeat');
  });
});

describe('saveTasks', () => {
  it('writes the list under the app-scoped key', async () => {
    const tasks: Task[] = [{ ...valid, completedAt: undefined }];
    await saveTasks(tasks);
    expect(store.setItem).toHaveBeenCalledWith(KEY, JSON.stringify(tasks));
  });

  it('swallows a failed write rather than surfacing it', async () => {
    store.setItem.mockRejectedValue(new Error('disk full'));
    await expect(saveTasks([])).resolves.toBeUndefined();
  });
});

describe('toggleDone', () => {
  const NOW = new Date(2026, 9, 22, 12).getTime();
  const due = new Date(2026, 9, 31, 18).getTime();

  it('ticks a one-off deadline exactly as before', () => {
    const list: Task[] = [{ ...valid, due }];
    expect(toggleDone(list, '0', NOW)).toEqual([{ ...valid, due, done: true, completedAt: NOW }]);
  });

  it('un-ticks a finished deadline and forgets when it was finished', () => {
    const list: Task[] = [{ ...valid, due, done: true, completedAt: NOW }];
    const [task] = toggleDone(list, '0', NOW + 1);
    expect(task.done).toBe(false);
    expect(task.completedAt).toBeUndefined();
  });

  it('leaves the list alone for an id it does not hold', () => {
    const list: Task[] = [{ ...valid, due }];
    expect(toggleDone(list, '9', NOW)).toBe(list);
  });

  it('moves a recurring deadline on and files the finished occurrence', () => {
    const list: Task[] = [
      { ...valid, id: '4', due, repeat: { every: 'month', day: 31 } },
      { ...valid, id: '7', text: 'Other', due },
    ];
    const next = toggleDone(list, '4', NOW);
    expect(next).toEqual([
      // same row, same rule, next date: 31 Oct clamps to 30 Nov
      { ...valid, id: '4', due: new Date(2026, 10, 30, 18).getTime(), repeat: { every: 'month', day: 31 } },
      list[1],
      // the finished copy keeps the rule, so history can say which series it was
      { ...valid, id: '8', due, done: true, completedAt: NOW, repeat: { every: 'month', day: 31 } },
    ]);
  });

  it('keeps every finished occurrence as its own record', () => {
    let list: Task[] = [{ ...valid, due, repeat: { every: 'week' } }];
    for (let i = 0; i < 3; i++) list = toggleDone(list, '0', NOW + i * 7 * 24 * 3_600_000);
    expect(list.map((t) => [t.id, t.done])).toEqual([
      ['0', false],
      ['1', true],
      ['2', true],
      ['3', true],
    ]);
    expect(list.filter((t) => t.done).map((t) => new Date(t.due).getDate())).toEqual([31, 7, 14]);
  });

  it('reopens a finished occurrence as a one-off, so it cannot start a second series', () => {
    let list: Task[] = toggleDone([{ ...valid, due, repeat: { every: 'week' } }], '0', NOW);
    list = toggleDone(list, '1', NOW);
    expect(list[1]).toEqual({ ...valid, id: '1', due, done: false });
    expect(list[1]).not.toHaveProperty('repeat');
    list = toggleDone(list, '1', NOW);
    expect(list).toHaveLength(2);
  });
});

describe('nextTaskId', () => {
  it('starts at zero on an empty list', () => {
    expect(nextTaskId([])).toBe('0');
  });

  it('goes past the highest id in use, not the list length', () => {
    // ids have to stay unique after a removal from the middle
    const tasks = [{ ...valid, id: '0' }, { ...valid, id: '7' }] as Task[];
    expect(nextTaskId(tasks)).toBe('8');
  });

  it('ignores ids that are not numbers', () => {
    const tasks = [{ ...valid, id: 'legacy' }, { ...valid, id: '2' }] as Task[];
    expect(nextTaskId(tasks)).toBe('3');
  });
});

/**
 * Reading the deadline list for the backup rather than for a screen.
 *
 * `loadTasks` answers an empty list for a phone with no deadlines and for a
 * file it could not read, and every screen is right not to care. The backup is
 * the one caller for which that difference is the whole question: one of those
 * means the deadlines were deleted and the other means do not touch the
 * archive. This is the reader that can tell them apart.
 */
describe('readTasksVouched', () => {
  it('says absent when the list has never been written', async () => {
    store.getItem.mockResolvedValue(null);
    await expect(readTasksVouched()).resolves.toEqual({ status: 'absent' });
  });

  it('vouches for a list every row of which survived', async () => {
    stored([valid]);
    await expect(readTasksVouched()).resolves.toEqual({
      status: 'complete',
      data: [{ ...valid, completedAt: undefined }],
    });
    expect(store.getItem).toHaveBeenCalledWith(KEY);
  });

  it('reads the list exactly once', async () => {
    stored([valid]);
    await readTasksVouched();
    expect(store.getItem).toHaveBeenCalledTimes(1);
  });

  it('vouches for a list somebody emptied on purpose', async () => {
    // this is the read that lets a deletion reach the backup at all
    stored([]);
    await expect(readTasksVouched()).resolves.toEqual({ status: 'complete', data: [] });
  });

  it('says unreadable for bytes that are not JSON', async () => {
    store.getItem.mockResolvedValue('{ not json');
    await expect(readTasksVouched()).resolves.toEqual({ status: 'unreadable' });
  });

  it('says unreadable when the store itself will not answer', async () => {
    store.getItem.mockRejectedValue(new Error('disk gone'));
    await expect(readTasksVouched()).resolves.toEqual({ status: 'unreadable' });
  });

  it.each([{ id: '0' }, 'a string', 42, null, true])(
    'says unreadable, not partial, for a list stored as %p',
    async (raw) => {
      stored(raw);
      await expect(readTasksVouched()).resolves.toEqual({ status: 'unreadable' });
    }
  );

  it('reports a row the parser threw away', async () => {
    stored([valid, { ...valid, id: undefined }]);
    await expect(readTasksVouched()).resolves.toMatchObject({
      status: 'partial',
      lost: '1 of 2 deadlines',
    });
  });

  it('reports a list nothing survived', async () => {
    stored([null, 'stray']);
    await expect(readTasksVouched()).resolves.toMatchObject({
      status: 'partial',
      lost: '2 of 2 deadlines',
    });
  });

  it('still hands back the rows it did parse', async () => {
    stored([valid, null]);
    const read = await readTasksVouched();
    if (read.status !== 'partial') throw new Error('expected a partial read');
    expect(read.data).toEqual([{ ...valid, completedAt: undefined }]);
  });

  it('does not call the completion-time tidy-up a loss', async () => {
    // the row is all there; clearing a stray finish time off an unfinished task
    // is the parser doing its documented job, not storage losing a deadline
    stored([{ ...valid, done: false, completedAt: 1_800_000_000_000 }]);
    await expect(readTasksVouched()).resolves.toMatchObject({ status: 'complete' });
  });

  it('does not call a dropped repeat rule a lost deadline', async () => {
    stored([{ ...valid, repeat: 'monthly' }]);
    await expect(readTasksVouched()).resolves.toMatchObject({ status: 'complete' });
  });

  it('does not mind fields it has never heard of', async () => {
    // a list written by a later build must still back up from this one
    stored([{ ...valid, priority: 'high' }]);
    await expect(readTasksVouched()).resolves.toMatchObject({ status: 'complete' });
  });
});

/**
 * The judgement itself, with no store underneath it.
 *
 * A shard of the deadline archive coming down off the wire has to be asked the
 * same question the disk is asked — did this parse with nothing lost — and it
 * has to be asked by the same code, or the two answers drift and the weaker one
 * ends up guarding whichever copy is about to be replaced. `pullTaskShards` in
 * `sync.ts` is the wire caller; these check the reader is genuinely made of
 * this rather than merely agreeing with it.
 */
describe('vouchTasksValue', () => {
  it.each([
    ['a list every row of which survived', [valid]],
    ['a list somebody emptied on purpose', []],
    ['a row the parser throws away', [valid, { ...valid, id: undefined }]],
    ['a list that is not a list', { id: '0' }],
  ])('answers for %s exactly as a read off the disk does', async (_case, raw) => {
    stored(raw);
    await expect(readTasksVouched()).resolves.toEqual(vouchTasksValue(raw));
  });

  it('has no way of calling a value absent, because a payload never is', () => {
    // absence is a question about a key in a store. A decrypted document that
    // holds nothing is a document this phone cannot read, and reading it as an
    // empty list is how the whole archive gets emptied.
    expect(vouchTasksValue(null)).toEqual({ status: 'unreadable' });
    expect(vouchTasksValue(undefined)).toEqual({ status: 'unreadable' });
  });
});

/**
 * The reader for the screen that also writes what it read.
 *
 * `loadTasks` hands back the rows that survived, and a screen that loads the
 * list also saves it — so the survivors go over the record they survived and
 * the dropped deadlines stop being recoverable. This says the same thing
 * `readTasksVouched` says, in a shape the screen can render in every case, so
 * the caller has something to draw and something to refuse to save.
 */
describe('readTasksForEditing', () => {
  it('hands back a whole list and says so', async () => {
    stored([valid]);
    await expect(readTasksForEditing()).resolves.toEqual({
      data: [{ ...valid, completedAt: undefined }],
      complete: true,
    });
  });

  it('calls a phone that has never written a deadline complete, because it is', async () => {
    store.getItem.mockResolvedValue(null);
    await expect(readTasksForEditing()).resolves.toEqual({ data: [], complete: true });
  });

  it('hands back the surviving rows and refuses to vouch for them', async () => {
    stored([valid, null]);
    const read = await readTasksForEditing();
    expect(read.complete).toBe(false);
    // there is still a list to draw: what a caller must not do is write it back
    expect(read.data).toEqual([{ ...valid, completedAt: undefined }]);
  });

  it.each([
    ['bytes that are not JSON', '[{"id":"0","tex'],
    ['a list stored as something else entirely', '{"id":"0"}'],
  ])('gives an empty list for %s, and never vouches for it', async (_case, raw) => {
    store.getItem.mockResolvedValue(raw);
    await expect(readTasksForEditing()).resolves.toEqual({ data: [], complete: false });
  });

  it('never vouches for a list the store would not answer for', async () => {
    store.getItem.mockRejectedValue(new Error('disk gone'));
    await expect(readTasksForEditing()).resolves.toEqual({ data: [], complete: false });
  });
});
