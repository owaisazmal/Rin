import type { BackupRun, BlockedDoc, RestoreRun } from '../sync';
import type { BackupStatus } from '../hooks/autoBackupPolicy';
import { monthDocKey } from '../hooks/useMonthData';
import {
  backupCard,
  damagedNotice,
  needsHolds,
  restoreOffer,
  restoreReport,
  runReport,
} from '../screens/backupWording';

/**
 * What the backup screens are allowed to tell somebody.
 *
 * Every case below is a sentence the app said out loud while the opposite was
 * true, and none of them could be caught by looking at the screen: they need a
 * transient rejection halfway through a run, or a phone updated from a version
 * that kept no ledger. So they are written as the runs that produced them — two
 * months up and a third refused, a restore of a code that holds less than the
 * phone does — and each asserts the wording rather than the layout, because the
 * wording is what was wrong.
 *
 * Nothing here renders. These are pure functions over a run and over the
 * ledger's account of one, which is the whole reason they live outside the
 * screens.
 */

/** What this machine calls that month, so the assertions read the same everywhere */
const SEPTEMBER = new Date(2026, 8, 1).toLocaleDateString(undefined, {
  month: 'long',
  year: 'numeric',
});
const AUGUST = new Date(2026, 7, 1).toLocaleDateString(undefined, {
  month: 'long',
  year: 'numeric',
});

/** A status as `statusOf` builds it, with only the part under test filled in */
function status(over: Partial<BackupStatus> = {}): BackupStatus {
  return { waiting: [], blocked: [], damaged: [], reconciled: true, ...over };
}

/** A successful run, with the counts that partition every document it saw */
function run(over: Partial<Extract<BackupRun, { ok: true }>> = {}): Extract<
  BackupRun,
  { ok: true }
> {
  return { ok: true, months: 0, pushed: 0, unchanged: 0, skipped: 0, blocked: [], ...over };
}

function restore(
  over: Partial<Extract<RestoreRun, { ok: true }>> = {}
): Extract<RestoreRun, { ok: true }> {
  return { ok: true, months: 0, skipped: 0, deadlines: 'restored', ...over };
}

const REJECTED: BlockedDoc = { key: '2026-09', reason: 'rejected' };
/** The same fault at my end, about a different month, so both can be on screen */
const REJECTED_AUGUST: BlockedDoc = { key: '2026-08', reason: 'rejected' };

