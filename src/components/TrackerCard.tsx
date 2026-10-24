import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import ChartLegend from './ChartLegend';
import ChartPicker, { CHART_INFO, ChartGlyph } from './ChartPicker';
import { PickerChip } from './Picker';
import SectionHeader from './SectionHeader';
import type { ChartType } from '../settings';
import { FONT, Palette, cardSurface, useTheme, wrapSafe } from '../theme';

/** The frame around whichever chart is showing: picker, animated slot, progress bar and legend */

/** The done, missed and pending key, for the charts that fill cells or bars */
const KEYED: ChartType[] = ['radial', 'days', 'habits'];

interface Props {
  chart: ChartType;
  onSetChart: (chart: ChartType) => void;
  /** 0 → 1 as the chart arrives; replayed by the caller on a swap and on a month change */
  anim: Animated.Value;
  /** -1 going back, +1 going forward, 0 for a swap in place */
  enterFrom: number;
  stats: { done: number; total: number; pct: number };
  hasHabits: boolean;
  /** the chart, or null while its data is still loading */
  children: ReactNode;
}

export default function TrackerCard({
  chart,
  onSetChart,
  anim,
  enterFrom,
  stats,
  hasHabits,
  children,
}: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [picking, setPicking] = useState(false);

  // the bar eases to its new width rather than jumping there
  const pctAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(pctAnim, {
      toValue: stats.pct,
      duration: 500,
      useNativeDriver: false,
    }).start();
  }, [stats.pct, pctAnim]);

  return (
    <View style={styles.card}>
      <SectionHeader
        title="TRACKER"
        right={
          <PickerChip
            label={CHART_INFO[chart].label}
            icon={<ChartGlyph type={chart} width={21} palette={palette} />}
            accessibilityLabel={`Showing the ${CHART_INFO[chart].label.toLowerCase()} chart. Change the chart.`}
            onPress={() => setPicking(true)}
          />
        }
      />
      <ChartPicker
        visible={picking}
        value={chart}
        onPick={onSetChart}
        onClose={() => setPicking(false)}
      />

      <Animated.View
        style={[
          styles.slot,
          {
            opacity: anim,
            transform: [
              {
                translateX: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [enterFrom * 34, 0],
                }),
              },
              {
                scale: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.97, 1],
                }),
              },
            ],
          },
        ]}
      >
        {children ?? <View style={styles.loading} />}
      </Animated.View>

      {!hasHabits ? (
        <Text style={styles.hint}>
          {chart === 'radial'
            ? 'Add habits below, then tap chart cells or use the daily check to fill them in.'
            : 'Add habits below, then use the daily check to fill them in.'}
        </Text>
      ) : (
        <View style={styles.statsRow}>
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: pctAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>
          <Text style={styles.statsLine}>
            <Text style={styles.statsDone}>{stats.done}</Text>
            <Text>
              {' '}
              / {stats.total} this month · {stats.pct}%
            </Text>
          </Text>
        </View>
      )}

      {KEYED.includes(chart) && hasHabits && <ChartLegend />}
      {chart === 'weekdays' && hasHabits && <ChartLegend heat />}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    card: {
      ...cardSurface(p),
      paddingVertical: 18,
      paddingHorizontal: 16,
    },
    slot: {
      alignItems: 'center',
    },
    loading: {
      height: 140,
    },
    hint: {
      marginTop: 10,
      fontSize: wrapSafe(13),
      fontFamily: FONT.regular,
      color: p.inkSoft,
      textAlign: 'center',
      paddingHorizontal: 24,
    },
    statsRow: {
      marginTop: 12,
      alignItems: 'center',
      gap: 6,
    },
    progressTrack: {
      alignSelf: 'stretch',
      height: 6,
      borderRadius: 3,
      backgroundColor: p.chip,
      overflow: 'hidden',
    },
    progressFill: {
      height: 6,
      borderRadius: 3,
      backgroundColor: p.done,
    },
    statsLine: {
      fontSize: 12,
      color: p.inkSoft,
    },
    statsDone: {
      color: p.done,
      fontFamily: FONT.bold,
    },
  });
