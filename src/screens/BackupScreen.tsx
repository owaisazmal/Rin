import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Clipboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackButton from '../components/BackButton';
import LogoMark from '../components/LogoMark';
import SegmentedControl from '../components/SegmentedControl';
import { authStyles } from './authStyles';
import { format, generateCode, normalizeCode } from '../backup';
import { loadCode, saveCode } from '../backupState';
import { restoreEverything } from '../sync';
import { backupNow } from '../hooks/backupRuns';
import { sentAnything } from '../hooks/autoBackupPolicy';
import { restoreReport, runReport } from './backupWording';
import { FONT, Palette, RADIUS, useTheme } from '../theme';

type Tab = 'create' | 'restore';

const TABS = [
  { value: 'create' as Tab, label: 'BACK UP' },
  { value: 'restore' as Tab, label: 'RESTORE' },
] as const;

/** The two panes are different heights, so the card grows rather than snapping */
const paneAnimation = LayoutAnimation.create(240, 'easeInEaseOut', 'opacity');

/**
 * What this screen managed, which is more than "it worked".
 *
 * `restored` tells the app above that everything on this phone has just been
 * replaced and whatever it is holding in memory is now a month out of date.
 *
 * `unsent` is a run that finished without putting a single byte on the server,
 * and it covers two things that look nothing alike and mean the same here: a
 * document the server would not take, and a phone that had nothing to send. The
 * date in Settings hangs off this, so both have to fall on the same side of it.
 * The old gate was "was anything refused", which got the answer wrong in both
 * directions at once — a run that sent two months and was refused a third went
 * undated, and a run that opened no connection at all stamped "last sent today"
 * across the whole phone.
 */
export type BackupOutcome = 'sent' | 'restored' | 'unsent';

interface Props {
  /**
   * `onboarding` is the first-open screen and offers a way past it;
   * `standalone` is reached from Settings and offers a way back instead.
   */
  variant: 'onboarding' | 'standalone';
  /** Called once a backup has been made or restored, with which of them it was */
  onDone: (code: string, outcome: BackupOutcome) => void;
  onDismiss: () => void;
}

/**
 * Backing this phone up, and restoring it onto another one.
 *
 * There is no account here and nothing to sign into: a backup is reached by a
 * code, and the code is the only thing that can reach it. That is what makes
 * the contents unreadable to the server, and it is also why there is no
 * "forgot code" — a way to reset one would be a way in. The screen says so
 * plainly rather than burying it, because someone who loses the code loses the
 * backup, and they should hear that before they rely on it.
 */