describe('the Settings card, when something is stuck', () => {
  /**
   * The run this is about: two months went up, a third came back refused
   * because the App Check token expired between the second write and the third.
   * The card read "The backup server turned this phone away / Nothing new is
   * reaching the backup" while two months were reaching it perfectly well.
   */
  it('names the month that was refused instead of writing off the whole backup', () => {
    const card = backupCard(status({ blocked: [REJECTED] }), null);

    expect(card.title).toContain(SEPTEMBER);
    expect(`${card.title} ${card.body}`).not.toMatch(/turned this phone away/i);
    expect(`${card.title} ${card.body}`).not.toMatch(/nothing new is reaching/i);
  });

  it('says a refusal is my fault and that pressing the button again retries it', () => {
    const card = backupCard(status({ blocked: [REJECTED] }), null);

    expect(card.body).toMatch(/fault at my end/i);
    expect(card.body).toMatch(/backing up again will try it again/i);
    expect(card.attention).toBe(true);
  });

  /**
   * `unreadable` is the odd refusal: nothing was turned down, because nothing
   * was offered. The card used to fall through to the month branch and promise
   * that backing up again would say what stopped it — which it would not, since
   * the next run says exactly the same thing.
   */
  it('does not call an unreadable month a refusal, and says the backup is untouched', () => {
    const card = backupCard(status({ blocked: [{ key: '2026-09', reason: 'unreadable' }] }), null);

    expect(card.title).toMatch(/could not read/i);
    expect(card.body).toMatch(/copy in the backup is untouched/i);
    expect(card.body).not.toMatch(/turned (it |them )?down/i);
    expect(card.body).not.toMatch(/will say what stopped/i);
  });

  it('tells somebody what puts a stuck month back in the queue', () => {
    const card = backupCard(status({ blocked: [{ key: '2026-09', reason: 'unreadable' }] }), null);

    expect(card.body).toMatch(/writing in that month again will send it/i);
  });

  it('tells somebody what puts a stuck deadline list back in the queue', () => {
    const card = backupCard(status({ blocked: [{ key: 'current', reason: 'unreadable' }] }), null);

    expect(card.title).toMatch(/open deadlines/i);
    expect(card.body).toMatch(/changing a deadline will send the list again/i);
  });

  it('names the part of an oversized month that is the bulk of it', () => {
    const card = backupCard(
      status({ blocked: [{ key: '2026-09', reason: 'too-large', detail: 'observations' }] }),
      null
    );

    expect(card.title).toContain(SEPTEMBER);
    expect(card.body).toMatch(/shortening the notes in that month/i);
  });

  /**
   * Two documents stuck for different reasons. Leading with the rejection would
   * send somebody off to delete their own notes over a fault at my end, so the
   * one they can actually act on goes first and the other is counted.
   */
  it('leads with the refusal somebody can do something about', () => {
    const card = backupCard(
      status({
        blocked: [REJECTED, { key: '2026-08', reason: 'too-large', detail: 'grid' }],
      }),
      null
    );

    expect(card.title).toContain(AUGUST);
    expect(card.body).toMatch(/one more is stuck as well/i);
  });

  it('says what it can see and no more when no run this launch knows why', () => {
    const card = backupCard(status({ blocked: [{ key: '2026-09' }] }), null);

    expect(card.title).toContain(SEPTEMBER);
    expect(card.body).toMatch(/backing up now will say what stopped it/i);
  });

  /**
   * `incomplete` is the reason the screens had never had to name, and until
   * they did it fell through to the last branch and told somebody the server
   * had turned down a document the server was never offered. The month parsed
   * perfectly well; two of its habits simply were not in what came back, and
   * sending the rest would have looked entirely healthy on the wire while
   * deleting them from the one copy that is not on this phone.
   */
  it('says what a half-read month lost, and does not call it a refusal', () => {
    const card = backupCard(
      status({ blocked: [{ key: '2026-09', reason: 'incomplete', detail: '2 of 12 habits' }] }),
      null
    );

    expect(card.title).toContain(SEPTEMBER);
    expect(card.body).toContain('2 of 12 habits');
    expect(card.body).toMatch(/copy in the backup is untouched/i);
    expect(card.body).toMatch(/writing in that month again will send it/i);
    expect(card.body).not.toMatch(/turned (it |them )?down/i);
    expect(card.body).not.toMatch(/will say what stopped/i);
  });

  it('leads with a half-read month rather than with a refusal nobody can act on', () => {
    // `incomplete` was missing from the ranking, so it sorted behind everything
    // including the one refusal there is nothing to be done about, and a phone
    // whose September was half readable led with an unrelated rejection.
    const card = backupCard(
      status({
        blocked: [REJECTED, { key: '2026-08', reason: 'incomplete', detail: '1 grid entry' }],
      }),
      null
    );

    expect(card.title).toContain(AUGUST);
    expect(card.body).toMatch(/one more is stuck as well/i);
  });

  /**
   * The tone, which is a fact about what happened rather than a decoration.
   * The backup still holds the good copy of that month, and it holds it
   * *because* this refused to write a damaged one over it. A card that only
   * reports the damage reads as data already lost.
   */
  it('says the backup is holding the good copy rather than that something broke', () => {
    const card = backupCard(status({ blocked: [{ key: '2026-09', reason: 'unreadable' }] }), null);

    expect(card.body).toMatch(/holding on to the good one/i);
    expect(card.body).toMatch(/rather than writing over it/i);
  });

  it('says a server refusal will be retried without anybody doing anything', () => {
    // The one refusal an edit cannot fix. Every other sentence here names an
    // edit as the way back, and for this one that would be advice to type in
    // September for the sake of typing in it.
    const card = backupCard(status({ blocked: [REJECTED] }), null);

    expect(card.body).toMatch(/keep trying this on its own/i);
  });

  it('offers to try the whole thing again whatever is stuck', () => {
    // Editing the month is the documented way back and it is not enough on its
    // own: it does nothing for a server that turned this install away, and
    // nothing for a month shortened outside the app.
    for (const reason of ['too-large', 'unreadable', 'incomplete', 'rejected'] as const) {
      expect(backupCard(status({ blocked: [{ key: '2026-09', reason }] }), null).retry).toBe(true);
    }
    expect(backupCard(status({ blocked: [{ key: '2026-09' }] }), null).retry).toBe(true);
  });

  it('does not offer it when there is nothing stuck to try', () => {
    expect(backupCard(status({ waiting: ['2026-09'] }), null).retry).toBe(false);
    expect(backupCard(status(), 1_000).retry).toBe(false);
    expect(backupCard(status({ reconciled: false }), null).retry).toBe(false);
  });
});

