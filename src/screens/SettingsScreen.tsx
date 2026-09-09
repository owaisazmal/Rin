import React, { useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SectionHeader from '../components/SectionHeader';
import SegmentedControl from '../components/SegmentedControl';
import ThemeIcon from '../components/ThemeIcon';
import ThemeBackdrop from '../components/ThemeBackdrop';
import type { BackupStatus } from '../hooks/useAutoBackup';
import { backupCard } from './backupWording';
import { FONT, Palette, RADIUS, ThemeMode, cardSurface, useTheme } from '../theme';

const THEME_OPTIONS = [
  { value: 'dark' as ThemeMode, label: 'DARK' },
  { value: 'light' as ThemeMode, label: 'LIGHT' },
] as const;

const REPO_URL = 'https://github.com/owaisazmal/monthly-planning';

interface Props {
  hasBackup: boolean;
  lastBackupAt: number | null;
  backupStatus: BackupStatus;
  onOpenBackup: () => void;
  /**
   * Take the park off everything the last run was refused and try the lot again.
   *
   * Offered only when something is stuck, and it is the half of the recovery
   * story the card could not tell before. A refusal is remembered against the
   * version of the document it happened to, so editing that document is what
   * brings it back — which works for a month somebody trims and works for
   * nothing else. A server that turned this install away is not fixed by typing
   * in September, and neither is a month shortened by hand outside the app.
   */
  onRetryBackup: () => Promise<void>;
  onForgetBackup: () => void;
  onClose: () => void;
}

/**
 * Where the backup card's words come from.
 *
 * Not from here. `backupWording.ts` decides every sentence on it out of the
 * ledger's account of this phone, and it is a separate file because the suite
 * runs in plain Node while this one imports React Native — and because every
 * bug that card has had was a sentence rather than a layout, which is exactly
 * the kind of thing a test can hold still and read.
 */
export default function SettingsScreen({
  hasBackup,
  lastBackupAt,
  backupStatus,
  onOpenBackup,
  onRetryBackup,
  onForgetBackup,
  onClose,
}: Props) {
  const { mode, palette, setMode } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const card = backupCard(backupStatus, lastBackupAt);

  /**
   * The retry is the one action here that takes a noticeable moment — it signs
   * in, re-reads every stuck document and offers it again — so it says so.
   * Nothing is reported back on the way out: the card is read from the ledger
   * and re-publishes itself the moment the run is over, which is the same
   * sentence arriving from the place that actually knows.
   */
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetryBackup();
    } finally {
      setRetrying(false);
    }
  };

  /**
   * Scrolling is switched off while the page already fits, which is the normal
   * case: the clip panel takes the leftover space, so the layout sizes itself
   * to the screen rather than running past it.
   *
   * That is not tidiness. The clip's field is dropped out with a blend mode,
   * and Android abandons the offscreen layer a blend mode needs the moment a
   * scroll container starts handling a drag, so the raw black field snapped
   * back for the length of the gesture. Measured on the emulator: the panel
   * sits 2 levels off the page at rest, fell to 44 levels under a drag, and
   * holds at 1 with the scroller inert.
   *
   * It switches back on the moment the content genuinely overflows, which a
   * large accessibility font or a short screen can cause. Settings you cannot
   * reach would be a far worse fault than a decoration that flickers.
   */
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const scrollable = contentHeight > viewport + 1;

  const confirmForget = () =>
    Alert.alert(
      'Forget the code?',
      'This phone stops backing up. The backup itself stays where it is — anyone with the code written down can still restore it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Forget', style: 'destructive', onPress: onForgetBackup },
      ],
      { cancelable: true }
    );

  // 'bottom' matters now that the colophon is pinned down there: without it the
  // last line sits under Android's gesture pill.
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        scrollEnabled={scrollable}
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => setContentHeight(h)}
      >
        <View style={styles.header}>
          <Text style={styles.title}>SETTINGS</Text>
          <Pressable
            hitSlop={10}
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.closeGlyph}>✕</Text>
          </Pressable>
        </View>

        <SectionHeader title="BACKUP" />
        <View style={styles.card}>
          {hasBackup ? (
            <>
              <Text style={[styles.emptyTitle, card.attention && styles.alertTitle]}>
                {card.title}
              </Text>
              <Text style={[styles.emptyBody, card.attention && styles.alertBody]}>
                {card.body}
              </Text>
              <Pressable
                onPress={onOpenBackup}
                style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.primaryText}>BACK UP NOW</Text>
              </Pressable>
              {card.retry ? (
                <Pressable
                  disabled={retrying}
                  onPress={retry}
                  style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={[styles.ghostText, styles.retryText]}>
                    {retrying ? 'TRYING…' : 'TRY IT AGAIN NOW'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={confirmForget}
                style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.ghostText}>FORGET THE CODE</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.emptyTitle}>No backup</Text>
              <Text style={styles.emptyBody}>
                Everything works without one. A backup carries your months to your next
                phone, encrypted with a code only you hold.
              </Text>
              <Pressable
                onPress={onOpenBackup}
                style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.primaryText}>SET ONE UP</Text>
              </Pressable>
            </>
          )}
        </View>

        <SectionHeader title="APPEARANCE" />
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <ThemeIcon mode={mode} color={palette.accent} size={18} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Theme</Text>
              <Text style={styles.rowSub}>
                {mode === 'dark' ? 'Dark — ivory on charcoal' : 'Light — charcoal on ivory'}
              </Text>
            </View>
          </View>
          <SegmentedControl
            options={THEME_OPTIONS}
            value={mode}
            onChange={setMode}
            verticalPadding={9}
          />
        </View>

        <Text style={styles.footer}>Your widgets follow this too.</Text>

        <View style={styles.clipPanel}>
          <ThemeBackdrop />
        </View>

        <View style={styles.colophon}>
          <Text style={styles.appName}>Rin</Text>
          <Text style={styles.appDefinition}>
            凛 — dignity in showing up, day after day.
          </Text>
          <Text style={styles.madeBy}>
            Free and open-source. Made by Owais Khan. No team, no investors, and
            no analytics to tell me whether anyone ever reads this line.
          </Text>
          <Pressable
            hitSlop={10}
            accessibilityRole="link"
            onPress={() => Linking.openURL(REPO_URL)}
            style={({ pressed }) => [styles.repo, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.repoText}>{REPO_URL.replace('https://', '')}</Text>
          </Pressable>
          <Text style={styles.madeBy}>
            App is public, and staying that way. No trackers, no analytics, no
            data collection. Nothing leaves this phone unless you ask for a
            backup, and what leaves then is encrypted with a code I never see.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    content: {
      flexGrow: 1,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 28,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 22,
      paddingHorizontal: 4,
    },
    title: {
      fontSize: 26,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
    },
    closeBtn: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.pill,
      borderWidth: 1,
      borderColor: p.lineFaint,
      backgroundColor: p.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeGlyph: {
      fontSize: 15,
      fontFamily: FONT.medium,
      color: p.ink,
      lineHeight: 18,
    },
    card: {
      ...cardSurface(p),
      padding: 16,
      marginBottom: 22,
    },
    /**
     * Home for the theme clip, and the screen's slack. Taking the leftover
     * space rather than a fixed ratio puts the colophon on the bottom edge on
     * any screen without the page having to scroll to reach it — and the clip
     * is drawn with `contain`, so a wide short panel shrinks the drawing
     * instead of cropping it.
     */
    clipPanel: {
      flex: 1,
      // A floor, not a target: the panel is decoration and can give ground when
      // the screen is tight. Every point it refuses to yield is a point the page
      // overflows by, which turns the scroller back on and costs the clip its
      // blend under a drag.
      minHeight: 80,
      // Clearance for the clip's edge fades, which reach outside the panel —
      // without it they wash over the caption and the colophon. Only iOS draws
      // them, and on a short screen this margin is the difference between a
      // drawing that fills the panel and one that looks like a stamp, so
      // Android keeps its space instead of paying for a fade it never renders.
      ...Platform.select({
        ios: { marginTop: 50, marginBottom: 54 },
        default: { marginTop: 10, marginBottom: 16 },
      }),
    },
    ghostBtn: {
      marginTop: 16,
      height: 42,
      borderRadius: RADIUS.control,
      borderWidth: 1,
      borderColor: p.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ghostText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.inkSoft,
    },
    /**
     * The one ghost button that is not a way out of something. "Forget the code"
     * is quiet because it should be hard to press by accident; this is the
     * answer to the sentence directly above it, so it takes the accent the
     * alert title is already wearing and reads as part of the same paragraph.
     */
    retryText: { color: p.accent },
    emptyTitle: {
      fontSize: 17,
      fontFamily: FONT.semibold,
      color: p.ink,
    },
    emptyBody: {
      marginTop: 6,
      fontSize: 13,
      fontFamily: FONT.regular,
      lineHeight: 19,
      color: p.inkSoft,
    },
    /**
     * The states that need something done about them. Reassurance is meant to
     * sit quietly in `inkSoft` and be skimmed past; a month that has not gone
     * anywhere in three weeks says the same words at the same weight unless the
     * colour separates them, so the title takes the accent and the line under it
     * comes up to full ink.
     */
    alertTitle: { color: p.accent },
    alertBody: { color: p.ink },
    primary: {
      marginTop: 16,
      height: 44,
      borderRadius: RADIUS.control,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.onAccent,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
    },
    rowIcon: {
      width: 34,
      height: 34,
      borderRadius: RADIUS.chip,
      backgroundColor: p.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    rowText: {
      flex: 1,
    },
    rowTitle: {
      fontSize: 15,
      fontFamily: FONT.semibold,
      color: p.ink,
    },
    rowSub: {
      marginTop: 1,
      fontSize: 12,
      fontFamily: FONT.regular,
      color: p.inkSoft,
    },
    colophon: {
      alignItems: 'center',
      paddingHorizontal: 12,
    },
    appName: {
      marginBottom: 4,
      fontSize: 22,
      fontFamily: FONT.bold,
      letterSpacing: 1,
      color: p.ink,
      textAlign: 'center',
    },
    appDefinition: {
      marginBottom: 14,
      fontSize: 12,
      fontFamily: FONT.italic,
      color: p.inkSoft,
      textAlign: 'center',
    },
    madeBy: {
      textAlign: 'center',
      fontSize: 11,
      lineHeight: 17,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      opacity: 0.75,
    },
    repo: {
      marginVertical: 8,
    },
    repoText: {
      fontSize: 12,
      fontFamily: FONT.semibold,
      color: p.accent,
      textDecorationLine: 'underline',
    },
    footer: {
      textAlign: 'center',
      fontSize: 11,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      opacity: 0.8,
    },
  });
