import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Clipboard,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import KeyboardSafeScroll from '../components/KeyboardSafeScroll';
import BackButton from '../components/BackButton';
import LogoMark from '../components/LogoMark';
import SegmentedControl from '../components/SegmentedControl';
import { format, generateCode, normalizeCode } from '../backup';
import { loadCode, saveCode } from '../backupState';
import { restoreEverything } from '../sync';
import { backupNow } from '../hooks/backupRuns';
import { sentAnything } from '../hooks/autoBackupPolicy';
import { restoreReport, runReport } from './backupWording';
import { device } from '../device';
import { COLUMN, FONT, Palette, RADIUS, cardSurface, useTheme, wrapSafe } from '../theme';

type Tab = 'create' | 'restore';

const TABS = [
  { value: 'create' as Tab, label: 'BACK UP' },
  { value: 'restore' as Tab, label: 'RESTORE' },
] as const;

/** The two panes are different heights, so the card grows rather than snapping */
const paneAnimation = LayoutAnimation.create(240, 'easeInEaseOut', 'opacity');

/** `unsent` is a run that put no bytes on the server, so Settings keeps its old date */
export type BackupOutcome = 'sent' | 'restored' | 'unsent';

interface Props {
  /** `onboarding` offers a way past it; `standalone` is reached from Settings and offers a way back */
  variant: 'onboarding' | 'standalone';
  onDone: (code: string, outcome: BackupOutcome) => void;
  onDismiss: () => void;
}

// No account and no "forgot code": the code is the only way in, which is why the server cannot read it.
export default function BackupScreen({ variant, onDone, onDismiss }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const [tab, setTab] = useState<Tab>('create');
  // swapped for the saved code once loaded, so a second backup overwrites the first
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
      // stored bare, shown in groups
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

  // through backupNow, so a run somebody watches is settled like the automatic ones
  const runBackup = async () => {
    setBusy(true);
    setError(null);
    const result = await backupNow(fresh);
    setBusy(false);
    if (!result.ok) {
      // only a lost connection ends a run outright; refusals come back in `blocked`
      setError("Couldn't reach the backup. Check your connection and try again.");
      return;
    }
    // kept even when something was refused: this phone backs up under it now
    await saveCode(normalizeCode(fresh) ?? fresh);
    const report = runReport(result);
    setError(report.problem);
    setDone(report.progress);
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

        {/* the wrapper's done bar is the safe way out, since GO here runs the restore */}
        <KeyboardSafeScroll
          contentContainerStyle={styles.content}
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
                ? `One code carries your months to your next ${device()}.`
                : `Type the code and this ${device()} becomes the other one.`}
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
                <Pressable onPress={copy} onLongPress={copy} style={styles.codeBox}>
                  {/* a Text per group, so a narrow screen wraps between groups, never inside one */}
                  <View style={styles.codeGroups}>
                    {fresh.split('-').map((group, i, groups) => (
                      <Text key={i} style={styles.code}>
                        {i < groups.length - 1 ? `${group}-` : group}
                      </Text>
                    ))}
                  </View>
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
                  Write it down. Nobody can look it up for you, not me and not Google.
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
                  // Gboard otherwise suggests words over the code and can learn it
                  keyboardType={Platform.OS === 'android' ? 'visible-password' : undefined}
                  returnKeyType="go"
                  onSubmitEditing={runRestore}
                />
                <Text style={styles.warning}>
                  This replaces what is on this {device()} with what is in the backup.
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
              Everything is encrypted on this {device()} before it leaves. The server
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
        </KeyboardSafeScroll>
    </SafeAreaView>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    topBar: {
      height: 44,
      justifyContent: 'center',
      paddingHorizontal: 20,
      marginTop: 4,
    },
    content: {
      ...COLUMN,
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingBottom: 28,
    },
    brand: {
      alignItems: 'center',
      marginBottom: 22,
    },
    brandMark: { marginBottom: 14 },
    brandSub: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 4,
      color: p.accent,
      marginBottom: 2,
    },
    brandTitle: {
      fontSize: 34,
      fontFamily: FONT.bold,
      letterSpacing: 1,
      color: p.ink,
    },
    tagline: {
      marginTop: 8,
      fontSize: wrapSafe(13),
      fontFamily: FONT.regular,
      color: p.inkSoft,
      textAlign: 'center',
    },
    card: {
      ...cardSurface(p),
      padding: 18,
    },
    label: {
      fontSize: 10,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.inkSoft,
      marginBottom: 6,
    },
    input: {
      backgroundColor: p.chip,
      borderRadius: RADIUS.control,
      borderWidth: 1,
      borderColor: p.lineFaint,
      paddingHorizontal: 13,
      paddingVertical: Platform.OS === 'ios' ? 13 : 9,
      fontSize: 15,
      fontFamily: FONT.medium,
      color: p.ink,
    },
    inputFocused: {
      borderColor: p.accent,
    },
    error: {
      fontSize: wrapSafe(12),
      fontFamily: FONT.medium,
      color: p.missed,
      marginBottom: 12,
    },
    primary: {
      height: 48,
      borderRadius: RADIUS.control,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: {
      fontSize: 12,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.onAccent,
    },
    fine: {
      marginTop: 14,
      fontSize: 11,
      fontFamily: FONT.regular,
      lineHeight: wrapSafe(16),
      color: p.inkSoft,
      textAlign: 'center',
    },
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
    codeGroups: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
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
      lineHeight: wrapSafe(16),
      color: p.inkSoft,
    },
    done: {
      fontSize: wrapSafe(12),
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
