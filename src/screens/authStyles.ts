import { Platform, StyleSheet } from 'react-native';
import { FONT, Palette, RADIUS, cardSurface } from '../theme';

/**
 * What the sign-in and reset screens share: a fixed top bar, a centred column,
 * the wordmark block, one card, and the field and button treatments inside it.
 * Each screen spreads this and adds the few styles that are its own.
 */
export const authStyles = (p: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    flex: { flex: 1 },
    topBar: {
      height: 44,
      justifyContent: 'center',
      paddingHorizontal: 20,
      marginTop: 4,
    },
    content: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingBottom: 28,
    },
    brand: {
      alignItems: 'center',
      marginBottom: 22,
    },
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
      fontSize: 13,
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
      fontSize: 12,
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
      lineHeight: 16,
      color: p.inkSoft,
      textAlign: 'center',
    },
  });
