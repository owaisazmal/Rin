import {
  BURST_MS,
  Moment,
  NO_RUNS,
  RETRY_MS,
  RunMemory,
  STALL_MS,
  aftermath,
  dirtyStamp,
  isReconciled,
  sentAnything,
  shouldRun,
  stampOf,
  statusOf,
  turnedAway,
} from '../hooks/autoBackupPolicy';
import { Ledger, emptyLedger } from '../syncLedger';
import type { BackupRun, BlockedDoc } from '../sync';

/** The ledger reads through AsyncStorage; nothing here ever asks it to */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

/** A backup id of the shape `deriveBackupId` produces, without the crypto */
const ID = 'a'.repeat(64);
const DIGEST = '0'.repeat(64);

const SEPTEMBER = '2026-09';
const AUGUST = '2026-08';
const JANUARY = '2026-01';

const MINUTE = 60_000;

/** A phone that has backed up and changed nothing since */
function settledLedger(): Ledger {
  return { ...emptyLedger(ID), digests: { [SEPTEMBER]: DIGEST }, lastPushAt: 1_000 };
}

/** The same phone, with `keys` edited since that backup */
function editedSince(...keys: string[]): Ledger {
  const ledger = settledLedger();
  for (const key of keys) ledger.dirty[key] = 1;
  return ledger;
}

function moment(patch: Partial<Moment> = {}): Moment {
  return {
    ledger: settledLedger(),
    accounted: false,
    seen: '',
    attempted: '',
    stalled: false,
    turnedAway: 0,
    since: 24 * 60 * MINUTE,
    ...patch,
  };
}

/** What the launch has established so far, with only the part under test spelled out */
function memory(patch: Partial<RunMemory> = {}): RunMemory {
  return { ...NO_RUNS, ...patch };
}

/** A finished run, with only the counts each test cares about spelled out */
function run(patch: Partial<Extract<BackupRun, { ok: true }>> = {}): BackupRun {
  return { ok: true, months: 3, pushed: 0, unchanged: 3, skipped: 0, blocked: [], ...patch };
}

const TOO_LARGE: BlockedDoc = { key: JANUARY, reason: 'too-large', detail: 'observations' };
const UNREADABLE: BlockedDoc = { key: AUGUST, reason: 'unreadable' };
const INCOMPLETE: BlockedDoc = { key: AUGUST, reason: 'incomplete', detail: '1 of 2 habits' };
const REFUSED: BlockedDoc = { key: SEPTEMBER, reason: 'rejected' };

/** What a run leaves behind, in the shape the next trigger reads it */
function after(state: RunMemory): Pick<Moment, 'accounted' | 'attempted' | 'stalled'> {
  return {
    accounted: state.accounted,
    attempted: state.attempted,
    stalled: state.stalled,
  };
}

describe('the date the card puts on the backup', () => {
  it('does not move for a run that opened no connection', () => {
    expect(sentAnything(run({ pushed: 0, unchanged: 3 }))).toBe(false);
  });

  it('does not move for a run that found only an edit somebody had undone', () => {
    expect(sentAnything(run({ pushed: 0, unchanged: 1, months: 1 }))).toBe(false);
  });

  it('does not move for a run that found nothing worth sending', () => {
    expect(sentAnything(run({ pushed: 0, unchanged: 0, skipped: 1, months: 0 }))).toBe(false);
  });

  it('moves for a run that reached the server', () => {
    expect(sentAnything(run({ pushed: 2, unchanged: 1 }))).toBe(true);
  });

  it('moves for a run that got some of it through and was refused the rest', () => {
    expect(sentAnything(run({ pushed: 2, blocked: [TOO_LARGE] }))).toBe(true);
  });

  it('does not move for a run that never got out', () => {
    expect(sentAnything({ ok: false, reason: 'offline' })).toBe(false);
  });

  it('does not move when there was no run to speak of', () => {
    // No code in the Keychain, or the Keychain refused to open.
    expect(sentAnything(null)).toBe(false);
  });
});

describe('coming back to the app', () => {
  it('sends an edit made since the last run, whatever the clock says', () => {
    const ledger = editedSince(AUGUST, JANUARY, SEPTEMBER);
    expect(shouldRun('opened', moment({ ledger, attempted: '', since: 20 * MINUTE }))).toBe(true);
  });

  it('does not carry the same set a second time ten minutes later', () => {
    const ledger = editedSince(JANUARY);
    const attempted = dirtyStamp(ledger);
    expect(shouldRun('opened', moment({ ledger, attempted, since: 10 * MINUTE }))).toBe(false);
  });

  it('tries the same set again once the half hour is up', () => {
    const ledger = editedSince(JANUARY);
    const attempted = dirtyStamp(ledger);
    const since = RETRY_MS + MINUTE;
    expect(shouldRun('opened', moment({ ledger, attempted, since }))).toBe(true);
  });

  it('ignores the second of two returns a second apart', () => {
    const ledger = editedSince(AUGUST);
    expect(shouldRun('opened', moment({ ledger, attempted: '', since: BURST_MS - 1 }))).toBe(false);
  });
});

