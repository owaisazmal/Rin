import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { MONTH_ABBR } from '../dates';
import { YearBlock, YearSpan, YearSpanStats, blockShape, columnDays } from '../yearGrid';
import { heatLevel } from '../trackerCharts';
import { FONT, Palette, RADIUS, SCALE, useTheme } from '../theme';
import ChartLegend from './ChartLegend';
import { PickerChip, PickerSheet } from './Picker';

const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;
/** seven rows of cells, with no gap hanging off the bottom */
const GRID_H = 7 * STEP - GAP;
/** clear air between one month block and the next */
const MONTH_GAP = 12;
/** a little of the previous month left showing when the grid scrolls itself */
const SCROLL_LEAD = 10;

interface Props {
  /** the twelve months to draw, oldest first */
  blocks: YearBlock[];
  span: YearSpan;
  onSetSpan: (span: YearSpan) => void;
  /** calendar years the picker offers, newest first */
  years: number[];
  stats: YearSpanStats;
  /** month currently open in the planner; the grid scrolls itself to it */
  focus: { year: number; month: number };
  /** the real current date, not the browsed one */
  now: { year: number; month: number; day: number };
  selected: { year: number; month: number; day: number };
  onSelectDate: (year: number, month: number, day: number) => void;
}

export default function YearChart({
  blocks,
  span,
  onSetSpan,
  years,
  stats,
  focus,
  now,
  selected,
  onSelectDate,
}: Props) {
  const { palette } = useTheme();
  const { fontScale } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const scrollRef = useRef<ScrollView>(null);
  const [picking, setPicking] = useState(false);
  const [legend, setLegend] = useState(false);

  const shapes = useMemo(
    () => blocks.map((b) => blockShape(b.year, b.month, STEP, GAP, MONTH_GAP)),
    [blocks]
  );

  // future days don't respond: they would page the planner to a locked month
  const isFuture = (year: number, month: number, day: number) =>
    year > now.year ||
    (year === now.year && (month > now.month || (month === now.month && day > now.day)));

  // where the open month's block starts, or 0 when the span doesn't hold it
  const focusX = useMemo(() => {
    const index = blocks.findIndex((b) => b.year === focus.year && b.month === focus.month);
    if (index < 0) return 0;
    let x = 0;
    for (let i = 0; i < index; i++) x += shapes[i].advance;
    return Math.max(0, x - SCROLL_LEAD);
  }, [blocks, shapes, focus.year, focus.month]);

  // iOS drops a scroll issued before layout, so it is re-issued when the content width changes
  const wantX = useRef(0);
  const lastWidth = useRef(0);

  const spanKey = span.kind === 'rolling' ? 'rolling' : `y${span.year}`;
  useEffect(() => {
    wantX.current = focusX;
    scrollRef.current?.scrollTo({ x: focusX, animated: true });
  }, [focusX, spanKey]);

  const totalLabel =
    span.kind === 'rolling' ? 'check-ins in the past year' : `check-ins in ${span.year}`;
  const spanLabel = span.kind === 'rolling' ? 'Current' : String(span.year);

  const options = useMemo<YearSpan[]>(
    () => [{ kind: 'rolling' }, ...years.map((year) => ({ kind: 'calendar' as const, year }))],
    [years]
  );

  const colorFor = (block: YearBlock, day: number): string => {
    const { habitCount, tallies } = block.summary;
    const level = heatLevel(tallies[day]?.done ?? 0, tallies[day]?.missed ?? 0, habitCount);
    return level === 'missed' ? palette.ghMissed : palette.ghLevels[level];
  };

  const labelFor = (block: YearBlock, day: number): string => {
    const date = `${MONTH_ABBR[block.month]} ${day}, ${block.year}`;
    const { habitCount, tallies } = block.summary;
    const tally = tallies[day];
    if (!tally || habitCount === 0) return `${date}, nothing marked`;
    if (tally.done > 0) return `${date}, ${tally.done} of ${habitCount} done`;
    if (tally.missed > 0) return `${date}, ${tally.missed} missed`;
    return `${date}, nothing marked`;
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <View style={styles.headline}>
          <Text
            style={styles.headlineText}
            maxFontSizeMultiplier={SCALE.heading}
            numberOfLines={fontScale > 1 ? 2 : 1}
          >
            <Text style={styles.headlineNum}>{stats.total}</Text> {totalLabel}
          </Text>
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={legend ? 'Hide the colour key' : 'What the colours mean'}
            accessibilityState={{ expanded: legend }}
            onPress={() => setLegend((on) => !on)}
            style={({ pressed }) => [
              styles.info,
              legend && styles.infoOn,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text
              style={[styles.infoGlyph, legend && styles.infoGlyphOn]}
              maxFontSizeMultiplier={SCALE.glyph}
            >
              i
            </Text>
          </Pressable>
        </View>
        <PickerChip
          label={spanLabel}
          accessibilityLabel={`Showing ${spanLabel}. Change the year shown.`}
          onPress={() => setPicking(true)}
        />
      </View>

      <View style={styles.statsRow}>
        <Text style={styles.stat} maxFontSizeMultiplier={SCALE.heading}>
          Active days: <Text style={styles.statNum}>{stats.activeDays}</Text>
        </Text>
        <Text style={styles.statDot} maxFontSizeMultiplier={SCALE.heading}>
          ·
        </Text>
        <Text style={styles.stat} maxFontSizeMultiplier={SCALE.heading}>
          Max streak: <Text style={styles.statNum}>{stats.maxStreak}</Text>
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        // or the first tap with the keyboard up is eaten as a dismiss
        keyboardShouldPersistTaps="always"
        // Android's stretch over a grid of small squares reads as a glitch
        overScrollMode="never"
        onContentSizeChange={(width) => {
          if (width === lastWidth.current) return;
          lastWidth.current = width;
          scrollRef.current?.scrollTo({ x: wantX.current, animated: false });
        }}
        contentContainerStyle={styles.grid}
      >
        {blocks.map((block, i) => {
          const shape = shapes[i];
          return (
            <View key={`${block.year}-${block.month}`} style={styles.block}>
              <View style={styles.columns}>
                {Array.from({ length: shape.columns }, (_, column) => {
                  // the lead-in before the 1st is padding, not cells, to keep the view count down
                  const { first, last } = columnDays(shape, column);
                  const rows = Array.from({ length: last - first + 1 }, (_, k) => first + k);
                  return (
                    <View
                      key={column}
                      style={[styles.column, column === 0 && { paddingTop: shape.lead * STEP }]}
                    >
                      {rows.map((day) => {
                        const isSelected =
                          block.year === selected.year &&
                          block.month === selected.month &&
                          day === selected.day;
                        const isToday =
                          block.year === now.year &&
                          block.month === now.month &&
                          day === now.day;
                        const future = isFuture(block.year, block.month, day);
                        return (
                          <Pressable
                            key={day}
                            hitSlop={1}
                            disabled={future}
                            android_disableSound
                            accessibilityRole="button"
                            accessibilityLabel={labelFor(block, day)}
                            accessibilityState={{ disabled: future, selected: isSelected }}
                            onPress={() => onSelectDate(block.year, block.month, day)}
                            style={[
                              styles.cell,
                              { backgroundColor: colorFor(block, day) },
                              // future days aren't dimmed: that would erase the grid's shape
                              isToday && { borderWidth: 1.5, borderColor: palette.accent },
                              isSelected && { borderWidth: 1.5, borderColor: palette.ink },
                            ]}
                          />
                        );
                      })}
                    </View>
                  );
                })}
              </View>
              <Text
                maxFontSizeMultiplier={SCALE.heading}
                style={[
                  styles.monthLabel,
                  { width: shape.width },
                  block.year === focus.year && block.month === focus.month && styles.monthLabelOn,
                ]}
              >
                {MONTH_ABBR[block.month]}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      {legend ? (
        <ChartLegend
          heat
          accessibilityLabel="Colour key: the greens run from one habit kept to all of them; red is a day marked missed."
        />
      ) : null}

      <PickerSheet visible={picking} title="SHOW" onClose={() => setPicking(false)}>
        <ScrollView
          style={styles.sheetList}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
        >
          {options.map((option) => {
            // the chip's own word, so the menu never renames what it shows
            const label = option.kind === 'rolling' ? 'Current' : String(option.year);
            const on =
              option.kind === 'rolling'
                ? span.kind === 'rolling'
                : span.kind === 'calendar' && span.year === option.year;
            return (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  onSetSpan(option);
                  setPicking(false);
                }}
                style={({ pressed }) => [
                  styles.option,
                  on && styles.optionOn,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text
                  style={[styles.optionText, on && styles.optionTextOn]}
                  maxFontSizeMultiplier={SCALE.heading}
                >
                  {label}
                </Text>
                {on ? (
                  <Text style={styles.optionTick} maxFontSizeMultiplier={SCALE.heading}>
                    ✓
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </PickerSheet>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    // the tracker card centres its slot, so the grid has to claim the width
    wrap: { alignSelf: 'stretch' },

    headRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    headline: {
      flexShrink: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    headlineText: {
      flexShrink: 1,
      fontSize: 12,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      includeFontPadding: false,
    },
    headlineNum: {
      fontSize: 15,
      fontFamily: FONT.bold,
      color: p.ink,
    },
    info: {
      width: 15,
      height: 15,
      borderRadius: RADIUS.pill,
      borderWidth: 1,
      borderColor: p.inkSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    infoOn: {
      borderColor: p.accent,
      backgroundColor: p.accentSoft,
    },
    // a set line height, or Josefin's tall line box clips the i's dot on Android
    infoGlyph: {
      fontSize: 9,
      lineHeight: 13,
      fontFamily: FONT.bold,
      color: p.inkSoft,
      includeFontPadding: false,
    },
    infoGlyphOn: { color: p.accent },

    statsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
      marginBottom: 12,
    },
    stat: {
      fontSize: 11,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      includeFontPadding: false,
    },
    statNum: { fontFamily: FONT.bold, color: p.ink },
    // styled like its neighbours, or it sits lower on Android
    statDot: {
      fontSize: 11,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      includeFontPadding: false,
    },

    grid: { flexDirection: 'row', paddingRight: 2 },
    block: { marginRight: MONTH_GAP },
    columns: { flexDirection: 'row', height: GRID_H },
    column: { width: CELL, marginRight: GAP },
    cell: {
      width: CELL,
      height: CELL,
      borderRadius: 3,
      marginBottom: GAP,
    },
    // sized to the block, so it centres the same on both platforms
    monthLabel: {
      marginTop: 7,
      textAlign: 'center',
      fontSize: 11,
      lineHeight: 13,
      fontFamily: FONT.bold,
      color: p.inkSoft,
      includeFontPadding: false,
    },
    monthLabelOn: { color: p.accent },

    // capped, so many years of data can't push the list off screen
    sheetList: { maxHeight: 260 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 40,
      paddingHorizontal: 12,
      borderRadius: RADIUS.control,
    },
    optionOn: { backgroundColor: p.accentSoft },
    optionText: {
      fontSize: 14,
      fontFamily: FONT.medium,
      color: p.ink,
      includeFontPadding: false,
    },
    optionTextOn: { fontFamily: FONT.bold, color: p.accent },
    optionTick: {
      fontSize: 13,
      fontFamily: FONT.bold,
      color: p.accent,
      includeFontPadding: false,
      // the tick comes from the system font, which sets it a shade low
      ...Platform.select({ android: { marginTop: -1 }, default: {} }),
    },
  });
