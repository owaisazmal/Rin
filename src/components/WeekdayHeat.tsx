import { useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { DAY_ABBR } from '../dates';
import { Tally, WEEKDAYS, WeekdayHeat as Heat, heatLevel, weekdayHeat, weekdayIndex } from '../trackerCharts';
import { FONT, Palette, RADIUS, SCALE, useTheme, wrapSafe } from '../theme';
import ChartHeadline, { MonthChartProps } from './ChartHeadline';

const GAP = 5;
const RING = 3;
const SHORT = WEEKDAYS.map((d) => DAY_ABBR[d]);
const PLURAL = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];

/** row -1 is the all-habits rings */
type Pick = { row: number; col: number } | null;

const names = (cols: number[]) =>
  cols.length === 1
    ? PLURAL[cols[0]]
    : `${cols.slice(0, -1).map((c) => SHORT[c]).join(', ')} & ${SHORT[cols[cols.length - 1]]}`;

function headline(heat: Heat, pick: Pick, p: Palette): { figure?: string; text: string; tone?: string } {
  if (pick) {
    const t = pick.row < 0 ? heat.all[pick.col] : heat.rows[pick.row].cells[pick.col];
    const who = pick.row < 0 ? 'every habit' : heat.rows[pick.row].name;
    if (!t.counted) return { text: `${who} on ${PLURAL[pick.col]}: nothing to count yet` };
    return pick.row < 0
      ? { figure: `${t.pct}%`, text: `done on ${PLURAL[pick.col]}`, tone: p.done }
      : { figure: `${t.done} of ${t.counted}`, text: `${who} on ${PLURAL[pick.col]}`, tone: t.done ? p.done : p.missed };
  }
  if (heat.weakest.length) {
    return {
      figure: names(heat.weakest),
      text: `slip the most · ${heat.all[heat.weakest[0]].pct}%`,
      tone: p.missed,
    };
  }
  const rated = heat.all.find((t) => t.pct !== null);
  return rated ? { figure: `${rated.pct}%`, text: 'every weekday level', tone: p.done } : { text: 'Nothing to count yet' };
}

