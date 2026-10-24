import { useMemo } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { MONTH_ABBR } from '../dates';
import { DayBar, axisDays, dayBars, weekdayIndex } from '../trackerCharts';
import { FONT, Palette, RADIUS, SCALE, useTheme } from '../theme';
import ChartHeadline, { DayPicking, MonthChartProps, Spark } from './ChartHeadline';

const SPARK = 12;
const PLOT = 124;
const LABELS = 20;

/** One bar a day, filled by how many habits were done (green) and missed (red); a spark crowns a perfect day */
export default function DayBars({ year, month, data, today, width, selectedDay, onSelectDay, grow }: MonthChartProps & DayPicking) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const chart = useMemo(() => dayBars(year, month, data, today), [year, month, data, today]);
  const len = chart.bars.length;
  const todayDay = today.year === year && today.month === month ? today.day : null;
  const labelled = useMemo(
    () => new Set(axisDays(len, [selectedDay, todayDay])),
    [len, selectedDay, todayDay]
  );
  const per = Math.max(chart.habitCount, 1);
  const pop = grow.interpolate({ inputRange: [0.7, 1], outputRange: [0, 1], extrapolate: 'clamp' });

  const labelFor = (b: DayBar) => {
    const date = `${MONTH_ABBR[month]} ${b.day}`;
    if (b.when === 'future') return `${date}, still to come`;
    if (!chart.habitCount) return `${date}, no habits yet`;
    const missed = b.missed ? `, ${b.missed} missed` : '';
    return `${date}, ${b.done} of ${chart.habitCount} done${missed}${b.perfect ? ', a perfect day' : ''}`;
  };

  const dash = (w: number) => (
    <Svg width={w} height={2}>
      <Line x1={0} y1={1} x2={w} y2={1} stroke={palette.inkSoft} strokeWidth={1.4} strokeDasharray="4 3" />
    </Svg>
  );

  return (
    <View style={styles.wrap}>
      {chart.habitCount ? (
        <ChartHeadline
          icon={<Spark size={13} color={palette.done} />}
          figure={String(chart.perfectDays)}
          text={chart.perfectDays === 1 ? 'perfect day' : 'perfect days'}
          right={
            chart.pct === null ? null : (
              <View style={styles.avgKey} accessible accessibilityLabel={`Average ${chart.pct} percent`}>
                {dash(14)}
                <Text style={styles.avgText} maxFontSizeMultiplier={SCALE.heading}>
                  avg {chart.pct}%
                </Text>
              </View>
            )
          }
        />
      ) : null}

      <View style={styles.bars}>
        {chart.bars.map((b, i) => {
          const on = b.day === selectedDay;
          const isToday = b.day === todayDay;
          const from = (i / len) * 0.45;
          const rise = grow.interpolate({
            inputRange: [from, from + 0.55],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          });
          const filled = b.done + b.missed;
          return (
            <Pressable
              key={b.day}
              android_disableSound
              accessibilityRole="button"
              accessibilityLabel={labelFor(b)}
              accessibilityState={{ selected: on }}
              onPress={() => onSelectDay(b.day)}
              style={[styles.col, i > 0 && weekdayIndex(year, month, b.day) === 0 && styles.weekStart]}
            >
              <View style={styles.sparkSlot}>
                {b.perfect ? (
                  <Animated.View style={{ opacity: pop, transform: [{ scale: pop }] }}>
                    <Spark size={9} color={palette.done} />
                  </Animated.View>
                ) : null}
              </View>
              <View
                style={[
                  styles.track,
                  b.when === 'future' && styles.trackAhead,
                  isToday && styles.trackToday,
                  on && styles.trackOn,
                ]}
              >
                {filled ? (
                  <Animated.View
                    style={[
                      styles.fill,
                      { height: `${(filled / per) * 100}%`, transform: [{ scaleY: rise }] },
                    ]}
                  >
                    <View style={{ flex: b.missed, backgroundColor: palette.missed }} />
                    <View style={{ flex: b.done, backgroundColor: palette.done }} />
                  </Animated.View>
                ) : null}
              </View>
              <View style={styles.labelSlot}>
                {labelled.has(b.day) ? (
                  <View style={styles.labelAnchor}>
                    <View style={[styles.label, on && (isToday ? styles.labelTodayOn : styles.labelOn)]}>
                      <Text
                        style={[styles.dayNum, isToday && styles.dayNumToday, on && styles.dayNumOn]}
                        maxFontSizeMultiplier={SCALE.glyph}
                      >
                        {b.day}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}

        {chart.pct !== null ? (
          <View pointerEvents="none" style={[styles.avgLine, { top: SPARK + PLOT * (1 - chart.pct / 100) - 1 }]}>
            {dash(width)}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    // the tracker card centres its slot, so the chart has to claim the width
    wrap: { alignSelf: 'stretch' },
    avgKey: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    avgText: {
      fontSize: 11,
      fontFamily: FONT.semibold,
      color: p.inkSoft,
      includeFontPadding: false,
    },
    bars: { flexDirection: 'row', height: SPARK + PLOT + LABELS },
    col: { flex: 1, marginHorizontal: 1 },
    // a little more air before each Monday, so the weeks read as groups
    weekStart: { marginLeft: 4 },
    sparkSlot: { height: SPARK, alignItems: 'center', justifyContent: 'center' },
    track: {
      height: PLOT,
      borderRadius: RADIUS.pill,
      backgroundColor: p.chip,
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
    trackAhead: { opacity: 0.45 },
    trackToday: { borderWidth: 1.5, borderColor: p.accent },
    trackOn: { borderWidth: 1.5, borderColor: p.ink },
    fill: {
      borderRadius: RADIUS.pill,
      overflow: 'hidden',
      transformOrigin: 'bottom',
    },
    labelSlot: { height: LABELS },
    labelAnchor: {
      position: 'absolute',
      top: 4,
      left: '50%',
      width: 32,
      marginLeft: -16,
      alignItems: 'center',
    },
    label: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 6 },
    labelOn: { backgroundColor: p.ink },
    labelTodayOn: { backgroundColor: p.accent },
    dayNum: {
      fontSize: 10,
      fontFamily: FONT.medium,
      color: p.inkSoft,
      includeFontPadding: false,
    },
    dayNumToday: { fontFamily: FONT.bold, color: p.accent },
    dayNumOn: { fontFamily: FONT.bold, color: p.bg },
    avgLine: { position: 'absolute', left: 0, right: 0, opacity: 0.85 },
  });
