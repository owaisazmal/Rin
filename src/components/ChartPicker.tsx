import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { CHART_TYPES, ChartType } from '../settings';
import { smoothPath } from '../trackerCharts';
import { FONT, Palette, RADIUS, SCALE, useTheme } from '../theme';
import { CheckGlyph } from './Glyphs';
import { PickerSheet } from './Picker';

export const CHART_INFO: Record<ChartType, { label: string; blurb: string }> = {
  radial: { label: 'Radial', blurb: 'Every habit, every day' },
  github: { label: 'Year', blurb: 'Twelve months at a glance' },
  days: { label: 'Daily', blurb: 'How full each day was' },
  habits: { label: 'Habits', blurb: 'Your habits, ranked' },
  weeks: { label: 'Trend', blurb: 'Week on week' },
  weekdays: { label: 'Weekdays', blurb: 'Which days slip' },
};

const RAMP = [0, 2, 4, 3, 1, 4, 4, 2, 3, 4, 0, 4, 1, 3, 4, 2, 4, 3, 4, 'm', 2, 4, 1, 3, 4, 4, 0, 2, 3, 4, 2, 4];
const HEAT = [4, 3, 'm', 4, 2, 4, 1, 3, 4, 'm', 3, 4, 2, 0, 4, 4, 1, 4, 3, 4, 2];
const BARS = [0.55, 0.8, 1, 0.45, 0.9, 1, 0.7, 0.35, 0.85];
const WAVE = [24, 18, 21, 11, 6].map((y, i) => ({ x: 4 + i * 10, y }));

/** A small drawing of each chart, 48 by 32, for the picker and its chip */
export function ChartGlyph({ type, width, palette: p }: { type: ChartType; width: number; palette: Palette }) {
  const shade = (v: number | string) => (v === 'm' ? p.ghMissed : p.ghLevels[v as number]);
  const art = (() => {
    switch (type) {
      case 'radial':
        return (
          <G transform="rotate(-90 24 16)" fill="none" strokeWidth={4}>
            <Circle cx={24} cy={16} r={13} stroke={p.cellEmpty} />
            <Circle cx={24} cy={16} r={13} stroke={p.done} strokeDasharray="58 82" />
            <Circle cx={24} cy={16} r={13} stroke={p.missed} strokeDasharray="8 82" strokeDashoffset={-62} />
            <Circle cx={24} cy={16} r={6.5} stroke={p.cellEmpty} />
            <Circle cx={24} cy={16} r={6.5} stroke={p.done} strokeDasharray="24 41" />
          </G>
        );
      case 'github':
        return RAMP.map((v, i) => (
          <Rect key={i} x={2.4 + (i % 8) * 5.6} y={5 + Math.floor(i / 8) * 5.6} width={4.4} height={4.4} rx={1.1} fill={shade(v)} />
        ));
      case 'days':
        return BARS.map((h, i) => (
          <G key={i}>
            <Rect x={3 + i * 4.9} y={3} width={3.2} height={26} rx={1.6} fill={p.cellEmpty} />
            <Rect x={3 + i * 4.9} y={29 - 26 * h} width={3.2} height={26 * h} rx={1.6} fill={i === 3 ? p.missed : p.done} />
          </G>
        ));
      case 'habits':
        return [0.92, 0.66, 0.4].map((f, i) => (
          <G key={i}>
            <Rect x={3} y={5 + i * 9} width={42} height={5} rx={2.5} fill={p.cellEmpty} />
            <Rect x={3} y={5 + i * 9} width={42 * f} height={5} rx={2.5} fill={p.done} />
            {i === 2 ? <Rect x={3 + 42 * f - 2} y={5 + i * 9} width={8} height={5} rx={2.5} fill={p.missed} /> : null}
          </G>
        ));
      case 'weeks': {
        const line = smoothPath(WAVE);
        return (
          <>
            <Defs>
              <LinearGradient id={`wave-${width}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={p.done} stopOpacity={0.45} />
                <Stop offset="1" stopColor={p.done} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={`${line} L44 30 L4 30 Z`} fill={`url(#wave-${width})`} />
            <Path d={line} stroke={p.done} strokeWidth={2.2} fill="none" strokeLinecap="round" />
            <Circle cx={44} cy={6} r={3} fill={p.done} />
          </>
        );
      }
      case 'weekdays':
        return HEAT.map((v, i) => (
          <Circle key={i} cx={5 + (i % 7) * 6.3} cy={7 + Math.floor(i / 7) * 9} r={2.6} fill={shade(v)} />
        ));
    }
  })();
  return (
    <Svg width={width} height={(width * 2) / 3} viewBox="0 0 48 32">
      {art}
    </Svg>
  );
}

/** The tracker's chart, chosen from a sheet of drawn tiles */
export default function ChartPicker({
  visible,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  value: ChartType;
  onPick: (chart: ChartType) => void;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const { height } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <PickerSheet visible={visible} title="CHART" onClose={onClose} maxWidth={360}>
      <ScrollView style={{ maxHeight: height * 0.7 }} showsVerticalScrollIndicator={false} overScrollMode="never">
        <View style={styles.grid}>
          {CHART_TYPES.map((type) => {
            const on = type === value;
            const { label, blurb } = CHART_INFO[type];
            return (
              <Pressable
                key={type}
                accessibilityRole="button"
                accessibilityLabel={`${label} chart: ${blurb}`}
                accessibilityState={{ selected: on }}
                onPress={() => {
                  onPick(type);
                  onClose();
                }}
                style={({ pressed }) => [styles.tile, on && styles.tileOn, pressed && { opacity: 0.6 }]}
              >
                <ChartGlyph type={type} width={60} palette={palette} />
                <Text style={[styles.label, on && styles.labelOn]} maxFontSizeMultiplier={SCALE.heading}>
                  {label}
                </Text>
                <Text style={styles.blurb} maxFontSizeMultiplier={SCALE.heading}>
                  {blurb}
                </Text>
                {on ? (
                  <View style={styles.tick}>
                    <CheckGlyph color={palette.onAccent} size={11} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </PickerSheet>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 8,
    },
    tile: {
      width: '48.5%',
      paddingVertical: 12,
      paddingHorizontal: 10,
      borderRadius: RADIUS.control,
      backgroundColor: p.chip,
      borderWidth: 1.5,
      borderColor: p.lineFaint,
      alignItems: 'center',
      gap: 4,
    },
    tileOn: {
      backgroundColor: p.accentSoft,
      borderColor: p.accent,
    },
    label: {
      marginTop: 4,
      fontSize: 13,
      fontFamily: FONT.bold,
      color: p.ink,
      textAlign: 'center',
      includeFontPadding: false,
    },
    labelOn: { color: p.accent },
    blurb: {
      fontSize: 11,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      textAlign: 'center',
      includeFontPadding: false,
    },
    tick: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 18,
      height: 18,
      borderRadius: RADIUS.pill,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