describe('a phone left alone with the app open', () => {
  it('waits for the typing to stop', () => {
    const ledger = settledLedger();
    ledger.dirty[SEPTEMBER] = 3;
    expect(shouldRun('idle', moment({ ledger, seen: `${SEPTEMBER}:2` }))).toBe(false);
  });

  it('sends as soon as the typing has stopped', () => {
    const ledger = settledLedger();
    ledger.dirty[SEPTEMBER] = 3;
    expect(shouldRun('idle', moment({ ledger, seen: `${SEPTEMBER}:3` }))).toBe(true);
  });

  it('does not retry an unchanged set the last run already tried', () => {
    const ledger = editedSince(JANUARY);
    const stamp = dirtyStamp(ledger);
    expect(
      shouldRun('idle', moment({ ledger, seen: stamp, attempted: stamp, since: 5 * MINUTE }))
    ).toBe(false);
  });
});

describe('a phone with nothing to say', () => {
  it('costs nothing at all when the ledger is settled and knows this phone', () => {
    expect(shouldRun('opened', moment())).toBe(false);
    expect(shouldRun('idle', moment())).toBe(false);
  });

  it('checks itself when nothing has ever accounted for this phone', () => {
    expect(shouldRun('opened', moment({ ledger: emptyLedger() }))).toBe(true);
  });

  it('checks itself when the first run was bound but died before it got out', () => {
    expect(shouldRun('opened', moment({ ledger: emptyLedger(ID) }))).toBe(true);
  });

  it('does not check again a minute later while it still cannot get out', () => {
    const since = MINUTE;
    expect(shouldRun('opened', moment({ ledger: emptyLedger(ID), stalled: true, since }))).toBe(
      false
    );
  });

  it('checks again once the five minutes are up', () => {
    const since = STALL_MS + MINUTE;
    expect(shouldRun('opened', moment({ ledger: emptyLedger(ID), stalled: true, since }))).toBe(
      true
    );
  });

  it('stops checking once a run has accounted for it', () => {
    const ledger = emptyLedger(ID);
    expect(shouldRun('opened', moment({ ledger, accounted: true }))).toBe(false);
  });
});

describe('what the card is allowed to assert', () => {
  it('treats a ledger that has never been bound as having verified nothing', () => {
    expect(isReconciled(emptyLedger(), false)).toBe(false);
  });

  it('treats a ledger bound by a run that never reached the server the same way', () => {
    expect(isReconciled(emptyLedger(ID), false)).toBe(false);
  });

  it('counts a digest, which is this phone accounting for a document', () => {
    const ledger = { ...emptyLedger(ID), digests: { [SEPTEMBER]: DIGEST } };
    expect(isReconciled(ledger, false)).toBe(true);
  });

  it('counts a recorded push, which is the same claim with a date on it', () => {
    expect(isReconciled({ ...emptyLedger(ID), lastPushAt: 1_000 }, false)).toBe(true);
  });

  it('counts a finished run, even on a phone with nothing on it', () => {
    expect(isReconciled(emptyLedger(ID), true)).toBe(true);
  });

  it('carries the answer through to the card', () => {
    const unknown = statusOf(emptyLedger(ID), memory());
    expect(unknown.reconciled).toBe(false);
    expect(unknown.waiting).toEqual([]);
    expect(statusOf(settledLedger(), memory()).reconciled).toBe(true);
  });

  it('is not the same status merely because both have nothing waiting', () => {
    const unknown = statusOf(emptyLedger(ID), memory());
    const verified = statusOf(settledLedger(), memory());
    expect(stampOf(unknown)).not.toBe(stampOf(verified));
  });
});

