import { useState } from 'react';
import PlannerScreen from '../screens/PlannerScreen';
import SettingsScreen from '../screens/SettingsScreen';
import HistoryScreen from '../screens/HistoryScreen';
import AuthScreen from '../screens/AuthScreen';
import IntroScreen from '../screens/IntroScreen';
import { ScreenLayer, useScreenTransition } from './ScreenLayer';
import { Account } from '../auth';
import { useTasks } from '../hooks/useTasks';
import { HistoryFilter } from '../history';
import { ChartType } from '../settings';

type Screen = 'planner' | 'settings' | 'history' | 'auth' | 'intro';
type AuthVariant = 'onboarding' | 'standalone';

export default function Navigator({
  initialScreen,
  account,
  chart,
  onSetChart,
  onSignIn,
  onSignOut,
  onSkipOnboarding,
  onIntroDone,
}: {
  initialScreen: Exclude<Screen, 'settings' | 'history'>;
  account: Account | null;
  chart: ChartType;
  onSetChart: (c: ChartType) => void;
  onSignIn: (account: Account) => void;
  onSignOut: () => void;
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
  // Frozen at the moment the auth screen opens rather than derived from the
  // account, which changes the instant someone signs in — mid-exit, that would
  // swap the screen's back button in behind the animation.
  const [authVariant, setAuthVariant] = useState<AuthVariant>(
    initialScreen === 'planner' ? 'standalone' : 'onboarding'
  );

  // The intro sits on top of the auth screen rather than in front of it: the
  // welcome page is already built underneath, so finishing the intro lifts
  // this away and lands on it, with nothing to construct mid-animation.
  const introLayer = useScreenTransition(screen === 'intro');

  const finishIntro = () => {
    onIntroDone();
    setScreen('auth');
  };

  // Settings stays in the stack underneath a sign-in reached from it, so
  // dismissing that sign-in slides Settings back rather than rebuilding it.
  const settingsLayer = useScreenTransition(
    screen === 'settings' || (screen === 'auth' && authVariant === 'standalone')
  );
  const authLayer = useScreenTransition(screen === 'auth' || screen === 'intro');
  const historyLayer = useScreenTransition(screen === 'history');

  const dismissAuth = () => {
    if (authVariant === 'standalone') {
      setScreen('settings');
    } else {
      onSkipOnboarding();
      setScreen('planner');
    }
  };

  const authenticated = (acc: Account) => {
    onSignIn(acc);
    // back to Settings if that's where the sign-in started, otherwise the
    // planner — which on first run is the screen behind the onboarding fade
    setScreen(authVariant === 'standalone' ? 'settings' : 'planner');
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
          settingsLayer.settledOpen || authLayer.settledOpen || historyLayer.settledOpen
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
        coveredBy={authVariant === 'standalone' ? authLayer.progress : undefined}
        onSwipeBack={() => setScreen('planner')}
      >
        <SettingsScreen
          account={account}
          onSignIn={() => {
            setAuthVariant('standalone');
            setScreen('auth');
          }}
          onSignOut={onSignOut}
          onClose={() => setScreen('planner')}
        />
      </ScreenLayer>

      {/*
        First run has nothing behind it to push against, so the welcome screen
        rises into place instead of sliding in from the side — and there is
        nowhere to swipe back to.
      */}
      <ScreenLayer
        transition={authLayer}
        presentation={authVariant === 'onboarding' ? 'fade' : 'push'}
        swipeBackEnabled={authVariant === 'standalone'}
        onSwipeBack={dismissAuth}
        // Screens are transparent so the drifting background reads through
        // them — which also means a screen resting on top of this one would
        // read through to it. Hidden only while the intro is fully open, so it
        // is back in place the instant the intro starts to go.
        hidden={introLayer.settledOpen}
      >
        <AuthScreen
          variant={authVariant}
          onAuthenticated={authenticated}
          onDismiss={dismissAuth}
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
