import { useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import PlannerScreen from '../screens/PlannerScreen';
import SettingsScreen from '../screens/SettingsScreen';
import HistoryScreen from '../screens/HistoryScreen';
import SummaryScreen, { SummarySource } from '../screens/SummaryScreen';
import BackupScreen, { BackupOutcome } from '../screens/BackupScreen';
import IntroScreen from '../screens/IntroScreen';
import { ScreenLayer, useScreenTransition } from './ScreenLayer';
import type { RestoreFailure } from '../screens/backupWording';
import { useTasks } from '../hooks/useTasks';
import type { BackupStatus } from '../hooks/useAutoBackup';
import { HistoryFilter } from '../history';
import type { PlannerLayout } from '../layout';
import { ChartType, NotificationPrefs } from '../settings';
import type { QuotePrefs } from '../quotes';

type Screen = 'planner' | 'settings' | 'history' | 'summary' | 'backup' | 'intro';
type BackupVariant = 'onboarding' | 'standalone';

export default function Navigator({
  initialScreen,
  hasBackup,
  lastBackupAt,
  backupStatus,
  chart,
  onSetChart,
  layout,
  onChangeLayout,
  notifications,
  onChangeNotifications,
  quotes,
  onChangeQuotes,
  onBackedUp,
  onRetryBackup,
  backupHolds,
  restorableMonth,
  onRestoreMonth,
  onDeleteBackup,
  onForgetBackup,
  onSkipOnboarding,
  onIntroDone,
}: {
  initialScreen: Exclude<Screen, 'settings' | 'history' | 'summary'>;
  hasBackup: boolean;
  lastBackupAt: number | null;
  /** what is still waiting to go, and what the server would not take */
  backupStatus: BackupStatus;
  chart: ChartType;
  onSetChart: (c: ChartType) => void;
  /** the cards below the planner's daily check; a setting, so it is held above */
  layout: PlannerLayout;
  onChangeLayout: (change: (prev: PlannerLayout) => PlannerLayout) => void;
  notifications: NotificationPrefs;
  onChangeNotifications: (change: (prev: NotificationPrefs) => NotificationPrefs) => void;
  quotes: QuotePrefs;
  onChangeQuotes: (change: (prev: QuotePrefs) => QuotePrefs) => void;
  onBackedUp: (code: string, outcome: BackupOutcome) => void;
  /** takes the park off everything stuck and offers the lot again, now */
  onRetryBackup: () => Promise<void>;
  /** which months the backup holds, or null when nobody has looked */
  backupHolds: readonly string[] | null;
  /** the month Settings is offering to put back, by document name, or null */
  restorableMonth: string | null;
  onRestoreMonth: (key: string) => Promise<RestoreFailure | null>;
  onDeleteBackup: () => Promise<{ ok: boolean; deleted: number }>;
  onForgetBackup: () => void;
  onSkipOnboarding: () => void;
  onIntroDone: () => void;
}) {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const toPlanner = () => setScreen('planner');

  // held here so the planner and history share one copy of the task list
  const taskStore = useTasks();
  // which tab history lands on, set by whoever opened it
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');

  const openHistory = (filter: HistoryFilter = 'all') => {
    setHistoryFilter(filter);
    setScreen('history');
  };
  // kept after closing, so the summary still has its month while it slides away
  const [summarySource, setSummarySource] = useState<SummarySource | null>(null);

  const openSummary = (source: SummarySource) => {
    setSummarySource(source);
    setScreen('summary');
  };
  // frozen on opening, not derived from hasBackup, which flips mid-exit once one is made
  const [backupVariant, setBackupVariant] = useState<BackupVariant>(
    initialScreen === 'planner' ? 'standalone' : 'onboarding'
  );

  // the intro sits over the already-built welcome screen, so finishing it just lifts away
  const introLayer = useScreenTransition(screen === 'intro');

  const finishIntro = () => {
    onIntroDone();
    setScreen('backup');
  };

  // Settings stays underneath a backup screen opened from it
  const settingsLayer = useScreenTransition(
    screen === 'settings' || (screen === 'backup' && backupVariant === 'standalone')
  );
  const backupLayer = useScreenTransition(screen === 'backup' || screen === 'intro');
  const historyLayer = useScreenTransition(screen === 'history');
  const summaryLayer = useScreenTransition(screen === 'summary');

  const dismissBackup = () => {
    if (backupVariant === 'standalone') {
      setScreen('settings');
    } else {
      onSkipOnboarding();
      toPlanner();
    }
  };

  // Android back pops like the on-screen buttons; screens with nothing behind hand it to the system
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'settings' || screen === 'history' || screen === 'summary') {
        toPlanner();
        return true;
      }
      if (screen === 'backup' && backupVariant === 'standalone') {
        setScreen('settings');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen, backupVariant]);

  return (
    <>
      {/* never unmounted, so the open month, day and scroll survive a trip to another screen */}
      <ScreenLayer
        coveredBy={settingsLayer.progress}
        hidden={
          settingsLayer.settledOpen ||
          backupLayer.settledOpen ||
          historyLayer.settledOpen ||
          summaryLayer.settledOpen
        }
      >
        <PlannerScreen
          chart={chart}
          onSetChart={onSetChart}
          layout={layout}
          onChangeLayout={onChangeLayout}
          notifications={notifications}
          quotes={quotes}
          onOpenSettings={() => setScreen('settings')}
          onOpenHistory={openHistory}
          onOpenSummary={openSummary}
          taskStore={taskStore}
          restorableMonth={restorableMonth}
        />
      </ScreenLayer>

      <ScreenLayer transition={historyLayer} onSwipeBack={toPlanner}>
        <HistoryScreen
          tasks={taskStore.tasks}
          // once it has arrived, so the storage read can't delay hiding the planner
          active={historyLayer.settledOpen}
          initialFilter={historyFilter}
          onClose={toPlanner}
        />
      </ScreenLayer>

      <ScreenLayer transition={summaryLayer} onSwipeBack={toPlanner}>
        <SummaryScreen
          source={summarySource}
          tasks={taskStore.tasks}
          onClose={toPlanner}
        />
      </ScreenLayer>

      <ScreenLayer
        transition={settingsLayer}
        coveredBy={backupVariant === 'standalone' ? backupLayer.progress : undefined}
        onSwipeBack={toPlanner}
      >
        <SettingsScreen
          hasBackup={hasBackup}
          lastBackupAt={lastBackupAt}
          backupStatus={backupStatus}
          onOpenBackup={() => {
            setBackupVariant('standalone');
            setScreen('backup');
          }}
          onRetryBackup={onRetryBackup}
          backupHolds={backupHolds}
          onRestoreMonth={onRestoreMonth}
          onDeleteBackup={onDeleteBackup}
          onForgetBackup={onForgetBackup}
          notifications={notifications}
          onChangeNotifications={onChangeNotifications}
          quotes={quotes}
          onChangeQuotes={onChangeQuotes}
          onClose={toPlanner}
        />
      </ScreenLayer>

      {/* first run has nothing behind it, so the welcome screen rises in and can't be swiped back */}
      <ScreenLayer
        transition={backupLayer}
        presentation={backupVariant === 'onboarding' ? 'fade' : 'push'}
        swipeBackEnabled={backupVariant === 'standalone'}
        onSwipeBack={dismissBackup}
        // screens are transparent, so it hides only while the intro fully covers it
        hidden={introLayer.settledOpen}
      >
        <BackupScreen
          variant={backupVariant}
          // stays put on success: it has just shown a code to write down
          onDone={onBackedUp}
          onDismiss={dismissBackup}
        />
      </ScreenLayer>

      <ScreenLayer transition={introLayer} presentation="fade">
        <IntroScreen onDone={finishIntro} />
      </ScreenLayer>
    </>
  );
}