describe('the Settings card, when nothing is stuck', () => {
  /**
   * The phone restored a code holding fewer months than it had on it, so the
   * months it holds alone are named to the ledger and left waiting. It used to
   * read "Everything on this phone matches the backup" over two months that had
   * never been anywhere near a server.
   */
  it('counts months that exist on this phone alone as waiting', () => {
    const card = backupCard(status({ waiting: ['2026-08', '2026-09'] }), null);

    expect(card.title).toBe('2 months waiting');
    expect(card.body).toMatch(/sends changes when you open it/i);
    expect(card.body).not.toMatch(/matches the backup/i);
    expect(card.attention).toBe(true);
  });

  it('says the deadlines are waiting when that is all there is', () => {
    const card = backupCard(status({ waiting: ['current'] }), null);

    expect(card.title).toBe('Your deadlines are waiting');
  });

  /**
   * An empty ledger reads exactly like a settled one. A phone updated from a
   * version that kept no ledger has nothing recorded, nothing dirty and nothing
   * stuck — and the card told it, on that evidence, that its whole history was
   * safe.
   */
  it('will not claim the phone and the backup agree before anything has checked', () => {
    const card = backupCard(status({ reconciled: false }), null);

    expect(card.body).toMatch(/has not checked this phone against the backup yet/i);
    expect(card.body).not.toMatch(/matches the backup/i);
    expect(card.body).not.toMatch(/everything on this phone is in the backup/i);
    // Not an alert: nothing is wrong, it is simply not known yet, and a phone
    // that has just opened is seconds away from knowing.
    expect(card.attention).toBe(false);
  });

  it('says everything matches once a run has checked and found nothing to send', () => {
    const card = backupCard(status(), null);

    expect(card.title).toBe('Backed up');
    expect(card.body).toBe('Everything on this phone matches the backup.');
    expect(card.attention).toBe(false);
  });

  it('dates the reassurance when this phone is the one that sent it', () => {
    const card = backupCard(status(), Date.now());

    expect(card.body).toMatch(/everything on this phone is in the backup/i);
    expect(card.body).toMatch(/last sent today/i);
  });
});

describe('what the backup screen says after a run', () => {
  /**
   * The proven contradiction: two months landed and one was refused, and the
   * screen printed "The backup server turned this app away, so nothing was
   * sent" directly above "3 months are safe".
   */
  it('does not say nothing was sent when something was', () => {
    const report = runReport(run({ months: 3, pushed: 2, blocked: [REJECTED] }));

    expect(report.problem).not.toMatch(/nothing was sent/i);
    expect(report.problem).toContain(SEPTEMBER);
    expect(report.progress).toBe('3 months are safe.');
  });

  it('keeps the whole-install refusal for the run that actually sent nothing', () => {
    const report = runReport(run({ months: 0, pushed: 0, blocked: [REJECTED] }));

    expect(report.problem).toMatch(/turned this app away, so nothing was sent/i);
    expect(report.progress).toBeNull();
  });

  /**
   * Everything was refused, and the count is about months that went up on some
   * earlier run. Both sentences are true; printed together they are an argument.
   */
  it('withholds the count rather than putting it next to a total refusal', () => {
    const report = runReport(run({ months: 4, pushed: 0, unchanged: 4, blocked: [REJECTED] }));

    expect(report.progress).toBeNull();
    expect(report.problem).toMatch(/nothing was sent/i);
  });

  it('promises the next open only when there is nothing stuck', () => {
    const clean = runReport(run({ months: 2, pushed: 2 }));
    const stuck = runReport(run({ months: 2, pushed: 1, blocked: [REJECTED] }));

    expect(clean.problem).toBeNull();
    expect(clean.progress).toBe('2 months are safe. Rin sends new changes whenever you open it.');
    expect(stuck.progress).not.toMatch(/whenever you open it/i);
  });

  it('does not tell somebody the server refused a month it was never offered', () => {
    // The run screen's version of the same hole: `incomplete` fell through to
    // "was turned down by the server", which is false twice over — nothing was
    // offered, and nothing was refused.
    const report = runReport(
      run({
        months: 2,
        pushed: 1,
        blocked: [{ key: '2026-09', reason: 'incomplete', detail: '1 of 2 deadlines' }],
      })
    );

    expect(report.problem).toMatch(/could only read part of/i);
    expect(report.problem).toContain('1 of 2 deadlines');
    expect(report.problem).toMatch(/copy in the backup is untouched/i);
    expect(report.problem).not.toMatch(/turned down by the server/i);
  });

  it('does not boast about zero months on a phone that has none', () => {
    const report = runReport(run({ months: 0, pushed: 1 }));

    expect(report.progress).not.toMatch(/0 months/);
    expect(report.progress).toMatch(/this phone is backed up/i);
  });

  it('says which part of an oversized month to shorten', () => {
    const report = runReport(
      run({
        months: 2,
        pushed: 1,
        blocked: [{ key: '2026-09', reason: 'too-large', detail: 'observations' }],
      })
    );

    expect(report.problem).toMatch(/most of it is the notes/i);
    expect(report.problem).toMatch(/shortening the notes in it/i);
  });

  it('says an unreadable month was never offered, not turned down', () => {
    const report = runReport(
      run({ months: 2, pushed: 1, blocked: [{ key: '2026-09', reason: 'unreadable' }] })
    );

    expect(report.problem).toMatch(/could not read/i);
    expect(report.problem).toMatch(/copy in the backup is untouched/i);
    expect(report.problem).not.toMatch(/turned down/i);
  });

  it('counts the other stuck documents without claiming they share a cause', () => {
    const report = runReport(
      run({
        months: 1,
        pushed: 1,
        blocked: [REJECTED, { key: '2026-08', reason: 'unreadable' }],
      })
    );

    expect(report.problem).toMatch(/one more is stuck as well/i);
    expect(report.problem).not.toMatch(/the same way/i);
  });
});

