/**
 * REVIEW PROBE — not part of the suite. Deleted after the round.
 *
 * Drives the real ledger, the real policy and the real wording end to end, the
 * way the app drives them, and asks what the card says at each step.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearUnvouched,
  emptyLedger,
  loadLedger,
  markDirty,
  recordUnvouched,
  unvouchedKeys,
  unvouchedNote,
  recordBlocked,
} from '../syncLedger';
import { NO_RUNS, statusOf, stampOf } from '../hooks/autoBackupPolicy';
import { backupCard, needsHolds, restoreOffer, damagedNotice } from '../screens/backupWording';

const mockStored = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockStored.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockStored.set(k, v);
    }),
    getAllKeys: jest.fn(async () => [...mockStored.keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map((k) => [k, mockStored.get(k) ?? null])),
  },
}));

beforeEach(() => mockStored.clear());

const memory = (over: Partial<typeof NO_RUNS> = {}) => ({ ...NO_RUNS, ...over });

describe('PROBE 1 — the note the restore never clears', () => {
  it('shows what sync.restoreMonth leaves behind in the ledger', async () => {
    // A screen read September and could only half read it.
    await recordUnvouched('2026-09', '1 of 2 habits');
    expect(unvouchedKeys(await loadLedger())).toEqual(['2026-09']);

    // Now do exactly what sync.restoreMonth does to the ledger after the month
    // has landed on disk: seed the digest, take the park off. Nothing else.
    const { seedPushed, clearBlocked } = jest.requireActual('../syncLedger');
    await seedPushed(null, { '2026-09': 'a'.repeat(64) });
    await clearBlocked('2026-09');

    const after = await loadLedger();
    // eslint-disable-next-line no-console
    console.log('after restoreMonth-equivalent, unvouched =', JSON.stringify(after.unvouched));
    const status = statusOf(after, memory());
    const card = backupCard(status, Date.now(), ['2026-09']);
    // eslint-disable-next-line no-console
    console.log('TITLE:', card.title);
    // eslint-disable-next-line no-console
    console.log('BODY :', card.body);
    // eslint-disable-next-line no-console
    console.log('RESTORE OFFER:', card.restore);
  });
});

describe('PROBE 2 — reconciled is withheld while a document is damaged', () => {
  it('never lets the card claim everything is in the backup', async () => {
    await recordUnvouched('2026-09', '1 of 2 habits');
    const status = statusOf(await loadLedger(), memory({ accounted: true }));
    const card = backupCard(status, Date.now(), null);
    expect(status.reconciled).toBe(false);
    expect(card.body).not.toMatch(/Everything on this phone/);
    expect(card.title).not.toBe('Backed up');
    // eslint-disable-next-line no-console
    console.log('unknown-holds card:', card.title, '|', card.body, '| restore=', card.restore);
  });
});

describe('PROBE 3 — the deadline list gets no door it cannot open', () => {
  it('offers no restore for a damaged deadline list', async () => {
    await recordUnvouched('current', '1 of 2 deadlines');
    const status = statusOf(await loadLedger(), memory({ accounted: true }));
    const card = backupCard(status, Date.now(), ['2026-09']);
    expect(card.restore).toBeNull();
    // eslint-disable-next-line no-console
    console.log('deadline damage:', card.title, '|', card.body);
    // eslint-disable-next-line no-console
    console.log('planner deadline notice:', damagedNotice('deadlines', true));
  });
});

describe('PROBE 4 — the notice length over a month', () => {
  it('measures both notices', () => {
    const plain = damagedNotice('month');
    const withDoor = damagedNotice('month', true);
    // eslint-disable-next-line no-console
    console.log('plain  ', plain.length, plain);
    // eslint-disable-next-line no-console
    console.log('withdoor', withDoor.length, withDoor);
    expect(withDoor.length - plain.length).toBeLessThan(70);
  });
});

describe('PROBE 5 — damage and refusal read as different problems', () => {
  it('prints all four blocked reasons and the damage card side by side', async () => {
    for (const reason of ['too-large', 'unreadable', 'incomplete', 'rejected'] as const) {
      const led = emptyLedger('x');
      led.blocked = ['2026-09'];
      const status = statusOf(led, memory({
        refusals: new Map([['2026-09', { key: '2026-09', reason, detail: 'habits' }]]),
        accounted: true,
      }));
      const card = backupCard(status, Date.now(), ['2026-09']);
      // eslint-disable-next-line no-console
      console.log(`[${reason}] retry=${card.retry} restore=${card.restore}\n  ${card.title}\n  ${card.body}`);
    }
  });
});

describe('PROBE 6 — a damaged month that the backup does not hold', () => {
  it('withdraws the offer and says the copy is the only one', async () => {
    await recordUnvouched('2026-09', '1 of 2 habits');
    const status = statusOf(await loadLedger(), memory({ accounted: true }));
    const card = backupCard(status, Date.now(), ['2026-08']);
    expect(card.restore).toBeNull();
    // eslint-disable-next-line no-console
    console.log('only-copy:', card.title, '|', card.body);
    // eslint-disable-next-line no-console
    console.log('planner clause when not restorable:', restoreOffer(status, ['2026-08']));
  });
});

describe('PROBE 7 — needsHolds and the idle phone', () => {
  it('asks nothing on a clean phone and asks on a damaged one', async () => {
    const clean = statusOf(emptyLedger('x'), memory({ accounted: true }));
    expect(needsHolds(clean)).toBe(false);

    await recordUnvouched('2026-09', '');
    const damaged = statusOf(await loadLedger(), memory({ accounted: true }));
    expect(needsHolds(damaged)).toBe(true);
    // eslint-disable-next-line no-console
    console.log('nameless damage card:', backupCard(damaged, null, ['2026-09']).title);
    // eslint-disable-next-line no-console
    console.log('nameless body:', backupCard(damaged, null, ['2026-09']).body);
  });
});

describe('PROBE 8 — writes on an undamaged read', () => {
  it('counts the ledger writes a clean month costs', async () => {
    const setItem = AsyncStorage.setItem as jest.Mock;
    await clearUnvouched('2026-09');
    // eslint-disable-next-line no-console
    console.log('clearUnvouched on a clean ledger, writes =', setItem.mock.calls.length);
    expect(setItem).not.toHaveBeenCalled();

    await recordUnvouched('2026-09', 'x');
    const first = setItem.mock.calls.length;
    await recordUnvouched('2026-09', 'x');
    // eslint-disable-next-line no-console
    console.log('repeat recordUnvouched, writes went', first, '->', setItem.mock.calls.length);
    expect(setItem.mock.calls.length).toBe(first);
  });
});

describe('PROBE 9 — the stamp moves when the damage does', () => {
  it('changes the stamp so the card re-renders', async () => {
    await recordUnvouched('2026-09', '1 of 2 habits');
    const a = stampOf(statusOf(await loadLedger(), memory()));
    await recordUnvouched('2026-09', '2 of 2 habits');
    const b = stampOf(statusOf(await loadLedger(), memory()));
    expect(a).not.toBe(b);
  });
});

describe('PROBE 10 — two damaged months, one restorable', () => {
  it('leads with the one that has a way out', async () => {
    await recordUnvouched('2026-07', '1 of 3 habits');
    await recordUnvouched('2026-09', '1 of 2 habits');
    const status = statusOf(await loadLedger(), memory({ accounted: true }));
    const card = backupCard(status, Date.now(), ['2026-09']);
    expect(card.restore).toBe('2026-09');
    // eslint-disable-next-line no-console
    console.log('two damaged:', card.title, '|', card.body);
  });
});

describe('PROBE 11 — damage plus refusal on the same phone', () => {
  it('leads with damage and counts the refusal', async () => {
    await recordUnvouched('2026-09', '1 of 2 habits');
    const led = await loadLedger();
    led.blocked = ['2026-08'];
    const status = statusOf(led, memory({
      refusals: new Map([['2026-08', { key: '2026-08', reason: 'rejected' as const }]]),
      accounted: true,
    }));
    const card = backupCard(status, Date.now(), ['2026-09']);
    // eslint-disable-next-line no-console
    console.log('mixed:', card.title, '|', card.body, '| retry=', card.retry);
    expect(card.restore).toBe('2026-09');
  });
});

describe('PROBE 12 — the edit that does not land', () => {
  it('markDirty without a write leaves the note standing', async () => {
    await recordUnvouched('2026-09', '1 of 2 habits');
    await markDirty('2026-09');
    expect(unvouchedNote(await loadLedger(), '2026-09')).toBe('1 of 2 habits');
  });
});

describe('PROBE 13 — a refusal recorded for a damaged month', () => {
  it('shows what a run does to a month already noted as damaged', async () => {
    await recordUnvouched('2026-09', '1 of 2 habits');
    await recordBlocked('2026-09');
    const led = await loadLedger();
    // eslint-disable-next-line no-console
    console.log('blocked =', led.blocked, 'unvouched =', JSON.stringify(led.unvouched));
    const status = statusOf(led, memory({
      refusals: new Map([['2026-09', { key: '2026-09', reason: 'incomplete' as const, detail: '1 of 2 habits' }]]),
      accounted: true,
    }));
    const card = backupCard(status, Date.now(), ['2026-09']);
    // eslint-disable-next-line no-console
    console.log('same month on both lists:', card.title, '|', card.body);
  });
});
