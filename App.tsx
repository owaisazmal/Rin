import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
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
import { loadIntroSeen, saveIntroSeen } from './src/onboarding';
import { Settings, loadSettings, saveSettings } from './src/settings';
import { ThemeContext, Theme, darkPalette, lightPalette } from './src/theme';
import { startAppCheck } from './src/sync';
import {
  useFonts,
  JosefinSans_400Regular,
  JosefinSans_400Regular_Italic,
  JosefinSans_500Medium,
  JosefinSans_600SemiBold,
  JosefinSans_700Bold,
} from '@expo-google-fonts/josefin-sans';

/**
 * The root: persisted settings, the backup state, the font, and the theme every
 * screen reads from. Which screens exist and how they move is the Navigator's
 * job; what a month contains is the planner's.
 */
export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [backup, setBackup] = useState<BackupState | null>(null);
  // whether this phone holds a backup code, which lives in the Keychain rather
  // than beside the rest of the state
  const [hasCode, setHasCode] = useState(false);
  const [start, setStart] = useState<'planner' | 'backup' | 'intro' | null>(null);
  /**
   * Bumped when a restore replaces everything on this phone. The screens below
   * read storage once, when they mount, which is right for every other way
   * data changes — a restore is the one moment when what they are holding is
   * wholesale wrong, so they are rebuilt rather than asked to notice.
   */
  const [dataEpoch, setDataEpoch] = useState(0);
  const [fontsLoaded] = useFonts({
    JosefinSans_400Regular,
    JosefinSans_400Regular_Italic,
    JosefinSans_500Medium,
    JosefinSans_600SemiBold,
    JosefinSans_700Bold,
  });

  // Before anything can reach the backup server, and once per launch. It is a
  // no-op for someone who never backs up, which is most people.
  useEffect(startAppCheck, []);

  /**
   * The date Settings reads, moved only by a run that actually put bytes on the
   * server. Everything allowed to touch it has to be something a person would
   * call "backed up" — which a restore, whatever else it is, is not, and
   * neither is a run that finished having sent nothing.
   */
  const markSent = useCallback(
    () => setBackup((prev) => ({ onboarded: prev?.onboarded ?? true, lastBackupAt: Date.now() })),
    []
  );

  /**
   * Sends what changed, on its own, whenever the app is opened or put down with
   * something waiting. Mounted here rather than inside the Navigator because a
   * restore rebuilds everything below this line, and a run in flight through
   * that would be cancelled halfway by the remount.
   */
  const {
    status: backupStatus,
    refresh: refreshBackupStatus,
    retry: retryBackup,
  } = useAutoBackup(hasCode, markSent);

  useEffect(() => {
    loadSettings().then(setSettings);
    // Neither the intro nor the welcome screen is shown to someone who has
    // already answered it, so the first screen can't be chosen until both
    // flags land. Intro first, then sign-in, then the planner.
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

  // Only once they have loaded: before that there is nothing to change, and a
  // default written now would overwrite what is stored.
  const updateSettings = useCallback(
    (patch: Partial<Settings>) => setSettings((prev) => (prev ? { ...prev, ...patch } : prev)),
    []
  );

  const mode = settings?.theme ?? 'dark';
  const theme: Theme = useMemo(
    () => ({
      mode,
      palette: mode === 'dark' ? darkPalette : lightPalette,
      setMode: (next) => updateSettings({ theme: next }),
    }),
    [mode, updateSettings]
  );

  // hold the first paint until the persisted theme, the backup state and the font
  // are all ready, so nothing flashes in the system font, the wrong palette, or
  // the wrong screen
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
            onBackedUp={(_code, outcome) => {
              setHasCode(true);
              /**
               * Only a run that sent something is dated.
               *
               * A restore clears the date instead of setting one, which is the
               * opposite of what this did before: it stamped `Date.now()` on
               * the way through, so restoring a January backup in June
               * announced "last saved today" at the exact moment somebody
               * discovered it was five months stale. Nothing has left this
               * phone — the restore seeded the ledger with what came down, so
               * there is nothing to send — and the honest way to say that is no
               * date at all. A refused run keeps whatever date it already had,
               * for the same reason.
               */
              setBackup((prev) => ({
                onboarded: true,
                lastBackupAt:
                  outcome === 'sent'
                    ? Date.now()
                    : outcome === 'restored'
                      ? null
                      : (prev?.lastBackupAt ?? null),
              }));
              if (outcome === 'restored') {
                // Everything this launch had worked out — what was refused, how
                // many attempts had got nowhere, whether anything had been
                // checked — was about the backup this phone was pointed at
                // before. A restore points it at another one, and carrying that
                // account across would describe somebody else's.
                forgetLaunch();
                setDataEpoch((n) => n + 1);
              }
              refreshBackupStatus();
            }}
            onRetryBackup={retryBackup}
            onForgetBackup={() => {
              forgetCode();
              // The refusals and the setbacks were about a backup this phone no
              // longer has. Whatever it is pointed at next starts from nothing.
              forgetLaunch();
              setHasCode(false);
              setBackup((prev) => ({ onboarded: prev?.onboarded ?? true, lastBackupAt: null }));
            }}
            onSkipOnboarding={() =>
              setBackup((prev) => ({ ...(prev as BackupState), onboarded: true }))
            }
            onIntroDone={saveIntroSeen}
          />
          {/* Drawn over the finished app on cold start, then lifts away and unmounts */}
          <LaunchIntro />
        </View>
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}