describe('what the backup screen says after a restore', () => {
  it('says so when a month in the backup would not open', () => {
    const report = restoreReport(restore({ months: 3, skipped: 1 }));

    expect(report.progress).toBe('3 months are back.');
    expect(report.problem).toMatch(/one month in this backup could not be opened/i);
  });

  /**
   * The months came down and the deadline documents would not decrypt. The
   * local list was left exactly as it was, which is the right thing to do and
   * the wrong thing to do silently under "3 months are back".
   */
  it('says so when the deadline list in the backup would not open', () => {
    const report = restoreReport(restore({ months: 3, deadlines: 'unreadable' }));

    expect(report.problem).toMatch(/deadline list in this backup could not be opened/i);
    expect(report.problem).toMatch(/left as they are/i);
  });

  /**
   * Some of the deadline documents opened and some did not. The phone keeps one
   * flat list, so writing the part that arrived would delete the part that did
   * not — it is left alone for the same reason, and it needs a sentence of its
   * own, because "the deadline list could not be opened" is false about the
   * half that plainly was.
   */
  it('says so when only part of the deadline list in the backup would open', () => {
    const report = restoreReport(restore({ months: 3, deadlines: 'partial' }));

    expect(report.problem).toMatch(/only part of the deadline list/i);
    expect(report.problem).toMatch(/left as they are/i);
    expect(report.problem).not.toMatch(/could not be opened, so the deadlines/i);
    expect(report.progress).toBe('3 months are back.');
  });

  it('says nothing at all about deadlines a backup simply does not hold', () => {
    const report = restoreReport(restore({ months: 3, deadlines: 'none' }));

    expect(report.problem).toBeNull();
    expect(report.progress).toBe('3 months are back.');
  });

  it('does not report months as back when none of them opened', () => {
    const report = restoreReport(restore({ months: 0, skipped: 2 }));

    expect(report.progress).toBeNull();
    expect(report.problem).toMatch(/no month on this phone was replaced/i);
  });
});

/**
 * The way out of a damaged month, offered where the damage is named.
 *
 * Everything above this point tells somebody to write in the month again, which
 * is true and is also the trap: the moment they do, the half of the month this
 * phone could read becomes a healthy record and the next run carries it over
 * the whole copy on the server. When the backup holds that month there is a
 * repair that keeps the data instead, and the card is the one place anybody
 * will hear about it.
 *
 * The offer has to be exact in both directions. Naming a restore that would
 * come back `missing` sends somebody after a button that must not be there;
 * withholding the answer when nothing has looked would tell them their month
 * exists nowhere but this phone on the strength of never having asked.
 */