export default function BackupScreen({ variant, onDone, onDismiss }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const [tab, setTab] = useState<Tab>('create');
  /**
   * Held rather than regenerated on every render, so it can't change under
   * someone who is halfway through writing it down — and replaced by the
   * phone's existing code as soon as that loads, because backing up a second
   * time has to overwrite the first backup rather than strand it under a code
   * nobody wrote down.
   */
  const [fresh, setFresh] = useState(generateCode);
  const [loadingCode, setLoadingCode] = useState(true);
  const [typed, setTyped] = useState('');
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCode().then((saved) => {
      if (cancelled) return;
      // stored bare, shown in groups — the dashes are a reading aid, not part
      // of the code, and `normalizeCode` throws them away again on the way in
      if (saved) setFresh(format(saved));
      setLoadingCode(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const creating = tab === 'create';

  const switchTab = (next: Tab) => {
    if (busy) return;
    LayoutAnimation.configureNext(paneAnimation);
    setTab(next);
    setError(null);
    setDone(null);
  };

  const copy = () => {
    Clipboard.setString(fresh);
    setCopied(true);
  };

  /**
   * The button, and it goes through the same door the phone's own runs do.
   *
   * It used to call `backupEverything` directly, which read as the shorter way
   * of saying the same thing and was not: everything that decides what a run
   * *meant* lives on the other side of `backupNow` — whether the install was
   * turned away, whether anything is still stuck, whether this phone can now be
   * said to be accounted for. Skipping it left the one run somebody actually
   * watches as the one run nothing learned from, and a whole-install refusal
   * pressed by hand parked every document with nothing to take the park off
   * again. Two paths that disagree about what happened is one path too many.
   */
  const runBackup = async () => {
    setBusy(true);
    setError(null);
    const result = await backupNow(fresh);
    setBusy(false);
    if (!result.ok) {
      // Losing the connection is the only thing that ends a run outright. A
      // document the server refuses, or one too big to send, is recorded
      // against that document and stepped over, and comes back in `blocked`.
      setError("Couldn't reach the backup. Check your connection and try again.");
      return;
    }
    // The code is worth keeping either way: this phone really does back up
    // under it now, and a refusal that has to be worked through is easier to
    // work through from a phone that remembers which backup it belongs to.
    await saveCode(normalizeCode(fresh) ?? fresh);
    /**
     * Both lines come from one place, which is the point: a run that half
     * worked has something to warn about and something to be pleased about, and
     * this screen used to print them from two functions that had never been
     * introduced. One transient rejection was enough to get "nothing was sent"
     * and "2 months are safe" onto the card together.
     */
    const report = runReport(result);
    setError(report.problem);
    setDone(report.progress);
    // Only bytes on the wire are worth a date, whatever else the run decided.
    onDone(fresh, sentAnything(result) ? 'sent' : 'unsent');
  };

  const runRestore = async () => {
    const code = normalizeCode(typed);
    if (!code) {
      setError('That code is 24 characters. Check it and try again.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await restoreEverything(code);
    setBusy(false);
    if (!result.ok) {
      setError(
        result.reason === 'missing'
          ? 'No backup under that code. It has to match exactly.'
          : result.reason === 'rejected'
            ? 'The backup server turned this app away. That is a setup problem at my end, not yours.'
            : "Couldn't reach the backup. Check your connection and try again."
      );
      return;
    }
    await saveCode(code);
    /**
     * A restore steps over a month it cannot decrypt and leaves the deadline
     * list alone when the backup's own will not open, both of which are right
     * and neither of which used to be said: "3 months are back" was printed over
     * the top of them, and it reads as the whole backup having arrived.
     */
    const report = restoreReport(result);
    setError(report.problem);
    setDone(report.progress);
    onDone(code, 'restored');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.topBar}>
          {variant === 'standalone' ? <BackButton onPress={onDismiss} /> : null}
        </View>

        {/*
          Padding on Android as well: the app draws edge to edge, so the window
          no longer shrinks for the keyboard, and the restore button would sit
          underneath it while the code is being typed.
        */}
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.brand}>
              <View style={styles.brandMark}>
                <LogoMark size={76} />
              </View>
              <Text style={styles.brandSub}>RIN</Text>
              <Text style={styles.brandTitle}>BACKUP</Text>
              <Text style={styles.tagline}>
                {creating
                  ? 'One code carries your months to your next phone.'
                  : 'Type the code and this phone becomes the other one.'}
              </Text>
            </View>

            <View style={styles.card}>
              <SegmentedControl
                options={TABS}
                value={tab}
                onChange={switchTab}
                style={styles.segment}
              />

              {creating ? (
                <>
                  <Text style={styles.label}>YOUR CODE</Text>
                  <Pressable onPress={copy} style={styles.codeBox}>
                    <Text style={styles.code} selectable>
                      {fresh}
                    </Text>
                  </Pressable>

                  <View style={styles.codeActions}>
                    <Pressable hitSlop={8} onPress={copy}>
                      <Text style={styles.quietAction}>{copied ? 'COPIED' : 'COPY'}</Text>
                    </Pressable>
                    <Pressable
                      hitSlop={8}
                      onPress={() => {
                        setFresh(generateCode());
                        setCopied(false);
                        setDone(null);
                      }}
                    >
                      <Text style={styles.quietAction}>NEW CODE</Text>
                    </Pressable>
                  </View>

                  <Text style={styles.warning}>
                    Write it down. Nobody can look it up for you — not me, not Google.
                    Without it the backup stays encrypted forever.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.label}>BACKUP CODE</Text>
                  <TextInput
                    style={[styles.input, styles.codeInput, focused && styles.inputFocused]}
                    value={typed}
                    onChangeText={(text) => setTyped(format(
                      text.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 24)
                    ))}
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                    placeholderTextColor={palette.inkSoft}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    autoComplete="off"
                    returnKeyType="go"
                    onSubmitEditing={runRestore}
                  />
                  <Text style={styles.warning}>
                    This replaces what is on this phone with what is in the backup.
                  </Text>
                </>
              )}

              {error ? <Text style={styles.error}>{error}</Text> : null}
              {done ? <Text style={styles.done}>{done}</Text> : null}

              <Pressable
                disabled={busy || (creating && loadingCode)}
                onPress={creating ? runBackup : runRestore}
                style={({ pressed }) => [
                  styles.primary,
                  (pressed || busy) && { opacity: 0.85 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={palette.onAccent} />
                ) : (
                  <Text style={styles.primaryText}>
                    {creating ? 'BACK UP NOW' : 'RESTORE'}
                  </Text>
                )}
              </Pressable>

              <Text style={styles.fine}>
                Everything is encrypted on this phone before it leaves. The server
                stores what it cannot read.
              </Text>
            </View>

            {variant === 'onboarding' ? (
              <Pressable
                hitSlop={10}
                onPress={onDismiss}
                style={({ pressed }) => [styles.skip, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.skipText}>Not now</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    ...authStyles(p),
    brandMark: { marginBottom: 14 },
    segment: { marginBottom: 18 },
    codeBox: {
      backgroundColor: p.chip,
      borderRadius: RADIUS.control,
      borderWidth: 1,
      borderColor: p.lineFaint,
      paddingVertical: 16,
      paddingHorizontal: 12,
      alignItems: 'center',
    },
    code: {
      fontSize: 16,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
      textAlign: 'center',
    },
    codeInput: {
      textAlign: 'center',
      letterSpacing: 2,
      fontFamily: FONT.bold,
    },
    codeActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 10,
      paddingHorizontal: 2,
    },
    quietAction: {
      fontSize: 10,
      fontFamily: FONT.bold,
      letterSpacing: 1,
      color: p.accent,
    },
    warning: {
      marginTop: 14,
      marginBottom: 16,
      fontSize: 11,
      fontFamily: FONT.regular,
      lineHeight: 16,
      color: p.inkSoft,
    },
    done: {
      fontSize: 12,
      fontFamily: FONT.medium,
      color: p.accent,
      marginBottom: 12,
    },
    skip: { marginTop: 22, alignItems: 'center' },
    skipText: {
      fontSize: 12,
      fontFamily: FONT.medium,
      color: p.inkSoft,
    },
  });
