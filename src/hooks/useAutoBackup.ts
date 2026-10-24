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

export type { BackupStatus } from './autoBackupPolicy';

// Sends on open and after idle; no OS background task, which would need the code readable while locked.
export function useAutoBackup(
  hasCode: boolean,
  onSent: () => void
): { status: BackupStatus; refresh: () => void; retry: () => Promise<void> } {
  const [status, setStatus] = useState<BackupStatus>(NOTHING);

  const sent = useRef(onSent);
  useEffect(() => {
    sent.current = onSent;
  }, [onSent]);

  // only `active` and `background` are recorded, so a transient `inactive` is not a return
  const previous = useRef<AppStateStatus>(AppState.currentState);
  /** dirty stamp at the last look, for the idle timer's stillness check */
  const seen = useRef('');

  const publish = useCallback(async (ledger: Ledger) => {
    const next = statusOf(ledger, await launchMemory());
    setStatus((prev) => (stampOf(prev) === stampOf(next) ? prev : next));
  }, []);

  // null is a run another caller started, and is accounting for
  const account = useCallback(
    async (outcome: Settled | null) => {
      if (!outcome) return;
      if (outcome.dated) sent.current();
      seen.current = (await launchMemory()).attempted;
      await publish(outcome.ledger);
    },
    [publish]
  );

  const look = useCallback(
    async (trigger: Trigger) => {
      const ledger = await loadLedger();
      await publish(ledger);

      const stamp = dirtyStamp(ledger);
      // a return is not an edit, so only the idle timer compares against the previous look
      const before = trigger === 'idle' ? seen.current : stamp;
      seen.current = stamp;

      if (shouldRun(trigger, { ledger, seen: before, ...(await launchMoment()) })) {
        await account(await runAndSettle());
      }
    },
    [publish, account]
  );

  useEffect(() => {
    if (!hasCode) {
      setStatus(NOTHING);
      return;
    }

    // a cold start is not an AppState transition, so look once on mount
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
      // Android keeps this timer running in the background
      if (previous.current === 'background') return;
      void look('idle');
    }, IDLE_MS);
    return () => clearInterval(timer);
  }, [hasCode, look]);

  const refresh = useCallback(() => {
    void loadLedger().then(publish);
  }, [publish]);

  const retry = useCallback(async () => {
    await account(await retryEverything());
  }, [account]);

  return { status, refresh, retry };
}
