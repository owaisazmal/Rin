import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AuroraBackground from './src/components/AuroraBackground';
import LaunchIntro from './src/components/LaunchIntro';
import Navigator from './src/navigation/Navigator';
import {
  BackupState,
  loadBackupState,
  loadCode,
  forgetCode,
  saveBackupState,
} from './src/backupState';
import { forgetLaunch } from './src/hooks/backupRuns';
import { useAutoBackup } from './src/hooks/useAutoBackup';
import type { PlannerLayout } from './src/layout';
import type { QuotePrefs } from './src/quotes';
import { loadIntroSeen, saveIntroSeen } from './src/onboarding';
import {
  NotificationPrefs,
  Settings,
  loadSettings,
  resolveTheme,
  saveSettings,
} from './src/settings';
import { needsHolds, restoreOffer } from './src/screens/backupWording';
import { ThemeContext, Theme, darkPalette, lightPalette } from './src/theme';
import { deleteBackup, listMonths, restoreMonth } from './src/sync';
import { useFonts } from 'expo-font';
// one module per weight: the package root would bundle all fourteen faces
import { JosefinSans_400Regular } from '@expo-google-fonts/josefin-sans/400Regular';
import { JosefinSans_400Regular_Italic } from '@expo-google-fonts/josefin-sans/400Regular_Italic';
import { JosefinSans_500Medium } from '@expo-google-fonts/josefin-sans/500Medium';
import { JosefinSans_600SemiBold } from '@expo-google-fonts/josefin-sans/600SemiBold';
import { JosefinSans_700Bold } from '@expo-google-fonts/josefin-sans/700Bold';

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [backup, setBackup] = useState<BackupState | null>(null);
  // the code itself lives in the Keychain, not beside the rest of the state
  const [hasCode, setHasCode] = useState(false);
  const [start, setStart] = useState<'planner' | 'backup' | 'intro' | null>(null);
  // bumped by a restore, so screens that read storage on mount are rebuilt
  const [dataEpoch, setDataEpoch] = useState(0);
  const [fontsLoaded] = useFonts({
    JosefinSans_400Regular,
    JosefinSans_400Regular_Italic,
    JosefinSans_500Medium,
    JosefinSans_600SemiBold,
    JosefinSans_700Bold,
  });

  const patchBackup = useCallback(
    (patch: Partial<BackupState>) =>
      setBackup((prev) => ({ onboarded: true, lastBackupAt: null, ...prev, ...patch })),
    []
  );

  // only a run that put bytes on the server moves the date
  const markSent = useCallback(() => patchBackup({ lastBackupAt: Date.now() }), [patchBackup]);

  // mounted above the Navigator so a restore's remount cannot cut a run in half
  const {
    status: backupStatus,
    refresh: refreshBackupStatus,
    retry: retryBackup,
  } = useAutoBackup(hasCode, markSent);

  // which months the backup holds, listed only when the card's wording needs it; null is "not looked"
  const [backupHolds, setBackupHolds] = useState<readonly string[] | null>(null);
  const stuck = needsHolds(backupStatus);

  useEffect(() => {
    if (!stuck || !hasCode) {
      setBackupHolds(null);
      return;
    }
    let cancelled = false;
    loadCode().then((code) => {
      if (cancelled || !code) return;
      listMonths(code).then((listed) => {
        if (!cancelled && listed.ok) setBackupHolds(listed.value);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [stuck, hasCode]);

  // the month Settings offers to put back, handed to the planner by name only
  const restorableMonth = useMemo(
    () => restoreOffer(backupStatus, backupHolds),
    [backupStatus, backupHolds]
  );

  // delete before forgetting the code, which derives the id every delete is aimed at
  const deleteTheBackup = useCallback(async () => {
    const code = await loadCode();
    if (!code) return { ok: false, deleted: 0 };
    const result = await deleteBackup(code);
    if (result.ok) {
      await forgetCode();
      setHasCode(false);
      patchBackup({ lastBackupAt: null });
    }
    refreshBackupStatus();
    return { ok: result.ok, deleted: result.deleted };
  }, [patchBackup, refreshBackupStatus]);

  // replaces this phone's damaged copy of one month, then rebuilds the screens like a full restore
  const restoreOneMonth = useCallback(
    async (key: string) => {
      // unreachable from the card, so there is no reason worth returning
      const code = await loadCode();
      if (!code) return null;
      const [year, month] = key.split('-').map(Number);
      if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
      const pulled = await restoreMonth(code, year, month - 1);
      if (!pulled.ok) return pulled.reason;
      setDataEpoch((n) => n + 1);
      refreshBackupStatus();
      return null;
    },
    [refreshBackupStatus]
  );

  useEffect(() => {
    loadSettings().then(setSettings);
    // intro first, then the backup welcome, then the planner, skipping what is already answered
    Promise.all([loadBackupState(), loadIntroSeen(), loadCode()]).then(
      ([state, introSeen, code]) => {
        setBackup(state);
        setHasCode(code !== null);
        setStart(state.onboarded ? 'planner' : introSeen ? 'backup' : 'intro');
      }
    );
  }, []);

  useEffect(() => {
    if (settings) saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (backup) saveBackupState(backup);
  }, [backup]);

  // a no-op until loaded, so a default can never overwrite what is stored
  const updateSettings = useCallback(
    (patch: Partial<Settings>) => setSettings((prev) => (prev ? { ...prev, ...patch } : prev)),
    []
  );

  /** Takes an updater so two changes in one tick both land. */
  const changeLayout = useCallback(
    (change: (prev: PlannerLayout) => PlannerLayout) =>
      setSettings((prev) => {
        if (!prev) return prev;
        const layout = change(prev.layout);
        return layout === prev.layout ? prev : { ...prev, layout };
      }),
    []
  );

  const changeNotifications = useCallback(
    (change: (prev: NotificationPrefs) => NotificationPrefs) =>
      setSettings((prev) => (prev ? { ...prev, notifications: change(prev.notifications) } : prev)),
    []
  );

  const changeQuotes = useCallback(
    (change: (prev: QuotePrefs) => QuotePrefs) =>
      setSettings((prev) => (prev ? { ...prev, quotes: change(prev.quotes) } : prev)),
    []
  );

  // re-renders when the OS appearance changes, which is what `system` follows
  const osScheme = useColorScheme();
  const preference = settings?.theme ?? 'dark';
  const mode = resolveTheme(preference, osScheme);
  const theme: Theme = useMemo(
    () => ({
      mode,
      preference,
      palette: mode === 'dark' ? darkPalette : lightPalette,
      setPreference: (next) => updateSettings({ theme: next }),
    }),
    [mode, preference, updateSettings]
  );

  // hold the first paint so nothing flashes in the wrong font, palette or screen
  if (!settings || !backup || !start || !fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={theme}>
        {/* The drifting background sits behind every layer; screens are transparent so it reads through */}
        <View style={{ flex: 1, backgroundColor: theme.palette.bg }}>
          <AuroraBackground />
          <Navigator
            key={dataEpoch}
            initialScreen={start}
            hasBackup={hasCode}
            lastBackupAt={backup.lastBackupAt}
            backupStatus={backupStatus}
            chart={settings.chart}
            onSetChart={(chart) => updateSettings({ chart })}
            layout={settings.layout}
            onChangeLayout={changeLayout}
            notifications={settings.notifications}
            onChangeNotifications={changeNotifications}
            quotes={settings.quotes}
            onChangeQuotes={changeQuotes}
            onBackedUp={(_code, outcome) => {
              setHasCode(true);
              // a restore sent nothing from this phone, so it clears the date; an unsent run keeps it
              patchBackup(
                outcome === 'unsent'
                  ? { onboarded: true }
                  : { onboarded: true, lastBackupAt: outcome === 'sent' ? Date.now() : null }
              );
              if (outcome === 'restored') {
                // what this launch knew was about the backup it was pointed at before
                forgetLaunch();
                setDataEpoch((n) => n + 1);
              }
              refreshBackupStatus();
            }}
            onRetryBackup={retryBackup}
            backupHolds={backupHolds}
            restorableMonth={restorableMonth}
            onRestoreMonth={restoreOneMonth}
            onDeleteBackup={deleteTheBackup}
            onForgetBackup={() => {
              forgetCode();
              forgetLaunch();
              setHasCode(false);
              patchBackup({ lastBackupAt: null });
            }}
            onSkipOnboarding={() => patchBackup({ onboarded: true })}
            onIntroDone={saveIntroSeen}
          />
          {/* Drawn over the finished app on cold start, then lifts away and unmounts */}
          <LaunchIntro />
        </View>
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}
