import { useState } from 'react';
import PlannerScreen from '../screens/PlannerScreen';
import SettingsScreen from '../screens/SettingsScreen';
import HistoryScreen from '../screens/HistoryScreen';
import BackupScreen from '../screens/BackupScreen';
import IntroScreen from '../screens/IntroScreen';
import { ScreenLayer, useScreenTransition } from './ScreenLayer';
import { useTasks } from '../hooks/useTasks';
import { HistoryFilter } from '../history';
import { ChartType } from '../settings';

type Screen = 'planner' | 'settings' | 'history' | 'backup' | 'intro';
type BackupVariant = 'onboarding' | 'standalone';

export default function Navigator({
  initialScreen,
  hasBackup,
  lastBackupAt,
  chart,
  onSetChart,
  onBackedUp,
  onForgetBackup,
  onSkipOnboarding,
  onIntroDone,
}: {
  initialScreen: Exclude<Screen, 'settings' | 'history'>;
  hasBackup: boolean;
  lastBackupAt: number | null;
  chart: ChartType;
  onSetChart: (c: ChartType) => void;
  onBackedUp: (code: string, restored: boolean) => void;
  onForgetBackup: () => void;
  onSkipOnboarding: () => void;
  onIntroDone: () => void;
}) {
  const [screen, setScreen] = useState<Screen>(initialScreen);

  /**
   * Deadlines live here rather than in the planner because two screens need the
   * same list: the planner edits it, history reads it back. Held above both so
   * there is one copy, and so history never shows a task the planner has just
   * changed but not yet written out.
   */
  const taskStore = useTasks();
  // which tab history lands on, set by whoever opened it
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');

  const openHistory = (filter: HistoryFilter = 'all') => {
    setHistoryFilter(filter);
    setScreen('history');
  };
  // Frozen at the moment the backup screen opens rather than derived from
  // whether a backup exists, which changes the instant one is made — mid-exit,
  // that would swap the screen's back button in behind the animation.
  const [backupVariant, setBackupVariant] = useState<BackupVariant>(
    initialScreen === 'planner' ? 'standalone' : 'onboarding'
  );

  // The intro sits on top of the auth screen rather than in front of it: the
  // welcome page is already built underneath, so finishing the intro lifts
  // this away and lands on it, with nothing to construct mid-animation.
  const introLayer = useScreenTransition(screen === 'intro');

  const finishIntro = () => {
    onIntroDone();
    setScreen('backup');
  };

  // Settings stays in the stack underneath a backup screen reached from it, so
  // dismissing that slides Settings back rather than rebuilding it.
  const settingsLayer = useScreenTransition(
    screen === 'settings' || (screen === 'backup' && backupVariant === 'standalone')
  );
  const backupLayer = useScreenTransition(screen === 'backup' || screen === 'intro');
  const historyLayer = useScreenTransition(screen === 'history');

  const dismissBackup = () => {
    if (backupVariant === 'standalone') {
      setScreen('settings');
    } else {
      onSkipOnboarding();
      setScreen('planner');
    }
  };

  /**
   * Stays on the backup screen rather than leaving the moment it succeeds: it
   * has just shown someone a code they need to write down, and sliding it away
   * under them would be the one moment in this app where haste costs data.
   */
  const backedUp = (code: string, restored: boolean) => {
    onBackedUp(code, restored);
  };

  return (
    <>
      {/*
        The planner is never unmounted, so opening Settings doesn't throw away
        the open month, the selected day or the scroll position — and it keeps
        drawing through the transition, receding under whatever slides over it,
        until it is genuinely out of sight.
      */}
      <ScreenLayer
        coveredBy={settingsLayer.progress}
        hidden={
          settingsLayer.settledOpen || backupLayer.settledOpen || historyLayer.settledOpen
        }
      >
        <PlannerScreen
          chart={chart}
          onSetChart={onSetChart}
          onOpenSettings={() => setScreen('settings')}
          onOpenHistory={openHistory}
          taskStore={taskStore}
        />
      </ScreenLayer>

      {/*
        History slides over the planner the way Settings does, and reads the
        same task list the planner owns — the planner stays mounted underneath,
        so coming back lands on the month that was already open.
      */}
      <ScreenLayer
        transition={historyLayer}
        onSwipeBack={() => setScreen('planner')}
      >
        <HistoryScreen
          tasks={taskStore.tasks}
          // Not "is it open" but "has it finished arriving". Reading storage is
          // the heaviest thing this screen does, and the flag that hides the
          // planner underneath is set by the entrance animation's callback — on
          // the JS thread, behind whatever else is queued. Starting the read
          // first delayed that callback, leaving the planner drawn underneath a
          // screen with nothing on it yet, showing straight through.
          active={historyLayer.settledOpen}
          initialFilter={historyFilter}
          onClose={() => setScreen('planner')}
        />
      </ScreenLayer>

      <ScreenLayer
        transition={settingsLayer}
        coveredBy={backupVariant === 'standalone' ? backupLayer.progress : undefined}
        onSwipeBack={() => setScreen('planner')}
      >
        <SettingsScreen
          hasBackup={hasBackup}
          lastBackupAt={lastBackupAt}
          onOpenBackup={() => {
            setBackupVariant('standalone');
            setScreen('backup');
          }}
          onForgetBackup={onForgetBackup}
          onClose={() => setScreen('planner')}
        />
      </ScreenLayer>

      {/*
        First run has nothing behind it to push against, so the welcome screen
        rises into place instead of sliding in from the side — and there is
        nowhere to swipe back to.
      */}
      <ScreenLayer
        transition={backupLayer}
        presentation={backupVariant === 'onboarding' ? 'fade' : 'push'}
        swipeBackEnabled={backupVariant === 'standalone'}
        onSwipeBack={dismissBackup}
        // Screens are transparent so the drifting background reads through
        // them — which also means a screen resting on top of this one would
        // read through to it. Hidden only while the intro is fully open, so it
        // is back in place the instant the intro starts to go.
        hidden={introLayer.settledOpen}
      >
        <BackupScreen
          variant={backupVariant}
          onDone={backedUp}
          onDismiss={dismissBackup}
        />
      </ScreenLayer>

      {/*
        First thing a new install shows, and the only screen with nothing
        behind it worth seeing — so it fades out rather than sliding aside.
      */}
      <ScreenLayer
        transition={introLayer}
        presentation="fade"
        swipeBackEnabled={false}
      >
        <IntroScreen onDone={finishIntro} />
      </ScreenLayer>
    </>
  );
}
