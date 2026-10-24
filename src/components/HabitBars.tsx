import { useMemo, useState } from 'react';
import { Animated, LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';
import { dayWhen } from '../marking';
import { HabitBar, habitBars } from '../trackerCharts';
import { FONT, Palette, RADIUS, SCALE, useTheme, wrapSafe } from '../theme';
import ChartHeadline, { MonthChartProps } from './ChartHeadline';
import { ChevronGlyph } from './Glyphs';

const openAnimation = LayoutAnimation.create(200, 'easeInEaseOut', 'opacity');

function headline(bars: HabitBar[]): { figure?: string; text: string } {
  const top = bars.filter((b) => b.rank === 1);
  if (!top.length) return { text: 'Nothing to count yet' };
  const figure = `${top[0].pct}%`;
  if (bars.length === 1) return { figure, text: top[0].name };
  if (top.length === bars.length) return { figure, text: 'every habit level' };
  if (top.length === 1) return { figure, text: `${top[0].name} leads` };
  return { figure, text: `${top.length} habits share the lead` };
}

/** Habits ranked by how much of the month they kept; tapping one opens its month day by day */
export default function HabitBars({ year, month, data, today, grow }: MonthChartProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const bars = useMemo(() => habitBars(year, month, data, today), [year, month, data, today]);
  // the planner keys this by month, which resets it
  const [open, setOpen] = useState<string | null>(null);
  const todayDay = today.year === year && today.month === month ? today.day : null;

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(openAnimation);
    setOpen((was) => (was === id ? null : id));
  };

  if (!bars.length) {
    return (
      <View style={[styles.wrap, styles.list]}>
        {[0.62, 0.44, 0.3].map((w) => (
          <View key={w} style={styles.ghost}>
            <View style={[styles.ghostName, { width: `${w * 100}%` }]} />
            <View style={styles.track} />
          </View>
        ))}
      </View>
    );
  }

  const head = headline(bars);
  return (
    <View style={styles.wrap}>
      <ChartHeadline figure={head.figure} text={head.text} tone={palette.done} />
      <View style={styles.list}>
        {bars.map((b, i) => {
          const on = open === b.id;
          const lead = b.rank === 1;
          const from = Math.min(i * 0.07, 0.4);
          const reach = grow.interpolate({
            inputRange: [from, from + 0.6],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          });
          const rate = b.pct === null ? 'nothing to count yet' : `${b.pct} percent`;
          return (
            <Pressable
              key={b.id}
              accessibilityRole="button"
              accessibilityLabel={`${b.name}, ${b.rank ? `number ${b.rank}, ` : ''}${rate}`}
              accessibilityHint={on ? 'Hides its days' : 'Shows its days'}
              accessibilityState={{ expanded: on }}
              onPress={() => toggle(b.id)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.head}>
                <View style={[styles.rank, lead && styles.rankLead]}>
                  <Text style={[styles.rankText, lead && styles.rankTextLead]} maxFontSizeMultiplier={SCALE.glyph}>
                    {b.rank ?? '–'}
                  </Text>
                </View>
                <Text style={styles.name} numberOfLines={2} maxFontSizeMultiplier={SCALE.heading}>
                  {b.name}
                </Text>
                <Text style={[styles.pct, lead && { color: palette.done }]} maxFontSizeMultiplier={SCALE.heading}>
                  {b.pct === null ? '–' : `${b.pct}%`}
                </Text>
                <ChevronGlyph color={palette.inkSoft} size={12} up={on} />
              </View>
              <View style={styles.track}>
                <Animated.View style={[styles.fill, { transform: [{ scaleX: reach }] }]}>
                  <View style={{ flex: b.done, backgroundColor: palette.done }} />
                  <View style={{ flex: b.missed, backgroundColor: palette.missed }} />
                  <View style={{ flex: b.empty }} />
                </Animated.View>
              </View>
              {on ? (
                <View style={styles.detail}>
                  <View style={styles.strip}>
                    {b.strip.map((state, d) => {
                      const when = dayWhen(year, month, d + 1, today);
                      return (
                        <View
                          key={d}
                          style={[
                            styles.dot,
                            state === 1
                              ? styles.dotDone
                              : state === 2
                                ? styles.dotMissed
                                : when === 'past'
                                  ? styles.dotBlank
                                  : styles.dotAhead,
                            d + 1 === todayDay && styles.dotToday,
                          ]}
                        />
                      );
                    })}
                  </View>
                  <Text style={styles.detailText} maxFontSizeMultiplier={SCALE.heading}>
                    {`${b.done} done · ${b.missed} missed · ${b.empty} blank · best run ${b.bestRun} ${
                      b.bestRun === 1 ? 'day' : 'days'
                    }`}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    wrap: { alignSelf: 'stretch' },
    list: { gap: 12 },
    row: { gap: 7 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rank: {
      width: 20,
      height: 20,
      borderRadius: RADIUS.pill,
      backgroundColor: p.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rankLead: { backgroundColor: p.done },
    rankText: {
      fontSize: 10,
      fontFamily: FONT.bold,
      color: p.inkSoft,
      includeFontPadding: false,
    },
    rankTextLead: { color: p.onState },
    name: {
      flex: 1,
      fontSize: wrapSafe(13),
      fontFamily: FONT.semibold,
      color: p.ink,
    },
    pct: {
      fontSize: 14,
      fontFamily: FONT.bold,
      color: p.ink,
      includeFontPadding: false,
    },
    track: {
      height: 10,
      borderRadius: RADIUS.pill,
      backgroundColor: p.chip,
      overflow: 'hidden',
    },
    fill: { flex: 1, flexDirection: 'row', transformOrigin: 'left' },
    detail: { gap: 6, paddingTop: 2 },
    strip: { flexDirection: 'row', gap: 2 },
    dot: { flex: 1, height: 8, borderRadius: RADIUS.pill },
    dotDone: { backgroundColor: p.done },
    dotMissed: { backgroundColor: p.missed },
    dotBlank: { backgroundColor: p.chip },
    dotAhead: { borderWidth: 1, borderColor: p.line },
    dotToday: { borderWidth: 1.5, borderColor: p.accent },
    detailText: {
      fontSize: wrapSafe(11),
      fontFamily: FONT.regular,
      color: p.inkSoft,
    },
    ghost: { gap: 7, opacity: 0.6 },
    ghostName: { height: 10, borderRadius: 5, backgroundColor: p.chip },
  });
