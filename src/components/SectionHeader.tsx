import React, { useMemo } from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { useTheme, FONT, Palette, RADIUS, SCALE, wrapSafe } from '../theme';

interface Props {
  title: string;
  /** optional element pinned to the right edge (badge, nav, control) */
  right?: React.ReactNode;
}

export default function SectionHeader({ title, right }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={styles.row}>
      <View style={styles.accent} />
      <Text style={styles.text} maxFontSizeMultiplier={SCALE.heading}>
        {title}
      </Text>
      {right}
    </View>
  );
}

/** A small count such as "2/3", for the right of a section header */
export function CountBadge({ label }: { label: string }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText} maxFontSizeMultiplier={SCALE.figure}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    accent: {
      width: 4,
      height: 15,
      borderRadius: 2,
      backgroundColor: p.accent,
      marginRight: 8,
    },
    text: {
      color: p.ink,
      fontFamily: FONT.bold,
      fontSize: wrapSafe(13),
      letterSpacing: 2,
      flex: 1,
    },
    badge: {
      backgroundColor: p.chip,
      borderRadius: RADIUS.chip,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    badgeText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      color: p.inkSoft,
    },
  });
