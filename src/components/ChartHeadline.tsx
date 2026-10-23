import React, { ReactNode, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { FONT, Palette, SCALE, useTheme } from '../theme';

/** The line above a month chart: a figure, what it counts, and anything pinned right */
export default function ChartHeadline({
  figure,
  text,
  tone,
  icon,
  right,
}: {
  figure?: string;
  text: string;
  /** the figure's colour, ink by default */
  tone?: string;
  icon?: ReactNode;
  right?: ReactNode;
}) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={styles.row}>
      <View style={styles.headline}>
        {icon}
        <Text style={styles.text} maxFontSizeMultiplier={SCALE.heading} numberOfLines={2}>
          {figure ? (
            <Text style={[styles.figure, tone ? { color: tone } : null]}>{`${figure} `}</Text>
          ) : null}
          {text}
        </Text>
      </View>
      {right}
    </View>
  );
}

/** A four-point spark, for a day with every habit done */
export function Spark({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10">
      <Path d="M5 0 Q5.6 4.4 10 5 Q5.6 5.6 5 10 Q4.4 5.6 0 5 Q4.4 4.4 5 0 Z" fill={color} />
    </Svg>
  );
}

/** Points up or down on the week before; drawn, since Josefin has no triangles */
export function Delta({ change, palette }: { change: number; palette: Palette }) {
  const tone = change > 0 ? palette.done : change < 0 ? palette.missed : palette.inkSoft;
  const soft = change > 0 ? palette.doneSoft : change < 0 ? palette.missedSoft : palette.chip;
  return (
    <View style={[deltaStyles.pill, { backgroundColor: soft }]}>
      {change !== 0 ? (
        <Svg width={8} height={7} viewBox="0 0 8 7">
          <Path d={change > 0 ? 'M4 0 L8 7 L0 7 Z' : 'M0 0 L8 0 L4 7 Z'} fill={tone} />
        </Svg>
      ) : null}
      <Text style={[deltaStyles.text, { color: tone }]} maxFontSizeMultiplier={SCALE.heading}>
        {change === 0 ? 'level' : `${Math.abs(change)} pts`}
      </Text>
    </View>
  );
}

const deltaStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  text: {
    fontSize: 11,
    fontFamily: FONT.bold,
    includeFontPadding: false,
  },
});

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 12,
    },
    headline: {
      flexShrink: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    text: {
      flexShrink: 1,
      fontSize: 12,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      includeFontPadding: false,
    },
    figure: {
      fontSize: 15,
      fontFamily: FONT.bold,
      color: p.ink,
    },
  });