describe('what the card calls waiting', () => {
  /** A January the server refused, and that nobody has touched since */
  function stuck(): Ledger {
    const ledger = settledLedger();
    ledger.dirty[JANUARY] = 1;
    ledger.blocked = [JANUARY];
    ledger.blockedAt = { [JANUARY]: 1 };
    return ledger;
  }

  it('leaves out a document the server refused and nobody has touched since', () => {
    const status = statusOf(stuck(), memory());
    expect(status.waiting).toEqual([]);
    expect(status.blocked).toEqual([{ key: JANUARY }]);
  });

  it('counts a month edited since the refusal, which is waiting again', () => {
    const ledger = stuck();
    ledger.dirty[JANUARY] = 2;
    const status = statusOf(ledger, memory());
    expect(status.waiting).toEqual([JANUARY]);
    expect(status.blocked).toEqual([{ key: JANUARY }]);
  });

  it('agrees with the trigger about what is waiting', () => {
    const ledger = stuck();
    ledger.dirty[JANUARY] = 2;
    expect(statusOf(ledger, memory()).waiting.length).toBeGreaterThan(0);
    expect(shouldRun('opened', moment({ ledger, attempted: '' }))).toBe(true);
  });

  it('names the reason when a run this launch found one out', () => {
    const refusals = new Map([[JANUARY, TOO_LARGE]]);
    expect(statusOf(stuck(), memory({ refusals })).blocked).toEqual([TOO_LARGE]);
  });
});

describe('what a run is allowed to have settled', () => {
  it('marks a run that never got out as having got nowhere', () => {
    // No code in the Keychain, or the Keychain refused to open it.
    const nine = aftermath(memory({ attempted: 'nine oclock' }), null, 'now');

    expect(nine.memory.attempted).toBe('now');
    expect(nine.memory.stalled).toBe(true);
  });

  it('marks a run that died with no signal the same way', () => {
    const dead = aftermath(memory({ attempted: 'nine oclock' }), { ok: false, reason: 'offline' }, 'now');

    expect(dead.memory.attempted).toBe('now');
    expect(dead.memory.stalled).toBe(true);
  });

  it('marks what a run that finished left behind as answered', () => {
    const done = aftermath(memory({ attempted: 'nine oclock', stalled: true }), run(), 'now');

    expect(done.memory.attempted).toBe('now');
    expect(done.memory.stalled).toBe(false);
  });

  it('records the attempt whether or not it got anywhere', () => {
    expect(aftermath(memory(), null, 'now').memory.attempted).toBe('now');
    expect(aftermath(memory(), run(), 'now').memory.attempted).toBe('now');
  });

  it('does not buy half an hour of silence with a run that got nowhere', () => {
    const ledger = editedSince(SEPTEMBER);
    const stamp = dirtyStamp(ledger);
    const since = 10 * MINUTE;

    const answered = moment({ ledger, attempted: stamp, stalled: false, since });
    const gotNowhere = moment({ ledger, attempted: stamp, stalled: true, since });

    expect(shouldRun('opened', answered)).toBe(false);
    expect(shouldRun('opened', gotNowhere)).toBe(true);
  });

  it('never un-checks a phone a finished run has already accounted for', () => {
    const checked = aftermath(memory(), run(), 'now').memory;
    expect(checked.accounted).toBe(true);
    expect(aftermath(checked, null, 'now').memory.accounted).toBe(true);
  });

  it('keeps what the last finished run knew about why things are stuck', () => {
    const knew = aftermath(memory(), run({ blocked: [TOO_LARGE] }), 'now').memory;
    const later = aftermath(knew, { ok: false, reason: 'offline' }, 'now').memory;

    expect([...later.refusals.values()]).toEqual([TOO_LARGE]);
  });

  it('dates the backup only for a run that put bytes on the server', () => {
    expect(aftermath(memory(), run({ pushed: 1 }), 'now').dated).toBe(true);
    expect(aftermath(memory(), run({ pushed: 0 }), 'now').dated).toBe(false);
  });
});

describe('the morning Settings promised and did not deliver', () => {
  /** A run settles at nine, September is edited, then the next run dies offline */
  function theMorning() {
    const ledger = editedSince(SEPTEMBER);
    const nine = aftermath(memory(), run({ pushed: 1 }), '');
    const tunnel = aftermath(nine.memory, { ok: false, reason: 'offline' }, dirtyStamp(ledger));
    return { ledger, tunnel: tunnel.memory };
  }

  it('sends the edits the moment the app comes back', () => {
    const { ledger, tunnel } = theMorning();

    expect(shouldRun('opened', moment({ ledger, ...after(tunnel), since: 14 * MINUTE }))).toBe(true);
  });

  it('still does not try again thirty seconds after the attempt that failed', () => {
    const { ledger, tunnel } = theMorning();

    expect(shouldRun('opened', moment({ ledger, ...after(tunnel), since: 30_000 }))).toBe(false);
  });
});

