import type { BackupRun, BlockedDoc, RestoreRun } from '../sync';
import type { BackupStatus } from '../hooks/autoBackupPolicy';
import { monthDocKey } from '../hooks/useMonthData';
import {
  backupCard,
  damagedNotice,
  restoreFailure,
  needsHolds,
  restoreOffer,
  restoreReport,
  runReport,
} from '../screens/backupWording';

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

  it('does not call an unreadable month a refusal, and says why nothing was sent', () => {
    const card = backupCard(status({ blocked: [{ key: '2026-09', reason: 'unreadable' }] }), null);

    expect(card.title).toMatch(/could not read/i);
    expect(card.body).toMatch(/never sends a copy it cannot read in full/i);
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

  it('says what a half-read month lost, and does not call it a refusal', () => {
    const card = backupCard(
      status({ blocked: [{ key: '2026-09', reason: 'incomplete', detail: '2 of 12 habits' }] }),
      null
    );

    expect(card.title).toContain(SEPTEMBER);
    expect(card.body).toContain('2 of 12 habits');
    expect(card.body).toMatch(/never sends a copy it cannot read in full/i);
    expect(card.body).toMatch(/writing in that month again will send it/i);
    expect(card.body).not.toMatch(/turned (it |them )?down/i);
    expect(card.body).not.toMatch(/will say what stopped/i);
  });

  it('leads with a half-read month rather than with a refusal nobody can act on', () => {
    const card = backupCard(
      status({
        blocked: [REJECTED, { key: '2026-08', reason: 'incomplete', detail: '1 grid entry' }],
      }),
      null
    );

    expect(card.title).toContain(AUGUST);
    expect(card.body).toMatch(/one more is stuck as well/i);
  });

  it('does not promise a good copy in the backup before anything has looked', () => {
    const card = backupCard(status({ blocked: [{ key: '2026-09', reason: 'unreadable' }] }), null);

    expect(card.body).toMatch(/this phone's copy is damaged/i);
    expect(card.body).not.toMatch(/good one|copy of its own/i);
  });

  it('says a server refusal will be retried without anybody doing anything', () => {
    const card = backupCard(status({ blocked: [REJECTED] }), null);

    expect(card.body).toMatch(/keep trying this on its own/i);
  });

  it('offers to try the whole thing again whatever is stuck', () => {
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

  it('will not claim the phone and the backup agree before anything has checked', () => {
    const card = backupCard(status({ reconciled: false }), null);

    expect(card.body).toMatch(/has not checked this phone against the backup yet/i);
    expect(card.body).not.toMatch(/matches the backup/i);
    expect(card.body).not.toMatch(/everything on this phone is in the backup/i);
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
    const report = runReport(
      run({
        months: 2,
        pushed: 1,
        blocked: [{ key: '2026-09', reason: 'incomplete', detail: '1 of 2 deadlines' }],
      })
    );

    expect(report.problem).toMatch(/could only read part of/i);
    expect(report.problem).toContain('1 of 2 deadlines');
    expect(report.problem).toMatch(/never sends a copy it cannot read in full/i);
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

    expect(report.problem).toMatch(/shortening the notes in that month/i);
  });

  it('says an unreadable month was never offered, not turned down', () => {
    const report = runReport(
      run({ months: 2, pushed: 1, blocked: [{ key: '2026-09', reason: 'unreadable' }] })
    );

    expect(report.problem).toMatch(/could not read/i);
    expect(report.problem).toMatch(/never sends a copy it cannot read in full/i);
    expect(report.problem).not.toMatch(/turned down/i);
  });

  it('says what the card says about the same document, word for word', () => {
    const docs: BlockedDoc[] = [
      REJECTED,
      { key: '2026-09', reason: 'too-large', detail: 'grid' },
      { key: '2026-09', reason: 'unreadable' },
      { key: 'current', reason: 'incomplete', detail: '1 of 2 deadlines' },
    ];
    for (const doc of docs) {
      const card = backupCard(status({ blocked: [doc] }), null);
      const report = runReport(run({ months: 2, pushed: 1, blocked: [doc] }));
      expect(report.problem).toBe(`${card.title}. ${card.body}`);
    }
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

  it('says so when the deadline list in the backup would not open', () => {
    const report = restoreReport(restore({ months: 3, deadlines: 'unreadable' }));

    expect(report.problem).toMatch(/deadline list in this backup could not be opened/i);
    expect(report.problem).toMatch(/left as they are/i);
  });

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
    const card = backupCard(HALF_READ, null, []);

    expect(card.body).toContain('2 of 12 habits');
    expect(card.body).not.toMatch(/dropped the rest from the backup/i);
    expect(card.restore).toBeNull();
  });

  it('tells a backup that holds nothing from a question nobody asked', () => {
    expect(backupCard(UNREADABLE, null, []).body).toMatch(/only one there is/i);
    expect(backupCard(UNREADABLE, null).body).not.toMatch(/only one there is/i);
    expect(backupCard(UNREADABLE, null).body).toMatch(
      /writing in that month again will send it/i
    );
  });

  it('never offers to overwrite a month nothing is wrong with', () => {
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

  it('says the backup holds a copy of its own, and why it is not this one', () => {
    const card = backupCard(DAMAGED, null, ['2026-09']);

    expect(card.body).toMatch(/backup holds a copy of its own/i);
    expect(card.body).toMatch(/never sends a copy it cannot read in full/i);
    expect(card.body).not.toMatch(/better|newer|more complete|intact|whole/i);
  });

  it('will not say a copy is up there on the strength of never having asked', () => {
    const card = backupCard(DAMAGED, null);

    expect(card.body).not.toMatch(/backup holds a copy/i);
    expect(card.body).toMatch(/never sends a copy it cannot read in full/i);
  });

  it('says the damaged copy is the only one when the backup does not hold that month', () => {
    const card = backupCard(DAMAGED, null, ['2026-08']);

    expect(card.restore).toBeNull();
    expect(card.body).toMatch(/backup does not hold that month/i);
    expect(card.body).toMatch(/only one there is/i);
    // and it stops implying there is something up there being protected
    expect(card.body).not.toMatch(/backup holds a copy/i);
  });

  it('says neither thing until something has looked', () => {
    const card = backupCard(DAMAGED, null);

    expect(card.restore).toBeNull();
    expect(card.body).not.toMatch(/only one there is/i);
    expect(card.body).toMatch(/writing in that month again will send it/i);
  });

  it('does not offer to try again, because trying again cannot mend this', () => {
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
    const card = backupCard(status({ damaged: [{ key: 'current' }] }), null, ['current']);

    expect(card.title).toMatch(/open deadlines/i);
    expect(card.restore).toBeNull();
    expect(card.body).toMatch(/changing a deadline will send the list again/i);
  });
});

describe('whether the backup is worth a question', () => {
  it('asks nothing on a phone with nothing wrong', () => {
    expect(needsHolds(status())).toBe(false);
    expect(needsHolds(status({ reconciled: false }))).toBe(false);
    expect(needsHolds(status({ waiting: ['2026-08', '2026-09'] }))).toBe(false);
  });

  it('asks when a run was refused something', () => {
    expect(needsHolds(status({ blocked: [REJECTED] }))).toBe(true);
  });

  it('asks when this phone is holding a record it cannot read', () => {
    expect(needsHolds(status({ damaged: [{ key: '2026-09' }] }))).toBe(true);
    expect(needsHolds(status({ damaged: [{ key: 'current' }] }))).toBe(true);
  });
});

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
    for (const record of ['month', 'deadlines'] as const) {
      expect(damagedNotice(record)).not.toMatch(/backup/i);
    }
  });

  it('points at the way out when the backup holds this month', () => {
    const notice = damagedNotice('month', true);

    expect(notice).toMatch(/settings can put the backup's copy of this month back/i);
  });

  it('adds one clause to it and not a paragraph', () => {
    expect(damagedNotice('month', true)).toBe(
      `${damagedNotice('month')} Settings can put the backup's copy of this month back instead.`
    );
  });

  it('offers nothing of the kind for the deadlines, which have no such door', () => {
    expect(damagedNotice('deadlines', true)).toBe(damagedNotice('deadlines'));
    expect(damagedNotice('deadlines', true)).not.toMatch(/backup/i);
  });

  it('lights the clause for the month being offered and for no other', () => {
    const damaged = status({ damaged: [{ key: '2026-08' }, { key: '2026-09' }] });
    const offer = restoreOffer(damaged, ['2026-09']);

    expect(damagedNotice('month', offer === monthDocKey(2026, 8))).toMatch(
      /settings can put the backup's copy/i
    );
    expect(damagedNotice('month', offer === monthDocKey(2026, 7))).not.toMatch(/backup/i);
  });

  it('says nothing about a way out on a phone where there is none', () => {
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

describe('what the card says when the way out does not work', () => {
  it.each([
    ['offline', /could not reach/i, /try again/i],
    ['rejected', /turned this phone away/i, /keep trying/i],
    ['missing', /does not hold that month/i, /untouched/i],
    ['unreadable', /could not be read/i, /left your copy alone/i],
  ] as const)('%s says what happened and what it means', (reason, what, meaning) => {
    const said = restoreFailure(reason);
    expect(said).toMatch(what);
    expect(said).toMatch(meaning);
  });

  it('never claims the damaged copy was replaced', () => {
    for (const reason of ['offline', 'rejected', 'missing', 'unreadable'] as const) {
      expect(restoreFailure(reason)).not.toMatch(/replaced (it|your copy)\b/i);
    }
  });
});

describe('a name that is plural takes a plural verb', () => {
  const stuck = (key: string, reason: 'rejected' | 'too-large') =>
    backupCard(
      { waiting: [], blocked: [{ key, reason }], damaged: [], reconciled: false },
      Date.now(),
      null
    );

  it.each([
    ['2026', 'Deadlines you finished in 2026'],
    ['current', 'Your open deadlines'],
  ])('%s reads as plural', (key, name) => {
    const card = stuck(key, 'rejected');
    expect(card.title).toBe(`${name} are not reaching the backup`);
    expect(card.title).not.toMatch(/\bis not reaching\b/);
    expect(stuck(key, 'too-large').title).toBe(`${name} are too large to back up`);
  });

  it('a month stays singular', () => {
    expect(stuck('2026-09', 'rejected').title).toBe('September 2026 is not reaching the backup');
    expect(stuck('2026-09', 'too-large').title).toBe('September 2026 is too large to back up');
  });
});