/** Habits across the days of the week, so the days that slip show up; tapping a square or ring gives its count */
export default function WeekdayHeat({ year, month, data, today, width, grow }: MonthChartProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const heat = useMemo(() => weekdayHeat(year, month, data, today), [year, month, data, today]);
  // the planner keys this by month, which resets it
  const [pick, setPick] = useState<Pick>(null);

  const nameW = Math.round(Math.min(120, Math.max(76, width * 0.3)));
  const cell = Math.floor(Math.min(32, (width - nameW - 7 * GAP) / 7));
  const todayCol = today.year === year && today.month === month ? weekdayIndex(year, month, today.day) : -1;
  const head = headline(heat, pick, palette);

  const choose = (row: number, col: number) =>
    setPick((was) => (was && was.row === row && was.col === col ? null : { row, col }));
  const isPicked = (row: number, col: number) => pick?.row === row && pick.col === col;
  const shade = (t: Tally) => {
    const level = heatLevel(t.done, t.missed, t.counted);
    return level === 'missed' ? palette.ghMissed : palette.ghLevels[level];
  };
  const appear = (row: number, col: number) => {
    const from = Math.min((row + 1 + col) * 0.04, 0.5);
    return grow.interpolate({ inputRange: [from, from + 0.4], outputRange: [0, 1], extrapolate: 'clamp' });
  };
  const count = (t: Tally) => (t.counted ? `${t.done} of ${t.counted} done` : 'nothing to count yet');

  const r = cell / 2 - RING / 2 - 1;
  const around = 2 * Math.PI * r;

  return (
    <View style={styles.wrap}>
      <ChartHeadline figure={head.figure} text={head.text} tone={head.tone} />

      <View style={styles.row}>
        <View style={{ width: nameW }} />
        {SHORT.map((d, c) => (
          <View key={d} style={[styles.dayHead, { width: cell }]}>
            <Text
              style={[
                styles.day,
                heat.strongest.includes(c) && { color: palette.done },
                heat.weakest.includes(c) && { color: palette.missed },
                c === todayCol && styles.dayToday,
              ]}
              maxFontSizeMultiplier={SCALE.glyph}
            >
              {d}
            </Text>
            {c === todayCol ? <View style={styles.todayBar} /> : null}
          </View>
        ))}
      </View>

      <View style={styles.row}>
        <Text style={[styles.name, styles.allName, { width: nameW }]} numberOfLines={2} maxFontSizeMultiplier={SCALE.heading}>
          All habits
        </Text>
        {heat.all.map((t, c) => {
          const tone = heat.weakest.includes(c) ? palette.missed : palette.done;
          const on = isPicked(-1, c);
          const a = appear(0, c);
          return (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityLabel={`${PLURAL[c]}, every habit: ${count(t)}`}
              accessibilityState={{ selected: on }}
              onPress={() => choose(-1, c)}
              style={styles.cellSlot}
            >
              <Animated.View style={{ opacity: a, transform: [{ scale: a }] }}>
                <Svg width={cell} height={cell}>
                  {on ? <Circle cx={cell / 2} cy={cell / 2} r={cell / 2} fill={palette.accentSoft} /> : null}
                  <Circle cx={cell / 2} cy={cell / 2} r={r} stroke={palette.chip} strokeWidth={RING} fill="none" />
                  {t.pct ? (
                    <Circle
                      cx={cell / 2}
                      cy={cell / 2}
                      r={r}
                      stroke={tone}
                      strokeWidth={RING}
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray={`${(around * t.pct) / 100} ${around}`}
                      transform={`rotate(-90 ${cell / 2} ${cell / 2})`}
                    />
                  ) : null}
                  <SvgText
                    x={cell / 2}
                    y={cell / 2 + 3}
                    fontSize={Math.max(8, cell * 0.3)}
                    fontFamily={FONT.bold}
                    fill={on ? palette.ink : palette.inkSoft}
                    textAnchor="middle"
                  >
                    {t.pct === null ? '–' : String(t.pct)}
                  </SvgText>
                </Svg>
              </Animated.View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.divider} />

      {heat.rows.map((row, ri) => (
        <View key={row.id} style={[styles.row, styles.habitRow]}>
          <Text style={[styles.name, { width: nameW }]} numberOfLines={2} maxFontSizeMultiplier={SCALE.heading}>
            {row.name}
          </Text>
          {row.cells.map((t, c) => {
            const on = isPicked(ri, c);
            const a = appear(ri + 1, c);
            return (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityLabel={`${row.name} on ${PLURAL[c]}: ${count(t)}`}
                accessibilityState={{ selected: on }}
                onPress={() => choose(ri, c)}
                style={styles.cellSlot}
              >
                <Animated.View
                  style={[
                    styles.cell,
                    { width: cell, height: cell, backgroundColor: shade(t) },
                    on && styles.cellOn,
                    { opacity: a, transform: [{ scale: a }] },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    wrap: { alignSelf: 'stretch' },
    row: { flexDirection: 'row', alignItems: 'center' },
    habitRow: { marginTop: GAP },
    dayHead: { marginLeft: GAP, alignItems: 'center', paddingBottom: 6 },
    day: {
      fontSize: 10,
      fontFamily: FONT.semibold,
      color: p.inkSoft,
      includeFontPadding: false,
    },
    dayToday: { fontFamily: FONT.bold },
    todayBar: {
      position: 'absolute',
      bottom: 1,
      width: 12,
      height: 2,
      borderRadius: 1,
      backgroundColor: p.accent,
    },
    name: {
      paddingRight: 8,
      fontSize: wrapSafe(12),
      fontFamily: FONT.medium,
      color: p.ink,
    },
    allName: { fontFamily: FONT.bold, color: p.inkSoft },
    cellSlot: { marginLeft: GAP },
    cell: { borderRadius: RADIUS.chip },
    cellOn: { borderWidth: 2, borderColor: p.ink },
    divider: {
      height: 1,
      backgroundColor: p.lineFaint,
      marginTop: 10,
      marginBottom: 5,
    },
  });
