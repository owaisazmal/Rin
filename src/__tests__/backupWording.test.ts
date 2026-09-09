import type { BackupRun, BlockedDoc, RestoreRun } from '../sync';
import type { BackupStatus } from '../hooks/autoBackupPolicy';
import { backupCard, damagedNotice, restoreReport, runReport } from '../screens/backupWording';

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
  return { waiting: [], blocked: [], reconciled: true, ...over };
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

describe('what the planner says over a record it cannot write back', () => {
  it('names the record, and says plainly that nothing typed is being kept', () => {
    // The one thing an app may not do is take what somebody writes and quietly
    // drop it. A month that cannot be saved is not saved — which is right, and
    // is why it has to be said on the screen where the typing is happening.
    const notice = damagedNotice('month');

    expect(notice).toMatch(/could not read all of this month/i);
    expect(notice).toMatch(/nothing you change here is being saved/i);
    expect(notice).toMatch(/left exactly as it is/i);
  });

  it('says the same about the deadlines, in their own words', () => {
    const notice = damagedNotice('deadlines');

    expect(notice).toMatch(/could not read all of your deadlines/i);
    expect(notice).toMatch(/writing this list back would drop the rest/i);
  });

  it('leaves the backup out of it, which is a different card on a different screen', () => {
    // The damage is on this phone whether or not there is a backup, and the
    // planner has no way of knowing whether there is one.
    for (const record of ['month', 'deadlines'] as const) {
      expect(damagedNotice(record)).not.toMatch(/backup/i);
    }
  });
});
