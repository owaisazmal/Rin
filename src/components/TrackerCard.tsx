import React, { ReactNode, useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import SectionHeader from './SectionHeader';
import SegmentedControl from './SegmentedControl';
import type { ChartType } from '../settings';
import { FONT, Palette, cardSurface, useTheme } from '../theme';

/**
 * The card around whichever chart is showing: the switch between the two, the
 * animated slot the chart arrives in, the month's progress bar, and the
 * legend. The chart itself is handed in as children — the screen owns the
 * data and the taps; this owns the frame.
 */

const CHART_OPTIONS = [
  { value: 'radial' as ChartType, label: 'RADIAL' },
  { value: 'github' as ChartType, label: 'YEAR' },
] as const;

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
          <SegmentedControl
            options={CHART_OPTIONS}
            value={chart}
            onChange={onSetChart}
            verticalPadding={6}
            style={styles.segment}
          />
        }
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
          Add habits below — then tap chart cells or use the daily check to fill them in.
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

      {chart === 'radial' && hasHabits && (
        <View style={styles.legend}>
          <View style={[styles.legendSwatch, { backgroundColor: palette.done }]} />
          <Text style={styles.legendText}>done</Text>
          <View style={[styles.legendSwatch, { backgroundColor: palette.missed }]} />
          <Text style={styles.legendText}>missed</Text>
          <View style={[styles.legendSwatch, styles.legendEmpty]} />
          <Text style={styles.legendText}>pending</Text>
        </View>
      )}
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
    // The options share the width evenly so the sliding pill is one size in
    // both positions; that needs a definite width here, since the header row
    // sizes itself to its content.
    segment: {
      width: 152,
    },
    slot: {
      alignItems: 'center',
    },
    loading: {
      height: 140,
    },
    hint: {
      marginTop: 10,
      fontSize: 13,
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
    legend: {
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 10,
    },
    legendSwatch: {
      width: 12,
      height: 12,
      borderRadius: 3,
    },
    legendEmpty: {
      backgroundColor: p.cellEmpty,
      borderWidth: 1,
      borderColor: p.line,
    },
    legendText: {
      fontSize: 12,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      marginRight: 8,
    },
  });
