import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { YearMonthSummary } from '../storage';
import { MONTH_ABBR, monthLength } from '../dates';
import { useTheme, FONT } from '../theme';

interface Props {
  year: number;
  /** merged per-month summaries — index 0 = January */
  months: YearMonthSummary[];
  /** month currently open in the planner; the chart auto-scrolls to it */
  focusMonth: number;
  /**
   * The real current date, not the browsed one — the chart shows a whole year
   * at a time, so it needs to know where today falls in it even when that is
   * some other year entirely.
   */
  now: { year: number; month: number; day: number };
  selected: { month: number; day: number };
  onSelectDate: (month: number, day: number) => void;
}

const WEEKDAY_SHORT = ['', 'M', '', 'W', '', 'F', ''];

const CELL = 13;
const GAP = 3;
const STEP = CELL + GAP;
const MONTH_ROW_H = 18;

export default function YearChart({
  year,
  months,
  focusMonth,
  now,
  selected,
  onSelectDate,
}: Props) {
  const { palette } = useTheme();
  const scrollRef = useRef<ScrollView>(null);

  const today = year === now.year ? { month: now.month, day: now.day } : null;

  /**
   * Days that haven't happened yet are dead to the touch.
   *
   * Only the real today can ever be marked, so tapping into the future would
   * page the planner to a month whose every row is locked — a dead end that
   * looks like the app broke rather than a rule being enforced.
   */
  const isFuture = (month: number, day: number) => {
    if (year !== now.year) return year > now.year;
    return month > now.month || (month === now.month && day > now.day);
  };

  // Calendar geometry for the whole year: GitHub layout, columns = weeks, rows = Sun..Sat
  const cal = useMemo(() => {
    const startOffset = new Date(year, 0, 1).getDay(); // 0 = Sunday
    const dates: { m: number; d: number }[] = [];
    const monthStartCol: number[] = [];
    for (let m = 0; m < 12; m++) {
      monthStartCol.push(Math.floor((startOffset + dates.length) / 7));
      const len = monthLength(year, m);
      for (let d = 1; d <= len; d++) dates.push({ m, d });
    }
    const weekCount = Math.ceil((startOffset + dates.length) / 7);
    return { startOffset, dates, monthStartCol, weekCount };
  }, [year]);

  useEffect(() => {
    const x = Math.max(0, cal.monthStartCol[focusMonth] * STEP - STEP);
    // let layout settle before scrolling to the open month
    const t = setTimeout(() => scrollRef.current?.scrollTo({ x, animated: true }), 60);
    return () => clearTimeout(t);
  }, [focusMonth, year, cal]);

  const totalDone = useMemo(
    () =>
      months.reduce(
        (sum, m) => sum + Object.values(m.tallies).reduce((s, t) => s + t.done, 0),
        0
      ),
    [months]
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { alignSelf: 'stretch' },
        body: { flexDirection: 'row' },
        weekdayCol: { width: 20, marginTop: MONTH_ROW_H },
        weekdayLabel: {
          height: STEP,
          fontSize: 9,
          fontFamily: FONT.semibold,
          color: palette.inkSoft,
          textAlignVertical: 'center',
        },
        monthRow: { height: MONTH_ROW_H },
        monthLabel: {
          position: 'absolute',
          top: 0,
          fontSize: 10,
          fontFamily: FONT.bold,
          color: palette.inkSoft,
        },
        monthLabelFocus: { color: palette.accent },
        week: { width: STEP },
        cell: {
          width: CELL,
          height: CELL,
          borderRadius: 3,
          marginBottom: GAP,
        },
        footer: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 8,
        },
        totalText: { fontSize: 11, fontFamily: FONT.regular, color: palette.inkSoft },
        totalNum: { color: palette.done, fontFamily: FONT.bold },
        legendRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
        legendText: {
          fontSize: 10,
          fontFamily: FONT.regular,
          color: palette.inkSoft,
          marginHorizontal: 3,
        },
        legendCell: { width: 10, height: 10, borderRadius: 2 },
      }),
    [palette]
  );

  const colorFor = (m: number, d: number): string => {
    const info = months[m];
    if (!info || info.habitCount === 0) return palette.ghLevels[0];
    const t = info.tallies[d];
    if (!t) return palette.ghLevels[0];
    if (t.done > 0) {
      const ratio = t.done / info.habitCount;
      const level = ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4;
      return palette.ghLevels[level];
    }
    if (t.missed > 0) return palette.ghMissed;
    return palette.ghLevels[0];
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.body}>
        <View style={styles.weekdayCol}>
          {WEEKDAY_SHORT.map((w, i) => (
            <Text key={i} style={styles.weekdayLabel}>
              {w}
            </Text>
          ))}
        </View>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          <View>
            <View style={[styles.monthRow, { width: cal.weekCount * STEP }]}>
              {MONTH_ABBR.map((name, m) => (
                <Text
                  key={m}
                  style={[
                    styles.monthLabel,
                    { left: cal.monthStartCol[m] * STEP },
                    m === focusMonth && styles.monthLabelFocus,
                  ]}
                >
                  {name}
                </Text>
              ))}
            </View>
            <View style={{ flexDirection: 'row' }}>
              {Array.from({ length: cal.weekCount }, (_, w) => (
                <View key={w} style={styles.week}>
                  {Array.from({ length: 7 }, (_, r) => {
                    const idx = w * 7 + r - cal.startOffset;
                    const date = cal.dates[idx];
                    if (!date) {
                      return <View key={r} style={[styles.cell, { backgroundColor: 'transparent' }]} />;
                    }
                    const isSelected = date.m === selected.month && date.d === selected.day;
                    const isToday = today !== null && date.m === today.month && date.d === today.day;
                    const future = isFuture(date.m, date.d);
                    return (
                      <Pressable
                        key={r}
                        hitSlop={1}
                        disabled={future}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: future, selected: isSelected }}
                        onPress={() => onSelectDate(date.m, date.d)}
                        style={[
                          styles.cell,
                          { backgroundColor: colorFor(date.m, date.d) },
                          // Deliberately not dimmed. An empty cell is already
                          // near-invisible against the dark card, so fading the
                          // rest of the year erases the grid's shape instead of
                          // reading as "not yet" — the days ahead just don't respond.
                          isToday && { borderWidth: 1.5, borderColor: palette.accent },
                          isSelected && { borderWidth: 1.5, borderColor: palette.ink },
                        ]}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
      <View style={styles.footer}>
        <Text style={styles.totalText}>
          <Text style={styles.totalNum}>{totalDone}</Text> check-ins in {year}
        </Text>
        <View style={styles.legendRow}>
          <Text style={styles.legendText}>less</Text>
          {palette.ghLevels.map((c, i) => (
            <View key={i} style={[styles.legendCell, { backgroundColor: c }]} />
          ))}
          <Text style={styles.legendText}>more</Text>
        </View>
      </View>
    </View>
  );
}