describe('when the server turns the whole install away', () => {
  it('tells a refusal by the server apart from a judgement about the document', () => {
    expect(turnedAway([TOO_LARGE, UNREADABLE, INCOMPLETE, REFUSED])).toEqual([SEPTEMBER]);
  });

  it('takes the park off what the server refused and leaves the rest parked', () => {
    const outcome = aftermath(memory(), run({ blocked: [REFUSED, TOO_LARGE, INCOMPLETE] }), 'now');

    expect(outcome.unpark).toEqual([SEPTEMBER]);
  });

  it('treats a document this phone would not vouch for as properly settled', () => {
    const outcome = aftermath(memory(), run({ blocked: [UNREADABLE] }), 'now');

    expect(outcome.unpark).toEqual([]);
    expect(outcome.memory.stalled).toBe(false);
  });

  it('comes back to an install it was refused, in minutes rather than never', () => {
    const ledger = editedSince(SEPTEMBER, AUGUST);
    const outcome = aftermath(
      memory({ accounted: true }),
      run({
        pushed: 0,
        blocked: [{ key: SEPTEMBER, reason: 'rejected' }, { key: AUGUST, reason: 'rejected' }],
      }),
      dirtyStamp(ledger)
    );

    expect(outcome.unpark).toEqual([SEPTEMBER, AUGUST]);
    // and it was refused everything, so it got nowhere
    expect(outcome.memory.stalled).toBe(true);
    expect(shouldRun('opened', moment({ ledger, ...after(outcome.memory), since: MINUTE }))).toBe(
      false
    );
    expect(
      shouldRun('opened', moment({ ledger, ...after(outcome.memory), since: STALL_MS + MINUTE }))
    ).toBe(true);
  });

  it('waits the same few minutes however often it has been refused', () => {
    const ledger = editedSince(SEPTEMBER);
    let refused = memory({ accounted: true });
    for (let i = 0; i < 5; i++) {
      refused = aftermath(refused, run({ blocked: [REFUSED] }), dirtyStamp(ledger)).memory;
    }

    const at = (since: number) => shouldRun('opened', moment({ ledger, ...after(refused), since }));
    expect(at(STALL_MS - MINUTE)).toBe(false);
    expect(at(STALL_MS + MINUTE)).toBe(true);
    expect(STALL_MS).toBeLessThan(RETRY_MS);
  });

  it('is still trying after a fortnight of being refused', () => {
    const ledger = editedSince(SEPTEMBER);
    const forever = memory({ accounted: true, attempted: dirtyStamp(ledger), stalled: true });

    expect(
      shouldRun('opened', moment({ ledger, ...after(forever), since: STALL_MS + MINUTE }))
    ).toBe(true);
  });

  it('carries a newly edited month out at once however long the refusals have run', () => {
    const ledger = editedSince(SEPTEMBER, AUGUST);
    const stale = memory({
      accounted: true,
      attempted: dirtyStamp(editedSince(SEPTEMBER)),
      stalled: true,
    });

    expect(shouldRun('opened', moment({ ledger, ...after(stale), since: 4 * BURST_MS }))).toBe(true);
  });

  it('still names what the server turned away, once the park is off it', () => {
    const ledger = editedSince(SEPTEMBER);
    const refusals = new Map([[SEPTEMBER, REFUSED]]);
    const status = statusOf(ledger, memory({ refusals, accounted: true, turnedAway: 1 }));

    expect(status.blocked).toEqual([REFUSED]);
    expect(status.waiting).toEqual([SEPTEMBER]);
  });

  it('names it once when the ledger has parked it as well', () => {
    const ledger = editedSince(JANUARY);
    ledger.blocked = [JANUARY];
    ledger.blockedAt = { [JANUARY]: 1 };
    const refusals = new Map([[JANUARY, { key: JANUARY, reason: 'rejected' as const }]]);

    expect(
      statusOf(ledger, memory({ refusals, accounted: true, turnedAway: 1 })).blocked
    ).toEqual([{ key: JANUARY, reason: 'rejected' }]);
  });

  it('does not let a run it was refused everything of call this phone checked', () => {
    const refused = aftermath(memory(), run({ pushed: 0, blocked: [REFUSED] }), 'now').memory;
    expect(refused.accounted).toBe(false);

    const checked = aftermath(refused, run(), 'now').memory;
    expect(checked.accounted).toBe(true);
    expect(aftermath(checked, run({ blocked: [REFUSED] }), 'now').memory.accounted).toBe(true);
  });

  it('offers a refused document again even with nothing dirty behind it', () => {
    const ledger = settledLedger();
    const outcome = aftermath(
      memory(),
      run({ pushed: 1, blocked: [{ key: AUGUST, reason: 'rejected' }] }),
      dirtyStamp(ledger)
    );
    const morning = { ledger, ...after(outcome.memory) };

    expect(shouldRun('opened', moment({ ...morning, turnedAway: 0 }))).toBe(false);
    expect(shouldRun('opened', moment({ ...morning, turnedAway: 1 }))).toBe(true);
  });
});

