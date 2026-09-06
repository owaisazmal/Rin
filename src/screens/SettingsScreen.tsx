import React, { useMemo } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SectionHeader from '../components/SectionHeader';
import SegmentedControl from '../components/SegmentedControl';
import ThemeIcon from '../components/ThemeIcon';
import ThemeBackdrop from '../components/ThemeBackdrop';
import { Account, displayName } from '../auth';
import { FONT, Palette, RADIUS, ThemeMode, cardSurface, useTheme } from '../theme';

const THEME_OPTIONS = [
  { value: 'dark' as ThemeMode, label: 'DARK' },
  { value: 'light' as ThemeMode, label: 'LIGHT' },
] as const;

const REPO_URL = 'https://github.com/owaisazmal/monthly-planning';

interface Props {
  account: Account | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onClose: () => void;
}

export default function SettingsScreen({ account, onSignIn, onSignOut, onClose }: Props) {
  const { mode, palette, setMode } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const confirmSignOut = () =>
    Alert.alert(
      'Sign out?',
      'Your habits stay on this device either way.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: onSignOut },
      ],
      { cancelable: true }
    );

  // 'bottom' matters now that the colophon is pinned down there: without it the
  // last line sits under Android's gesture pill.
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
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

        <SectionHeader title="ACCOUNT" />
        <View style={styles.card}>
          {account ? (
            <>
              <View style={styles.identity}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {displayName(account).charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.identityText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {displayName(account)}
                  </Text>
                  <Text style={styles.email} numberOfLines={1}>
                    {account.email}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={confirmSignOut}
                style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.ghostText}>SIGN OUT</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.emptyTitle}>Not signed in</Text>
              <Text style={styles.emptyBody}>
                Everything works without an account. Sign in to keep your habits when
                you change phones.
              </Text>
              <Pressable
                onPress={onSignIn}
                style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.primaryText}>SIGN IN</Text>
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
            凛 — quiet composure, discipline that doesn't waver.
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
            App is public, and staying that way.
            No trackers, no data collection, nothing leaving this phone. There is
            no server to send it to even if I wanted it.
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
      minHeight: 96,
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
    identity: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    avatar: {
      width: 46,
      height: 46,
      borderRadius: RADIUS.pill,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 13,
    },
    avatarText: {
      fontSize: 20,
      fontFamily: FONT.bold,
      color: p.onAccent,
      // Josefin sits high in its line box; nudge the initial onto the circle's centre
      marginTop: 2,
    },
    identityText: {
      flex: 1,
    },
    name: {
      fontSize: 17,
      fontFamily: FONT.semibold,
      color: p.ink,
    },
    email: {
      marginTop: 1,
      fontSize: 13,
      fontFamily: FONT.regular,
      color: p.inkSoft,
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
