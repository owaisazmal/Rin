import {
  BURST_MS,
  Moment,
  NO_RUNS,
  RETRY_MS,
  RunMemory,
  SETBACK_MS,
  aftermath,
  dirtyStamp,
  isReconciled,
  sentAnything,
  setbackFloor,
  shouldRun,
  stampOf,
  statusOf,
  turnedAway,
} from '../hooks/autoBackupPolicy';
import { Ledger, emptyLedger } from '../syncLedger';
import type { BackupRun, BlockedDoc } from '../sync';

/**
 * The rules the phone backs itself up by.
 *
 * Every one of these was a lie the app told with a straight face, and none of
 * them could be caught from inside it: the card said "last sent today" about a
 * run that opened no connection, it said "Rin sends changes when you open it"
 * and then sat on them for half an hour, and it said "everything on this phone
 * is in the backup" about months nothing had ever looked at. So the tests below
 * are written as the mornings they came from rather than as assertions about
 * functions — an edit at nine o'clock, the app reopened at twenty past — because
 * that is the level at which each of them was wrong.
 */

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

/**
 * A moment to ask about. The defaults are the boring one — a settled phone that
 * has not tried anything in a long time — so each test only has to say what is
 * different about its own morning.
 */
function moment(patch: Partial<Moment> = {}): Moment {
  return {
    ledger: settledLedger(),
    accounted: false,
    seen: '',
    settled: '',
    attempted: '',
    setbacks: 0,
    // nothing was turned away, which is the ordinary morning: the tests about
    // an install the server refused say so for themselves
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
function after(state: RunMemory): Pick<Moment, 'accounted' | 'settled' | 'attempted' | 'setbacks'> {
  return {
    accounted: state.accounted,
    settled: state.settled,
    attempted: state.attempted,
    setbacks: state.setbacks,
  };
}

describe('the date the card puts on the backup', () => {
  it('does not move for a run that opened no connection', () => {
    // Three months, all of them already up there. Nothing was sealed, nothing
    // was sent, and the server has not heard from this phone today.
    expect(sentAnything(run({ pushed: 0, unchanged: 3 }))).toBe(false);
  });

  it('does not move for a run that found only an edit somebody had undone', () => {
    // A month was flagged, read, digested, and turned out to match what is
    // already on the server. The flag comes down; no bytes go anywhere.
    expect(sentAnything(run({ pushed: 0, unchanged: 1, months: 1 }))).toBe(false);
  });

  it('does not move for a run that found nothing worth sending', () => {
    // The permanently-empty month: opened once, never written in, flagged, and
    // deliberately skipped every time. On a thirty-minute loop, forever.
    expect(sentAnything(run({ pushed: 0, unchanged: 0, skipped: 1, months: 0 }))).toBe(false);
  });

  it('moves for a run that reached the server', () => {
    expect(sentAnything(run({ pushed: 2, unchanged: 1 }))).toBe(true);
  });

  it('moves for a run that got some of it through and was refused the rest', () => {
    // Two months are on the server that were not there an hour ago. That is
    // worth a date, and the card leads with what is stuck in any case.
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
    // Nine o'clock: a run, and it settled everything. Five past: three habits
    // ticked. Twenty past: the app is reopened. Settings promises this sends.
    const ledger = editedSince(AUGUST, JANUARY, SEPTEMBER);
    expect(shouldRun('opened', moment({ ledger, settled: '', since: 20 * MINUTE }))).toBe(true);
  });

  it('does not carry the same set a second time ten minutes later', () => {
    // The run at nine tried these and left them exactly as they are. Nothing
    // about this return is new, so nothing about the answer would be either.
    const ledger = editedSince(JANUARY);
    const settled = dirtyStamp(ledger);
    expect(shouldRun('opened', moment({ ledger, settled, since: 10 * MINUTE }))).toBe(false);
  });

  it('tries the same set again once the half hour is up', () => {
    const ledger = editedSince(JANUARY);
    const settled = dirtyStamp(ledger);
    const since = RETRY_MS + MINUTE;
    expect(shouldRun('opened', moment({ ledger, settled, since }))).toBe(true);
  });

  it('ignores the second of two returns a second apart', () => {
    // A cold start is a mount and a foreground at once, and the app switcher
    // can produce several of these while somebody looks for another app.
    const ledger = editedSince(AUGUST);
    expect(shouldRun('opened', moment({ ledger, settled: '', since: BURST_MS - 1 }))).toBe(false);
  });
});

describe('a phone left alone with the app open', () => {
  it('waits for the typing to stop', () => {
    // September is on its third edit this minute; the tick before saw the
    // second. Sending now would put half a paragraph on the server.
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
      shouldRun('idle', moment({ ledger, seen: stamp, settled: stamp, since: 5 * MINUTE }))
    ).toBe(false);
  });
});

describe('a phone with nothing to say', () => {
  it('costs nothing at all when the ledger is settled and knows this phone', () => {
    // No request, no anonymous sign-in, not even a code read out of the
    // Keychain: opening the app on a backed-up phone is free.
    expect(shouldRun('opened', moment())).toBe(false);
    expect(shouldRun('idle', moment())).toBe(false);
  });

  it('checks itself when nothing has ever accounted for this phone', () => {
    // The first launch after an update from a version that had no ledger. The
    // months on this phone may never have been sent, and nothing here can say.
    expect(shouldRun('opened', moment({ ledger: emptyLedger() }))).toBe(true);
  });

  it('checks itself when the first run was bound but died before it got out', () => {
    // `loadLedgerFor` writes the binding before the run reaches the network, so
    // a bound and otherwise empty ledger is a run that failed, not one that
    // found nothing.
    expect(shouldRun('opened', moment({ ledger: emptyLedger(ID) }))).toBe(true);
  });

  it('does not check again a minute later while it still cannot get out', () => {
    const since = MINUTE;
    expect(shouldRun('opened', moment({ ledger: emptyLedger(ID), since }))).toBe(false);
  });

  it('checks again once the half hour is up', () => {
    const since = RETRY_MS + MINUTE;
    expect(shouldRun('opened', moment({ ledger: emptyLedger(ID), since }))).toBe(true);
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
    // Every document was considered and every one of them was skipped. There is
    // nothing to record, and nothing left unaccounted for either.
    expect(isReconciled(emptyLedger(ID), true)).toBe(true);
  });

  it('carries the answer through to the card', () => {
    const unknown = statusOf(emptyLedger(ID), new Map(), false);
    expect(unknown.reconciled).toBe(false);
    expect(unknown.waiting).toEqual([]);
    expect(statusOf(settledLedger(), new Map(), false).reconciled).toBe(true);
  });

  it('is not the same status merely because both have nothing waiting', () => {
    const unknown = statusOf(emptyLedger(ID), new Map(), false);
    const verified = statusOf(settledLedger(), new Map(), false);
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
    // A number that never goes down is not a status, it is a nag. The card says
    // what is stuck instead.
    const status = statusOf(stuck(), new Map(), false);
    expect(status.waiting).toEqual([]);
    expect(status.blocked).toEqual([{ key: JANUARY }]);
  });

  it('counts a month edited since the refusal, which is waiting again', () => {
    // Trimming the month the server would not take is how a person fixes this,
    // and the trimmed version has never been offered to anybody.
    const ledger = stuck();
    ledger.dirty[JANUARY] = 2;
    const status = statusOf(ledger, new Map(), false);
    expect(status.waiting).toEqual([JANUARY]);
    // still listed as stuck: that is what the last run was refused, and it is
    // what the card should still be naming until a run says otherwise
    expect(status.blocked).toEqual([{ key: JANUARY }]);
  });

  it('agrees with the trigger about what is waiting', () => {
    // The card and the decision to run read the same snapshot, so the card can
    // never reassure somebody about a backup the timer privately knows is behind.
    const ledger = stuck();
    ledger.dirty[JANUARY] = 2;
    expect(statusOf(ledger, new Map(), false).waiting.length).toBeGreaterThan(0);
    expect(shouldRun('opened', moment({ ledger, settled: '' }))).toBe(true);
  });

  it('names the reason when a run this launch found one out', () => {
    const refusals = new Map([[JANUARY, TOO_LARGE]]);
    expect(statusOf(stuck(), refusals, false).blocked).toEqual([TOO_LARGE]);
  });
});

describe('what a run is allowed to have settled', () => {
  /**
   * The bug this closes: the hook wrote the marker meaning "a run considered
   * exactly this set and left it" from outside the guard that governed
   * everything else it wrote, so a run that never reached a server wrote it
   * too — and bought the same half hour of silence a considered answer earns.
   */
  it('does not let a run that never got out settle anything', () => {
    // No code in the Keychain, or the Keychain refused to open it.
    const nine = aftermath(memory({ settled: 'nine oclock' }), null, 'now');

    expect(nine.memory.settled).toBe('nine oclock');
    expect(nine.memory.setbacks).toBe(1);
  });

  it('does not let a run that died with no signal settle anything either', () => {
    const dead = aftermath(memory({ settled: 'nine oclock' }), { ok: false, reason: 'offline' }, 'now');

    expect(dead.memory.settled).toBe('nine oclock');
    expect(dead.memory.setbacks).toBe(1);
  });

  it('settles what a run that finished left behind, and forgets the setbacks', () => {
    const done = aftermath(memory({ settled: 'nine oclock', setbacks: 2 }), run(), 'now');

    expect(done.memory.settled).toBe('now');
    expect(done.memory.setbacks).toBe(0);
  });

  it('records the attempt whether or not it got anywhere', () => {
    // The other half of the split. Something has to remember that this exact
    // set was carried, or a phone with no signal would try again on every flick
    // through the app switcher; what that fact may not do is stand in for an
    // answer nobody gave.
    expect(aftermath(memory(), null, 'now').memory.attempted).toBe('now');
    expect(aftermath(memory(), run(), 'now').memory.attempted).toBe('now');
  });

  it('does not buy half an hour of silence with a run that got nowhere', () => {
    // Nine o'clock exactly, as the hook used to record it against as the hook
    // now records it. Ten minutes later, with the edits still on the phone.
    const ledger = editedSince(SEPTEMBER);
    const stamp = dirtyStamp(ledger);
    const since = 10 * MINUTE;

    const asItWas = moment({ ledger, settled: stamp, attempted: stamp, setbacks: 1, since });
    const asItIs = moment({ ledger, settled: '', attempted: stamp, setbacks: 1, since });

    expect(shouldRun('opened', asItWas)).toBe(false);
    expect(shouldRun('opened', asItIs)).toBe(true);
  });

  it('never un-checks a phone a finished run has already accounted for', () => {
    const checked = aftermath(memory(), run(), 'now').memory;
    expect(checked.accounted).toBe(true);
    expect(aftermath(checked, null, 'now').memory.accounted).toBe(true);
  });

  it('keeps what the last finished run knew about why things are stuck', () => {
    // A run that died offline learned nothing about January, so it may not
    // quietly erase what the run before it found out.
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
  /**
   * Nine o'clock: a run, and it settles the phone as it then stands. Five past:
   * three habits ticked. Six past: the idle timer fires and the run dies in a
   * tunnel. The phone goes in a pocket. Twenty past: the app is opened again,
   * on wifi, under a card that has been saying "Rin sends changes when you open
   * it" for the last fifteen minutes.
   *
   * The answer used to be no, and for a reason nobody could see from inside the
   * app: the six-minutes-past run had written the settled marker on its way
   * out, so the half-hour floor for carrying an identical set a second time was
   * applied to a set nothing had ever carried once.
   */
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
    // The other side of it, and the reason the floor exists at all: nothing
    // about half a minute later is new, and a phone in a tunnel is in a tunnel.
    const { ledger, tunnel } = theMorning();

    expect(shouldRun('opened', moment({ ledger, ...after(tunnel), since: 30_000 }))).toBe(false);
  });
});

describe('when the server turns the whole install away', () => {
  it('tells a refusal by the server apart from a judgement about the document', () => {
    // The first three are facts about the bytes: that month is over the cap in
    // the rules, or this phone could not vouch for its own copy of it. Only the
    // last one is the server declining to talk to this install at all.
    expect(turnedAway([TOO_LARGE, UNREADABLE, INCOMPLETE, REFUSED])).toEqual([SEPTEMBER]);
  });

  it('takes the park off what the server refused and leaves the rest parked', () => {
    const outcome = aftermath(memory(), run({ blocked: [REFUSED, TOO_LARGE, INCOMPLETE] }), 'now');

    expect(outcome.unpark).toEqual([SEPTEMBER]);
  });

  it('treats a document this phone would not vouch for as properly settled', () => {
    // Nothing is wrong at the far end here, and nothing is going to change
    // until somebody writes in that month again — which is exactly what a park
    // in the ledger is for.
    const outcome = aftermath(memory(), run({ blocked: [UNREADABLE] }), 'now');

    expect(outcome.unpark).toEqual([]);
    expect(outcome.memory.settled).toBe('now');
    expect(outcome.memory.setbacks).toBe(0);
  });

  /**
   * The failure this is all for. One expired App Check token refuses every
   * document a run offers, and every one of them used to be parked against its
   * own dirty generation. On a phone that has pushed before, that leaves
   * nothing counted as waiting, no reason to start a run, and no way back
   * except editing every month on the phone by hand — a backup that stops for
   * good and never says a word about it.
   */
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
    // and it was refused everything, so it settled nothing
    expect(outcome.memory.settled).toBe('');
    expect(shouldRun('opened', moment({ ledger, ...after(outcome.memory), since: MINUTE }))).toBe(
      false
    );
    expect(
      shouldRun('opened', moment({ ledger, ...after(outcome.memory), since: 3 * MINUTE }))
    ).toBe(true);
  });

  it('waits longer each time and then stops waiting longer', () => {
    // Bounded on both ends: soon enough that a tunnel costs one upload's delay,
    // and never so long that the phone has effectively stopped.
    expect(setbackFloor(0)).toBe(0);
    expect(setbackFloor(1)).toBeLessThan(setbackFloor(2));
    expect(setbackFloor(2)).toBeLessThan(setbackFloor(3));
    expect(setbackFloor(SETBACK_MS.length)).toBe(RETRY_MS);
    expect(setbackFloor(99)).toBe(RETRY_MS);
  });

  it('is still trying after a fortnight of being refused', () => {
    const ledger = editedSince(SEPTEMBER);
    const forever = memory({ accounted: true, attempted: dirtyStamp(ledger), setbacks: 99 });

    expect(
      shouldRun('opened', moment({ ledger, ...after(forever), since: RETRY_MS + MINUTE }))
    ).toBe(true);
  });

  it('carries a newly edited month out at once however long the refusals have run', () => {
    // A September the server will not take must not hold August hostage. The
    // climbing floor is about asking the same question again, and August has
    // never been asked.
    const ledger = editedSince(SEPTEMBER, AUGUST);
    const stale = memory({
      accounted: true,
      attempted: dirtyStamp(editedSince(SEPTEMBER)),
      setbacks: 99,
    });

    expect(shouldRun('opened', moment({ ledger, ...after(stale), since: 4 * BURST_MS }))).toBe(true);
  });

  it('still names what the server turned away, once the park is off it', () => {
    // The ledger deliberately has nothing to say about these any more, so this
    // launch's memory of the run is the only place the refusal exists at all.
    // Without it the card would go quiet about a document that did not go.
    const ledger = editedSince(SEPTEMBER);
    const status = statusOf(ledger, new Map([[SEPTEMBER, REFUSED]]), true);

    expect(status.blocked).toEqual([REFUSED]);
    expect(status.waiting).toEqual([SEPTEMBER]);
  });

  it('names it once when the ledger has parked it as well', () => {
    const ledger = editedSince(JANUARY);
    ledger.blocked = [JANUARY];
    ledger.blockedAt = { [JANUARY]: 1 };
    const refusals = new Map([[JANUARY, { key: JANUARY, reason: 'rejected' as const }]]);

    expect(statusOf(ledger, refusals, true).blocked).toEqual([{ key: JANUARY, reason: 'rejected' }]);
  });

  /**
   * Taking the park off is only half the recovery, and this is the half that
   * was still missing. Once it is off, nothing written down anywhere says those
   * documents did not go — so a run that was refused everything must not be
   * allowed to describe this phone as checked, and what it was refused has to
   * be a reason to run in its own right. Without the first, a first backup that
   * was refused leaves a ledger that knows nothing under a launch that claims
   * to have looked; without the second, a document that was never dirty is
   * never offered again.
   */
  it('does not let a run it was refused everything of call this phone checked', () => {
    const refused = aftermath(memory(), run({ pushed: 0, blocked: [REFUSED] }), 'now').memory;
    expect(refused.accounted).toBe(false);

    // and a run that got a real answer about everything still earns it, and
    // still keeps it when a later one is refused
    const checked = aftermath(refused, run(), 'now').memory;
    expect(checked.accounted).toBe(true);
    expect(aftermath(checked, run({ blocked: [REFUSED] }), 'now').memory.accounted).toBe(true);
  });

  it('offers a refused document again even with nothing dirty behind it', () => {
    // The first backup this phone made: one month went up and the next was
    // refused. The refused one was never dirty — a first run has no flags at
    // all — and the park came off it a moment later, so the ledger afterwards
    // reads exactly like a phone that has backed up and has nothing to send.
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
