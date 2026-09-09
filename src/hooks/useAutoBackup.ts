import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { Ledger, loadLedger } from '../syncLedger';
import type { Settled } from './backupRuns';
import { launchMemory, launchMoment, retryEverything, runAndSettle } from './backupRuns';
import {
  BackupStatus,
  IDLE_MS,
  NOTHING,
  Trigger,
  dirtyStamp,
  shouldRun,
  stampOf,
  statusOf,
} from './autoBackupPolicy';

/**
 * Backing up without being asked to.
 *
 * A backup nobody remembers to make is not a backup. Until now the only way to
 * send one was to open Settings and press a button, which means the months on
 * the server were as current as the last time somebody thought about backups —
 * for most people, the afternoon they set one up and never again. The point of
 * this hook is that the phone sends what changed on its own, and the screen is
 * left with the one job it is actually good for: making the first backup, and
 * showing the code.
 *
 * Two things start a run, and between them they cover both halves of how this
 * app is used:
 *
 *   * **Opening it.** On mount, and on coming back from the background. The
 *     mount call is not a belt-and-braces extra: `AppState` reports transitions
 *     and a cold start is not one, so without it the most common way this app is
 *     opened would be the one way that never triggered anything.
 *   * **Putting it down.** Half a minute of quiet with something still waiting.
 *     This is the session `AppState` cannot see — habits marked over breakfast
 *     on a phone that then lies on the desk, screen on, until lunch.
 *
 * There is deliberately no OS background task behind either of them, and this is
 * the reason: reading the backup code while the phone is locked would mean
 * dropping the Keychain accessibility on it from "unlocked only" to something a
 * sleeping phone can open. That is a permanent, real weakening of the single
 * secret in this app, and what it buys is a wake-up iOS grants when it feels
 * like it — perhaps once a day, on top of coverage that opening the app already
 * provides. So the promise here is the narrow one the app can actually keep, and
 * it is the promise the wording in Settings makes: it sends when you open it.
 *
 * Whether either trigger is worth acting on, what a finished run should leave
 * behind, and what the card is then allowed to say are all decided in
 * `autoBackupPolicy.ts`; the runs themselves, and what this launch has made of
 * them, are in `backupRuns.ts`. What is left here is only the machinery that
 * cannot be either: a timer, a listener, and the stamp that says what the phone
 * looked like a moment ago.
 */

// --- the run this launch is making ------------------------------------------

/**
 * There is one backup on this phone, so there is one sequence of runs against
 * it, and `backupRuns.ts` is where that sequence lives. It is a module rather
 * than part of this hook because the button on the backup screen joins the same
 * sequence without going anywhere near a React tree, and because a file with no
 * React in it can be put in front of a test — which this one cannot.
 */

export type { BackupStatus, Refusal } from './autoBackupPolicy';

// --- the hook ---------------------------------------------------------------

/**
 * Mounted once, at the root, above everything a restore rebuilds.
 *
 * `hasCode` is the gate: a phone that has never made a backup has nowhere to
 * send one, and neither the timer nor the listener is even attached for it.
 * `onSent` is how the "last sent" line in Settings gets its date — the hook
 * itself keeps no clock, because the honest answer to "when did this phone last
 * back up" belongs with the rest of the backup state rather than in a hook that
 * dies with the process.
 */
export function useAutoBackup(
  hasCode: boolean,
  onSent: () => void
): { status: BackupStatus; refresh: () => void; retry: () => Promise<void> } {
  const [status, setStatus] = useState<BackupStatus>(NOTHING);

  /** Called from a run rather than from a render, so it is read through a ref */
  const sent = useRef(onSent);
  useEffect(() => {
    sent.current = onSent;
  }, [onSent]);

  /**
   * The previous app state, so that a transient `inactive` — the notification
   * shade pulled halfway down, a call arriving, the app switcher — is not
   * mistaken for having left and come back. Only `active` and `background` are
   * ever recorded here, which is what makes the comparison mean "returned".
   */
  const previous = useRef<AppStateStatus>(AppState.currentState);
  /**
   * What was dirty at the last tick. What the runs themselves have established
   * is in `backupRuns`, which is where it belongs: it outlives this hook.
   */
  const seen = useRef('');

  const publish = useCallback((ledger: Ledger) => {
    const memory = launchMemory();
    const next = statusOf(ledger, memory.refusals, memory.accounted);
    setStatus((prev) => (stampOf(prev) === stampOf(next) ? prev : next));
  }, []);

  /**
   * Take what a finished run turned out to mean and put it on the screen.
   *
   * `null` is a run somebody else started and is therefore already accounting
   * for — two triggers landing together must not both stamp the date and both
   * re-publish.
   */
  const account = useCallback(
    (outcome: Settled | null) => {
      if (!outcome) return;
      /**
       * Only bytes on the wire move the date. A run can finish having sent
       * nothing at all — an edit undone before it got there, a month with
       * nothing in it — and dating the backup from one of those is the same
       * "last sent today" this whole change was written to stop saying.
       */
      if (outcome.dated) sent.current();
      seen.current = launchMemory().attempted;
      publish(outcome.ledger);
    },
    [publish]
  );

  const start = useCallback(async () => {
    account(await runAndSettle());
  }, [account]);

  /**
   * Look at the ledger, publish it, and run if this moment is worth a run.
   *
   * Both triggers do the same three things in the same order; what differs is
   * only what they know, which is what `shouldRun` is given. The publish comes
   * first either way, so a card that is open while this happens is right even
   * when the answer is "don't run".
   */
  const look = useCallback(
    async (trigger: Trigger) => {
      const ledger = await loadLedger();
      publish(ledger);

      const stamp = dirtyStamp(ledger);
      // What the *previous* look saw, which only the idle timer uses: coming
      // back to the app is not an edit, so a return starts its quiet from here
      // rather than reading itself as a change.
      const before = trigger === 'idle' ? seen.current : stamp;
      seen.current = stamp;

      // Half the question is this moment on this phone and half of it is what
      // the runs so far have established; `launchMoment` is the second half,
      // and it is assembled where those runs live rather than here.
      if (shouldRun(trigger, { ledger, seen: before, ...launchMoment() })) await start();
    },
    [publish, start]
  );

  useEffect(() => {
    if (!hasCode) {
      setStatus(NOTHING);
      return;
    }

    // Unawaited on purpose: this runs during the first commit, and a backup is
    // never worth a frame of the app not being on screen.
    void look('opened');

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'inactive') return;
      const before = previous.current;
      previous.current = next;
      if (next === 'active' && before !== 'active') void look('opened');
    });
    return () => sub.remove();
  }, [hasCode, look]);

  useEffect(() => {
    if (!hasCode) return;
    const timer = setInterval(() => {
      // A backgrounded phone is not being edited, and on Android this timer
      // keeps running there. Nothing is waiting for a run made behind the app's
      // back, so it waits for the next time somebody is actually looking.
      if (previous.current === 'background') return;
      void look('idle');
    }, IDLE_MS);
    return () => clearInterval(timer);
  }, [hasCode, look]);

  /**
   * Re-read the ledger now. The screens call this after a backup or a restore
   * they ran themselves, so the card is right the moment it comes back into
   * view instead of a tick behind it.
   */
  const refresh = useCallback(() => {
    void loadLedger().then(publish);
  }, [publish]);

  /**
   * Try everything again, now, because somebody asked. What that means is in
   * `backupRuns.retryEverything`; what is left here is putting the answer on
   * the screen, which is the half a module with no React in it cannot do.
   */
  const retry = useCallback(async () => {
    account(await retryEverything());
  }, [account]);

  return { status, refresh, retry };
}
