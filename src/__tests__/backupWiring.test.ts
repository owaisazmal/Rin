import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * That the screens are wired to the decisions, which nothing else here can see.
 *
 * Every sentence the backup card and the planner's notice are allowed to say is
 * a pure function, tested to the word in `backupWording.test.ts`, and every one
 * of them is worthless if the screen forgets to ask. That is not a hypothetical
 * failure mode: it is the exact shape of the fault this round exists to close.
 * `damagedNotice` grew a clause pointing at the way out, and `sync.restoreMonth`
 * was built, tested and wired — and the app went on saying "Everything on this
 * phone is in the backup" over a damaged month, because the condition that
 * decides whether to ask was one state too narrow and the planner was never
 * handed the answer.
 *
 * The suite runs in plain Node against pure modules; a React Native screen needs
 * a renderer this project does not carry, and adding one to assert three
 * arguments would be a far larger thing than the arguments. So these read the
 * source, with the whitespace taken out so a reformat cannot fail them, and each
 * asserts one join that no other test can reach.
 */

const root = join(__dirname, '..', '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\s+/g, '');

describe('the screens ask the questions the words depend on', () => {
  /**
   * The root looks up what the backup holds only when the card's wording turns
   * on the answer, and `needsHolds` is where that is decided. Written out as its
   * own condition, this drifted from the wording it serves the moment a state
   * was added — which is precisely how a damaged month came to be a state the
   * lookup had never heard of.
   */
  it('guards the listing with the condition that lives beside the wording', () => {
    const app = source('App.tsx');

    expect(app).toContain('conststuck=needsHolds(backupStatus)');
    // and there is exactly one place in the root that reads the backup at all
    expect(app.match(/listMonths\(/g)).toHaveLength(1);
  });

  /**
   * And the planner is handed the answer rather than going to find one. It
   * compares the month it has open against the document name that came down, so
   * the clause about Settings appears over the month Settings is offering and
   * over no other — the whole reason this is a name and not a flag.
   */
  it('lights the planner notice from the month handed down, not from the backup', () => {
    const planner = source('src/screens/PlannerScreen.tsx');

    expect(planner).toContain("damagedNotice('month',restorableMonth===monthDocKey(year,month))");
    // the deadline notice has no such door, and must not grow one by copy
    expect(planner).toContain("damagedNotice('deadlines')");
    // nothing on this screen goes looking for a backup of its own
    expect(planner).not.toMatch(/listMonths|backupHolds|loadCode/);
  });

  /** One prop, passed whole, through the one component between them */
  it('carries the month from the root to the planner', () => {
    const navigator = source('src/navigation/Navigator.tsx');

    expect(source('App.tsx')).toContain('restorableMonth={restorableMonth}');
    expect(navigator).toContain('restorableMonth={restorableMonth}');
  });

  /**
   * The restore is the one destructive thing Settings can do to somebody's own
   * data, and it costs whatever was written into that month since the record
   * went bad. It confirms first, the way forgetting the code does, and it says
   * what it costs at the moment of the tap rather than only in the paragraph
   * above the button.
   */
  it('confirms the restore before it replaces anything', () => {
    const settings = source('src/screens/SettingsScreen.tsx');
    const restore = settings.slice(settings.indexOf('constrestore=(key:string)'));

    expect(restore).toContain('Alert.alert(');
    expect(restore).toContain("text:'Cancel',style:'cancel'");
    expect(restore).toContain("style:'destructive'");
    expect(restore.slice(0, restore.indexOf('style:'))).toMatch(/Anythingwritteninitsincethedamageislostwithit/);
  });
});
