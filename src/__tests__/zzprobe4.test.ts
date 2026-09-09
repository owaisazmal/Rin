/** TEMPORARY ADVERSARIAL PROBE — delete after the review run. */
import { vouchMonthValue } from '../storage';
import { vouchTasksValue } from '../tasks';
import { emptyMonthData } from '../types';

/**
 * The new strictness on the inbound path is only safe if it does not turn
 * legitimate old backups into unrestorable ones. Every payload below is
 * something a real earlier build could have sealed.
 */
describe('INBOUND STRICTNESS: does it reject anything it should accept?', () => {
  const accept = (label: string, raw: unknown) =>
    it(`accepts ${label}`, () => {
      const record = vouchMonthValue(raw);
      if (record.status !== 'complete') {
        // eslint-disable-next-line no-console
        console.log(`REJECTED ${label}: ${JSON.stringify(record)}`);
      }
      expect(record.status).toBe('complete');
    });

  accept('a genuinely empty month', emptyMonthData());
  accept('an empty month with no observations key at all', {
    habits: [],
    grid: {},
    keyGoals: [],
  });
  accept('a month with only habits', { habits: [{ id: '0', name: 'Run' }] });
  accept('a bare empty object', {});
  accept('a full month', {
    ...emptyMonthData(),
    habits: [
      { id: '0', name: 'Run' },
      { id: '1', name: 'Read' },
    ],
    grid: { '1:0': 1, '2:1': 2 },
    keyGoals: [
      { text: 'Ship it', done: false },
      { text: 'Rest', done: true },
      { text: '', done: false },
    ],
    observations: ['went well', '', '', ''],
  });

  it('a month carrying an unknown field from a NEWER build still vouches complete', () => {
    const record = vouchMonthValue({
      ...emptyMonthData(),
      habits: [{ id: '0', name: 'Run' }],
      mood: 'good', // a field this build has never heard of
      streakFreezes: 3,
    });
    // eslint-disable-next-line no-console
    console.log(`newer-build month -> ${record.status}`);
    expect(record.status).toBe('complete');
  });

  it('a habit carrying an unknown field from a newer build still vouches complete', () => {
    const record = vouchMonthValue({
      ...emptyMonthData(),
      habits: [{ id: '0', name: 'Run', colour: 'red', archived: false }],
    });
    // eslint-disable-next-line no-console
    console.log(`newer-build habit -> ${record.status}`);
    expect(record.status).toBe('complete');
  });

  it('catches the real loss it exists for', () => {
    const record = vouchMonthValue({
      ...emptyMonthData(),
      habits: [{ id: '0', name: 'Run' }, { id: '1', name: 42 }],
      grid: { '1:0': 1, '2:1': 2 },
    });
    expect(record.status).toBe('partial');
  });
});

describe('INBOUND STRICTNESS: deadlines', () => {
  const row = { id: '0', text: 'Send the invoice', due: 1_800_000_000_000, done: false };

  it('accepts an empty list', () => {
    expect(vouchTasksValue([]).status).toBe('complete');
  });
  it('accepts a plain list', () => {
    expect(vouchTasksValue([row]).status).toBe('complete');
  });
  it('accepts a row with an unknown field from a newer build', () => {
    const record = vouchTasksValue([{ ...row, priority: 'high', tags: ['work'] }]);
    // eslint-disable-next-line no-console
    console.log(`newer-build deadline row -> ${record.status}`);
    expect(record.status).toBe('complete');
  });
  it('catches a dropped row', () => {
    const record = vouchTasksValue([row, { ...row, id: '1', done: 'no' }]);
    expect(record.status).toBe('partial');
  });
  it('a non-array is unreadable, not empty', () => {
    expect(vouchTasksValue({ tasks: [] }).status).toBe('unreadable');
    expect(vouchTasksValue(null).status).toBe('unreadable');
  });
});
