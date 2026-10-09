import React, { useMemo } from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { useTheme, FONT, wrapSafe } from '../theme';

interface Props {
  title: string;
  /** optional element pinned to the right edge (badge, nav, control) */
  right?: React.ReactNode;
}

export default function SectionHeader({ title, right }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(
    () =>
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
          backgroundColor: palette.accent,
          marginRight: 8,
        },
        text: {
          color: palette.ink,
          fontFamily: FONT.bold,
          fontSize: wrapSafe(13),
          letterSpacing: 2,
          flex: 1,
        },
      }),
    [palette]
  );
  return (
    <View style={styles.row}>
      <View style={styles.accent} />
      <Text style={styles.text}>{title}</Text>
      {right}
    </View>
  );
}
