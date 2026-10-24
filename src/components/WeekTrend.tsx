import React, { useMemo } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { MONTH_ABBR } from '../dates';
import { WeekPoint, smoothSegments, weekPoints } from '../trackerCharts';
import { FONT, Palette, SCALE, useTheme } from '../theme';
import ChartHeadline, { DayPicking, Delta, MonthChartProps } from './ChartHeadline';

const TOP = 16;
const PLOT = 112;
const BOTTOM = 8;
const HEIGHT = TOP + PLOT + BOTTOM;
const PAD = 6;

const span = (w: WeekPoint) => (w.first === w.last ? String(w.first) : `${w.first}–${w.last}`);

/** Each week's rate as a rising curve; the week still running is drawn dashed, and tapping a week opens its first day */
export default function WeekTrend({ year, month, data, today, width, selectedDay, onSelectDay, grow }: MonthChartProps & DayPicking) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const weeks = useMemo(() => weekPoints(year, month, data, today), [year, month, data, today]);
  const step = (width - 2 * PAD) / weeks.length;
  const xAt = (i: number) => PAD + step * (i + 0.5);
  const yAt = (pct: number) => TOP + (1 - pct / 100) * PLOT;
  const sel = weeks.findIndex((w) => selectedDay >= w.first && selectedDay <= w.last);
  const todayWeek =
    today.year === year && today.month === month
      ? weeks.findIndex((w) => today.day >= w.first && today.day <= w.last)
      : -1;

  const rated = weeks.flatMap((w, i) => (w.pct === null ? [] : [{ w, i, x: xAt(i), y: yAt(w.pct) }]));
  const segs = smoothSegments(rated);
  const start = rated.length ? `M${rated[0].x} ${rated[0].y}` : '';
  // the last curve is dashed while its week is still running
  const live = rated.length > 1 && rated[rated.length - 1].w.running;
  const solid = [start, ...(live ? segs.slice(0, -1) : segs)].join(' ');
  const dashed = live ? `M${rated[rated.length - 2].x} ${rated[rated.length - 2].y} ${segs[segs.length - 1]}` : '';
  const area =
    rated.length > 1
      ? `${[start, ...segs].join(' ')} L${rated[rated.length - 1].x} ${TOP + PLOT} L${rated[0].x} ${TOP + PLOT} Z`
      : '';

  const rise = grow.interpolate({ inputRange: [0, 0.85], outputRange: [0, 1], extrapolate: 'clamp' });
  const picked = weeks[sel];
  const when = picked
    ? `${picked.first === picked.last ? `${MONTH_ABBR[month]} ${picked.first}` : `${span(picked)} ${MONTH_ABBR[month]}`}${
        picked.running && picked.pct !== null ? ', so far' : ''
      }`
    : '';

  return (
    <View style={styles.wrap}>
      {picked ? (
        <ChartHeadline
          figure={picked.pct === null ? undefined : `${picked.pct}%`}
          text={picked.pct === null ? `Nothing to count yet, ${when}` : `week of ${when}`}
          right={picked.change === null ? null : <Delta change={picked.change} palette={palette} />}
        />
      ) : null}

      <View>
        <Animated.View
          pointerEvents="none"
          style={[styles.plot, { opacity: rise, transform: [{ scaleY: rise }] }]}
        >
          <Svg width={width} height={HEIGHT}>
            <Defs>
              <LinearGradient id="weekTrendFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={palette.done} stopOpacity={0.38} />
                <Stop offset="1" stopColor={palette.done} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {sel >= 0 ? (
              <Rect
                x={PAD + step * sel + 3}
                y={2}
                width={Math.max(0, step - 6)}
                height={HEIGHT - 2}
                rx={10}
                fill={palette.accentSoft}
                fillOpacity={0.7}
              />
            ) : null}
            {[100, 50, 0].map((pct) => (
              <Line
                key={pct}
                x1={PAD}
                x2={width - PAD}
                y1={yAt(pct)}
                y2={yAt(pct)}
                stroke={palette.line}
                strokeOpacity={0.55}
                strokeWidth={1}
                strokeDasharray={pct === 50 ? '3 4' : undefined}
              />
            ))}
            {[100, 50].map((pct) => (
              <SvgText
                key={pct}
                x={PAD + 2}
                y={yAt(pct) - 4}
                fontSize={9}
                fontFamily={FONT.medium}
                fill={palette.inkSoft}
              >
                {`${pct}%`}
              </SvgText>
            ))}
            {area ? <Path d={area} fill="url(#weekTrendFill)" /> : null}
            {rated.length > 1 ? (
              <Path d={solid} stroke={palette.done} strokeWidth={2.6} fill="none" strokeLinecap="round" />
            ) : null}
            {dashed ? (
              <Path
                d={dashed}
                stroke={palette.done}
                strokeWidth={2.6}
                strokeDasharray="5 5"
                fill="none"
                strokeLinecap="round"
              />
            ) : null}
            {rated.map(({ w, i, x, y }) =>
              i === sel ? (
                <React.Fragment key={i}>
                  <Circle cx={x} cy={y} r={11} fill={palette.doneSoft} />
                  <Circle cx={x} cy={y} r={5.5} fill={palette.done} stroke={palette.bg} strokeWidth={2} />
                </React.Fragment>
              ) : (
                <Circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={4.2}
                  fill={palette.bg}
                  stroke={palette.done}
                  strokeWidth={2}
                  strokeDasharray={w.running ? '2 2' : undefined}
                />
              )
            )}
          </Svg>
        </Animated.View>

        <View style={styles.columns}>
          {weeks.map((w, i) => {
            const rate =
              w.pct === null
                ? 'nothing to count yet'
                : `${w.pct} percent${w.running ? ' so far' : ''}${
                    w.change === null || w.change === 0
                      ? ''
                      : `, ${w.change > 0 ? 'up' : 'down'} ${Math.abs(w.change)} points on the week before`
                  }`;
            return (
              <Pressable
                key={w.first}
                android_disableSound
                accessibilityRole="button"
                accessibilityLabel={`Week of ${MONTH_ABBR[month]} ${w.first} to ${w.last}: ${rate}`}
                accessibilityState={{ selected: i === sel }}
                onPress={() => onSelectDay(w.first)}
                style={styles.column}
              >
                <View style={{ height: HEIGHT }} />
                <Text
                  style={[
                    styles.weekLabel,
                    i === todayWeek && styles.weekLabelToday,
                    i === sel && styles.weekLabelOn,
                  ]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={SCALE.heading}
                >
                  {span(w)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    wrap: { alignSelf: 'stretch' },
    plot: { position: 'absolute', top: 0, left: 0, transformOrigin: 'bottom' },
    columns: { flexDirection: 'row', paddingHorizontal: PAD },
    column: { flex: 1, alignItems: 'center' },
    weekLabel: {
      marginTop: 6,
      fontSize: 10,
      fontFamily: FONT.medium,
      color: p.inkSoft,
      includeFontPadding: false,
    },
    weekLabelToday: { fontFamily: FONT.bold, color: p.accent },
    weekLabelOn: { fontFamily: FONT.bold, color: p.ink },
  });