describe('the way out of a damaged month', () => {
  const UNREADABLE = status({ blocked: [{ key: '2026-09', reason: 'unreadable' }] });
  const HALF_READ = status({
    blocked: [{ key: '2026-09', reason: 'incomplete', detail: '2 of 12 habits' }],
  });

  it('offers to pull a month back when the backup is known to hold it', () => {
    const card = backupCard(UNREADABLE, null, ['2026-09']);

    expect(card.restore).toBe('2026-09');
    expect(card.body).toMatch(/puts the backup's copy on this phone/i);
    expect(card.title).toContain(SEPTEMBER);
  });

  it('says what the restore costs in the same breath as what it does', () => {
    // A restore is a replacement, so whatever was typed into that month since
    // the record went bad goes with the record. Somebody choosing between the
    // two ways out has to be told that before they choose, not afterwards.
    const card = backupCard(UNREADABLE, null, ['2026-09']);

    expect(card.body).toMatch(/anything written in it since the damage goes with it/i);
  });

  it('offers it for a month that half read as readily as one that would not read', () => {
    const card = backupCard(HALF_READ, null, ['2026-09']);

    expect(card.restore).toBe('2026-09');
    expect(card.body).toContain('2 of 12 habits');
    expect(card.body).toMatch(/puts the backup's copy on this phone/i);
  });

  it('stops advising the edit that would cost the good copy', () => {
    // The two sentences are alternatives, not a pair. Printed together, the
    // card would be recommending the repair that loses data beside the one
    // that does not.
    for (const state of [UNREADABLE, HALF_READ]) {
      expect(backupCard(state, null, ['2026-09']).body).not.toMatch(
        /writing in that month again will send it/i
      );
    }
  });

  it('says the damaged copy is the only one when the backup does not hold it', () => {
    const card = backupCard(UNREADABLE, null, ['2026-08']);

    expect(card.restore).toBeNull();
    expect(card.body).toMatch(/backup does not hold that month/i);
    expect(card.body).toMatch(/only one there is/i);
    expect(card.body).toMatch(/only way forward/i);
    // and it does not go on claiming a copy up there is being protected
    expect(card.body).not.toMatch(/copy in the backup is untouched/i);
  });

  it('does not claim the backup would have lost anything it never held', () => {
    // The half-read sentence says sending the survivors would have dropped the
    // rest from the backup too. With nothing up there that is simply not what
    // would have happened, and the month is still not sent for its own reason.
    const card = backupCard(HALF_READ, null, []);

    expect(card.body).toContain('2 of 12 habits');
    expect(card.body).not.toMatch(/dropped the rest from the backup/i);
    expect(card.restore).toBeNull();
  });

  /**
   * The distinction the whole parameter exists for. An empty list is somebody
   * having looked and found nothing; no list at all is nobody having looked,
   * and those are opposite things to say about somebody's month.
   */
  it('tells a backup that holds nothing from a question nobody asked', () => {
    expect(backupCard(UNREADABLE, null, []).body).toMatch(/only one there is/i);
    expect(backupCard(UNREADABLE, null).body).not.toMatch(/only one there is/i);
    expect(backupCard(UNREADABLE, null).body).toMatch(
      /writing in that month again will send it/i
    );
  });

  it('never offers to overwrite a month nothing is wrong with', () => {
    // Too large, turned down, and stuck for a reason no run this launch knows:
    // in all three the record on this phone is intact and readable, so pulling
    // the backup's copy over it would delete good data to fix nothing.
    const intact = [
      { key: '2026-09', reason: 'too-large' as const, detail: 'observations' },
      { key: '2026-09', reason: 'rejected' as const },
      { key: '2026-09' },
    ];
    for (const doc of intact) {
      expect(backupCard(status({ blocked: [doc] }), null, ['2026-09']).restore).toBeNull();
    }
  });

  it('never offers it for the deadlines, which do not come down one at a time', () => {
    const card = backupCard(
      status({ blocked: [{ key: 'current', reason: 'unreadable' }] }),
      null,
      ['current']
    );

    expect(card.restore).toBeNull();
    expect(card.body).toMatch(/changing a deadline will send the list again/i);
  });

  it('has nothing to offer on the cards where nothing is stuck', () => {
    expect(backupCard(status({ waiting: ['2026-09'] }), null, []).restore).toBeNull();
    expect(backupCard(status(), 1_000, []).restore).toBeNull();
    expect(backupCard(status({ reconciled: false }), null, []).restore).toBeNull();
  });
});

/**
 * The month that went bad lying still, which is the state no run ever sees.
 *
 * A backup run only looks at documents whose contents have changed, so a
 * September damaged on the disk is never read, never refused, never blocked and
 * never named. The card read that silence as nothing being wrong and said
 * "Everything on this phone is in the backup" — over a month it could not read,
 * on the same phone whose planner was saying that writing in that month lets go
 * of the part that did not survive. The rescue existed the whole time and there
 * was no state in which the app ever offered it.
 *
 * These are the ledger's own notes, written down by the screens as they read
 * the records, and they are the only evidence there is: no run, no request, no
 * sign-in.
 */
describe('the Settings card, when this phone cannot read one of its own months', () => {
  const DAMAGED = status({ damaged: [{ key: '2026-09', lost: '2 of 12 habits' }] });
  const UNNAMED = status({ damaged: [{ key: '2026-09' }] });

  it('names the month and says the copy on this phone is damaged', () => {
    const card = backupCard(DAMAGED, Date.now(), ['2026-09']);

    expect(card.title).toContain(SEPTEMBER);
    expect(card.body).toMatch(/this phone's copy is damaged/i);
    expect(card.attention).toBe(true);
  });

  it('never calls a phone with a month it cannot read a phone that is backed up', () => {
    // The whole fault, in one assertion. `reconciled` is true here on purpose:
    // a run may genuinely have accounted for every document it was allowed to
    // look at and still know nothing about this one.
    const card = backupCard(status({ damaged: [{ key: '2026-09' }], reconciled: true }), Date.now());

    expect(card.title).not.toBe('Backed up');
    expect(card.body).not.toMatch(/everything on this phone is in the backup/i);
    expect(card.body).not.toMatch(/matches the backup/i);
  });

  it('names what did not survive when the note names it', () => {
    expect(backupCard(DAMAGED, null, ['2026-09']).body).toContain('2 of 12 habits');
    expect(backupCard(DAMAGED, null, ['2026-09']).title).toMatch(/could only read part of/i);
  });

  it('invents no measurement for a record that could not be read at all', () => {
    // `lost` is absent rather than empty for a record nothing could be made of,
    // and "part of it did not survive" about that would be describing damage
    // nobody measured.
    const card = backupCard(UNNAMED, null, ['2026-09']);

    expect(card.title).toMatch(/could not read/i);
    expect(card.body).not.toMatch(/did not survive/i);
    expect(card.body).toMatch(/this phone's copy is damaged/i);
  });

  it('offers to put the backup’s copy back when the backup holds the month', () => {
    const card = backupCard(DAMAGED, null, ['2026-09']);

    expect(card.restore).toBe('2026-09');
    expect(card.body).toMatch(/puts the backup's copy on this phone/i);
    expect(card.body).toMatch(/anything written in it since the damage goes with it/i);
  });

  /**
   * What the app knows and the exact edge of it. Nothing damaged is ever put on
   * the wire, so whatever is up there did not come from this copy — which is
   * not a claim that it is better. It may be a month older, and nothing here
   * has opened it.
   */
  it('says the backup has a copy of its own that did not come from this one', () => {
    const card = backupCard(DAMAGED, null, ['2026-09']);

    expect(card.body).toMatch(/backup is holding a copy of its own/i);
    expect(card.body).toMatch(/did not come from this one/i);
    // and stops there: nothing here has opened that copy, and it may well be a
    // month older than what is on screen
    expect(card.body).not.toMatch(/better|newer|more complete|intact|whole/i);
  });

  it('will not say a copy is up there on the strength of never having asked', () => {
    // The same reassurance is a claim when nothing has looked. What survives is
    // the half that is true either way: whatever the backup holds, if it holds
    // anything, it did not come from this.
    const card = backupCard(DAMAGED, null);

    expect(card.body).not.toMatch(/backup is holding a copy/i);
    expect(card.body).toMatch(/nothing in the backup came from this damaged copy/i);
  });

  it('says the damaged copy is the only one when the backup does not hold that month', () => {
    const card = backupCard(DAMAGED, null, ['2026-08']);

    expect(card.restore).toBeNull();
    expect(card.body).toMatch(/backup does not hold that month/i);
    expect(card.body).toMatch(/only one there is/i);
    // and it stops implying there is something up there being protected
    expect(card.body).not.toMatch(/nothing in the backup came from/i);
  });

  it('says neither thing until something has looked', () => {
    // An empty list is somebody having asked; no list at all is nobody having
    // asked, and telling those apart is the difference between "your month
    // exists nowhere else" and a guess.
    const card = backupCard(DAMAGED, null);

    expect(card.restore).toBeNull();
    expect(card.body).not.toMatch(/only one there is/i);
    expect(card.body).toMatch(/writing in that month again will send it/i);
  });

  it('does not offer to try again, because trying again cannot mend this', () => {
    // The next run reads the same damaged record and declines to send it for
    // the same reason. A button promising otherwise is a remedy that cannot
    // work, which is the one thing this card may never offer.
    for (const holds of [['2026-09'], ['2026-08'], undefined]) {
      expect(backupCard(DAMAGED, null, holds).retry).toBe(false);
    }
  });

  it('offers it again once something is stuck that a retry could reach', () => {
    const card = backupCard(
      status({ damaged: [{ key: '2026-09' }], blocked: [REJECTED_AUGUST] }),
      null,
      ['2026-09']
    );

    expect(card.retry).toBe(true);
    expect(card.body).toMatch(/one more is stuck as well/i);
  });

  /**
   * The bug this whole card exists inside of, one level up. A rejection is a
   * fault at my end that clears itself; damage is the one state where the
   * advice on every other card — write in that month again — destroys the only
   * remedy there is. Leading with the rejection buried September entirely.
   */
  it('leads with the damaged month rather than with a refusal that will clear itself', () => {
    const card = backupCard(
      status({ damaged: [{ key: '2026-09' }], blocked: [REJECTED_AUGUST] }),
      null,
      ['2026-09']
    );

    expect(card.title).toContain(SEPTEMBER);
    expect(card.restore).toBe('2026-09');
  });

  it('leads with the damaged month that has a way out', () => {
    // Two damaged months and one copy in the backup. Sorted order alone would
    // have led with August, said there was nothing to be done, and left the one
    // offer on the screen unreachable.
    const card = backupCard(
      status({ damaged: [{ key: '2026-08' }, { key: '2026-09' }] }),
      null,
      ['2026-09']
    );

    expect(card.title).toContain(SEPTEMBER);
    expect(card.restore).toBe('2026-09');
    expect(card.body).toMatch(/one more is stuck as well/i);
  });

  it('counts a month that is damaged and blocked once, not twice', () => {
    // The same September, found by a run and found by the planner. Counting it
    // on both lists would tell somebody a second month was in trouble.
    const card = backupCard(
      status({
        damaged: [{ key: '2026-09', lost: '2 of 12 habits' }],
        blocked: [{ key: '2026-09', reason: 'incomplete', detail: '2 of 12 habits' }],
      }),
      null,
      ['2026-09']
    );

    expect(card.title).toContain(SEPTEMBER);
    expect(card.body).not.toMatch(/stuck as well/i);
  });

  it('counts the documents in trouble, not the entries about them', () => {
    // August is on both lists and September is the one being read about, so
    // there is exactly one other document here however many rows say so.
    const card = backupCard(
      status({
        damaged: [{ key: '2026-08' }, { key: '2026-09' }],
        blocked: [{ key: '2026-08', reason: 'incomplete' }],
      }),
      null,
      ['2026-09']
    );

    expect(card.title).toContain(SEPTEMBER);
    expect(card.body).toMatch(/one more is stuck as well/i);
  });

  /**
   * The deadline names are prose, not proper nouns — "Your open deadlines" is
   * written as the heading it usually is — and every sentence that puts one
   * after a verb had it standing there in mid-air with its capital on. A month
   * keeps its capital wherever it falls, which is what makes this a question
   * about the document rather than about the letter.
   */
  it('does not leave a capital standing in the middle of a sentence', () => {
    const cards = [
      backupCard(status({ damaged: [{ key: 'current' }] }), null),
      backupCard(status({ damaged: [{ key: '2024', lost: '1 of 2 deadlines' }] }), null),
      backupCard(status({ blocked: [{ key: 'current', reason: 'unreadable' }] }), null),
      backupCard(status({ blocked: [{ key: '2024', reason: 'incomplete' }] }), null),
    ];
    for (const card of cards) {
      expect(card.title).not.toMatch(/read (part of )?(Your|Deadlines)/);
      expect(card.title.toLowerCase()).toMatch(/deadlines/);
    }
    // and the month, which is a name, keeps its own
    expect(backupCard(status({ damaged: [{ key: '2026-09' }] }), null).title).toContain(SEPTEMBER);
    // as does a name that starts the sentence rather than sitting inside one
    expect(backupCard(status({ blocked: [{ key: 'current', reason: 'rejected' }] }), null).title)
      .toMatch(/^Your open deadlines/);
  });

  it('names a damaged deadline list and never offers to pull one down', () => {
    // The archive travels as several documents and lands as one flat list, so
    // there is no restoring one list over another — the edit stays the way out.
    const card = backupCard(status({ damaged: [{ key: 'current' }] }), null, ['current']);

    expect(card.title).toMatch(/open deadlines/i);
    expect(card.restore).toBeNull();
    expect(card.body).toMatch(/changing a deadline will send the list again/i);
  });
});

/**
 * What the card has to be asked before it can be drawn, and what that costs.
 *
 * An idle phone — opened, nothing edited — costs zero reads, zero writes and no
 * anonymous sign-in, and it has cost that on every round of this. Finding out
 * what the backup holds is a listing, so the question is asked for the states
 * whose wording turns on the answer and for no others.
 */
describe('whether the backup is worth a question', () => {
  it('asks nothing on a phone with nothing wrong', () => {
    expect(needsHolds(status())).toBe(false);
    expect(needsHolds(status({ reconciled: false }))).toBe(false);
    expect(needsHolds(status({ waiting: ['2026-08', '2026-09'] }))).toBe(false);
  });

  it('asks when a run was refused something', () => {
    expect(needsHolds(status({ blocked: [REJECTED] }))).toBe(true);
  });

  /**
   * The state that never asked, and the whole reason this is a function rather
   * than a condition in the root component. A damaged month is not waiting, not
   * blocked and not dirty, so every existing condition read it as a quiet
   * phone — and the card that would have offered the rescue was never given the
   * one fact it needed to offer it.
   */
  it('asks when this phone is holding a record it cannot read', () => {
    expect(needsHolds(status({ damaged: [{ key: '2026-09' }] }))).toBe(true);
    expect(needsHolds(status({ damaged: [{ key: 'current' }] }))).toBe(true);
  });
});

/**
 * The offer, read off the card rather than worked out beside it.
 *
 * Two answers to "is there a way out of this one" is the shape of every bug in
 * this file's header, and this one is read on a different screen — so a
 * disagreement would show up as a planner pointing at a button Settings is not
 * drawing.
 */
describe('the month the card is offering to put back', () => {
  it('is the month the card offers, in every state the card has', () => {
    const states = [
      status(),
      status({ reconciled: false }),
      status({ waiting: ['2026-09'] }),
      status({ blocked: [REJECTED] }),
      status({ blocked: [{ key: '2026-09', reason: 'unreadable' }] }),
      status({ blocked: [{ key: '2026-09', reason: 'incomplete', detail: '1 grid entry' }] }),
      status({ blocked: [{ key: '2026-09', reason: 'too-large', detail: 'grid' }] }),
      status({ blocked: [{ key: '2026-09' }] }),
      status({ damaged: [{ key: '2026-09' }] }),
      status({ damaged: [{ key: 'current' }] }),
      status({ damaged: [{ key: '2026-09' }], blocked: [REJECTED_AUGUST] }),
    ];
    for (const state of states) {
      for (const holds of [undefined, [], ['2026-09'], ['2026-08', '2026-09']]) {
        expect(restoreOffer(state, holds)).toBe(backupCard(state, Date.now(), holds).restore);
      }
    }
  });

  it('names the damaged month when the backup holds it, and nothing otherwise', () => {
    const damaged = status({ damaged: [{ key: '2026-09' }] });

    expect(restoreOffer(damaged, ['2026-09'])).toBe('2026-09');
    expect(restoreOffer(damaged, [])).toBeNull();
    expect(restoreOffer(damaged)).toBeNull();
    expect(restoreOffer(status())).toBeNull();
  });
});

describe('what the planner says over a record it cannot write back', () => {
  it('names the record, and separates opening it from typing in it', () => {
    // The one thing an app may not do is take what somebody writes and quietly
    // drop it — and the other is refuse to save and not say so. Both halves are
    // here because the write guard turns on intent, not on damage: opening the
    // month leaves the disk alone, typing in it saves and is how a person
    // rescues one. Said on the screen where the typing is happening.
    const notice = damagedNotice('month');

    expect(notice).toMatch(/could not read all of this month/i);
    expect(notice).toMatch(/only the part that survived/i);
    expect(notice).toMatch(/opening this month changes nothing/i);
    expect(notice).toMatch(/writing in it saves/i);
    // and it does not pretend the loss is recoverable by typing
    expect(notice).toMatch(/lets go of the part that did not/i);
  });

  it('says the same about the deadlines, in their own words', () => {
    const notice = damagedNotice('deadlines');

    expect(notice).toMatch(/could not read all of your deadlines/i);
    expect(notice).toMatch(/opening this list changes nothing/i);
    expect(notice).toMatch(/writing in it saves/i);
  });

  it('leaves the backup out of it, which is a different card on a different screen', () => {
    // The damage is on this phone whether or not there is a backup, and the
    // planner has no way of knowing whether there is one.
    for (const record of ['month', 'deadlines'] as const) {
      expect(damagedNotice(record)).not.toMatch(/backup/i);
    }
  });

  /**
   * Unless the planner has been told there is one, which is the one thing that
   * changes what the sentence above is advice to do. Saying nothing then leaves
   * somebody typing over a month they could have had back whole.
   */
  it('points at the way out when the backup holds this month', () => {
    const notice = damagedNotice('month', true);

    expect(notice).toMatch(/settings can put the backup's copy of this month back/i);
  });

  it('adds one clause to it and not a paragraph', () => {
    // This sits over somebody's month, above the grid they opened the app to
    // look at. The case for the restore, and the price of it, belong on the
    // card in Settings where there is room to make them.
    expect(damagedNotice('month', true)).toBe(
      `${damagedNotice('month')} Settings can put the backup's copy of this month back instead.`
    );
  });

  it('offers nothing of the kind for the deadlines, which have no such door', () => {
    // The archive travels as several documents and lands as one flat list, so
    // there is no pulling one deadline list down over another.
    expect(damagedNotice('deadlines', true)).toBe(damagedNotice('deadlines'));
    expect(damagedNotice('deadlines', true)).not.toMatch(/backup/i);
  });

  /**
   * The planner's half of the wiring, written as the expression the screen
   * actually evaluates. It holds a year and a month and is handed a document
   * name, and the clause appears when those are the same month — which is what
   * keeps the promise exact on a phone where two months are damaged and only
   * one of them has a copy waiting.
   */
  it('lights the clause for the month being offered and for no other', () => {
    const damaged = status({ damaged: [{ key: '2026-08' }, { key: '2026-09' }] });
    const offer = restoreOffer(damaged, ['2026-09']);

    expect(damagedNotice('month', offer === monthDocKey(2026, 8))).toMatch(
      /settings can put the backup's copy/i
    );
    expect(damagedNotice('month', offer === monthDocKey(2026, 7))).not.toMatch(/backup/i);
  });

  it('says nothing about a way out on a phone where there is none', () => {
    // Nobody has looked, or the backup does not hold it: either way the planner
    // is handed null and the notice is the sentence it always was.
    for (const holds of [undefined, [], ['2026-08']]) {
      const offer = restoreOffer(status({ damaged: [{ key: '2026-09' }] }), holds);
      expect(damagedNotice('month', offer === monthDocKey(2026, 8))).not.toMatch(/backup/i);
    }
  });

  it('keeps clear of the words that promise more than this app does', () => {
    for (const record of ['month', 'deadlines'] as const) {
      for (const restorable of [false, true]) {
        expect(damagedNotice(record, restorable)).not.toMatch(
          /daily|automatically|continuously/i
        );
      }
    }
  });
});