describe('the count that has to outlive the app being closed', () => {
  it('counts what the last finished run was turned away from', () => {
    const outcome = aftermath(
      memory(),
      run({ blocked: [REFUSED, { key: AUGUST, reason: 'rejected' }, TOO_LARGE] }),
      'now'
    );

    expect(outcome.memory.turnedAway).toBe(2);
    expect(outcome.answered).toBe(true);
  });

  it('lets a good run take it back to nothing in one go', () => {
    const refused = aftermath(memory(), run({ blocked: [REFUSED] }), 'now').memory;
    expect(refused.turnedAway).toBe(1);

    const cleared = aftermath(refused, run(), 'now');
    expect(cleared.memory.turnedAway).toBe(0);
    expect(cleared.answered).toBe(true);
  });

  it('does not let an attempt that got nowhere speak for what is outstanding', () => {
    const refused = aftermath(memory(), run({ blocked: [REFUSED] }), 'now').memory;

    for (const nothing of [null, { ok: false, reason: 'offline' } as const]) {
      const outcome = aftermath(refused, nothing, 'now');
      expect(outcome.memory.turnedAway).toBe(1);
      expect(outcome.answered).toBe(false);
    }
  });

  it('will not call a phone reconciled while it stands', () => {
    const backedUp = settledLedger();
    expect(statusOf(backedUp, memory()).reconciled).toBe(true);

    const outstanding = statusOf(backedUp, memory({ turnedAway: 1 }));
    expect(outstanding.reconciled).toBe(false);
    expect(outstanding.waiting).toEqual([]);
  });

  it('is a different status from a phone that really has sent everything', () => {
    const behind = statusOf(settledLedger(), memory({ turnedAway: 2 }));
    const settled = statusOf(settledLedger(), memory());

    expect(stampOf(behind)).not.toBe(stampOf(settled));
  });
});

describe('a document this phone cannot read', () => {
  /** A phone that has backed up, and whose September has since rotted on disk */
  function damagedLedger(lost = '1 of 2 habits, 1 grid entry'): Ledger {
    const ledger = settledLedger();
    ledger.unvouched = { [SEPTEMBER]: lost };
    return ledger;
  }

  it('is named on the card, in the words the voucher used', () => {
    const status = statusOf(damagedLedger(), memory());
    expect(status.damaged).toEqual([
      { key: SEPTEMBER, lost: '1 of 2 habits, 1 grid entry' },
    ]);
  });

  it('stops the card saying everything on this phone is in the backup', () => {
    expect(statusOf(settledLedger(), memory()).reconciled).toBe(true);
    expect(statusOf(damagedLedger(), memory()).reconciled).toBe(false);
  });

  it('is not a refusal, and is not waiting either', () => {
    const status = statusOf(damagedLedger(), memory());
    expect(status.blocked).toEqual([]);
    expect(status.waiting).toEqual([]);
  });

  it('names the document even when it can no longer say what was lost', () => {
    expect(statusOf(damagedLedger(''), memory()).damaged).toEqual([{ key: SEPTEMBER }]);
    expect(statusOf(damagedLedger(''), memory()).reconciled).toBe(false);
  });

  it('is a different status from a phone whose months are all readable', () => {
    expect(stampOf(statusOf(damagedLedger(), memory()))).not.toBe(
      stampOf(statusOf(settledLedger(), memory()))
    );
  });

  it('redraws when the same month turns out to have lost more of itself', () => {
    expect(stampOf(statusOf(damagedLedger('1 of 2 habits'), memory()))).not.toBe(
      stampOf(statusOf(damagedLedger('2 of 2 habits'), memory()))
    );
  });

  it('does not start a backup run', () => {
    expect(shouldRun('opened', moment({ ledger: damagedLedger() }))).toBe(false);
    expect(shouldRun('idle', moment({ ledger: damagedLedger() }))).toBe(false);
  });

  it('stops being said the moment the record is whole again', () => {
    const repaired = statusOf(settledLedger(), memory());
    expect(repaired.damaged).toEqual([]);
    expect(repaired.reconciled).toBe(true);
  });
});
