import { useMemo } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View } from 'react-native';
import { FONT, Palette, SCALE, useTheme } from '../theme';

interface Props {
  /** the less-to-more ramp and missed, rather than done, missed and pending */
  heat?: boolean;
  /** reads the key as one sentence instead of word by word */
  accessibilityLabel?: string;
}

/** The colour key under a chart */
export default function ChartLegend({ heat = false, accessibilityLabel }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const word = (text: string, style?: StyleProp<TextStyle>) => (
    <Text style={[styles.text, style]} maxFontSizeMultiplier={SCALE.figure}>
      {text}
    </Text>
  );

  return (
    <View
      style={styles.legend}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
    >
      {heat ? (
        <>
          {word('less')}
          {palette.ghLevels.map((c, i) => (
            <View key={i} style={[styles.swatch, styles.ramp, { backgroundColor: c }]} />
          ))}
          {word('more', styles.more)}
          <View style={[styles.swatch, { backgroundColor: palette.ghMissed }]} />
          {word('missed')}
        </>
      ) : (
        <>
          <View style={[styles.swatch, { backgroundColor: palette.done }]} />
          {word('done')}
          <View style={[styles.swatch, { backgroundColor: palette.missed }]} />
          {word('missed')}
          <View style={[styles.swatch, styles.empty]} />
          {word('pending')}
        </>
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    legend: {
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 10,
    },
    swatch: {
      width: 12,
      height: 12,
      borderRadius: 3,
    },
    empty: {
      backgroundColor: p.cellEmpty,
      borderWidth: 1,
      borderColor: p.line,
    },
    ramp: { marginHorizontal: -2 },
    more: { marginLeft: 2 },
    text: {
      fontSize: 12,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      marginRight: 8,
    },
  });
