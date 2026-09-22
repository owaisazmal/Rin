import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MONTH_ABBR } from '../dates';
import { YearBlock, YearSpan, YearSpanStats, blockShape, columnDays } from '../yearGrid';
import { FONT, Palette, RADIUS, cardSurface, useTheme } from '../theme';

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
  /**
   * The real current date, not the browsed one — the grid shows a whole year
   * at a time, so it needs to know where today falls in it even when that is
   * some other year entirely.
   */
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
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const scrollRef = useRef<ScrollView>(null);
  const [picking, setPicking] = useState(false);
  const [legend, setLegend] = useState(false);

  const shapes = useMemo(
    () => blocks.map((b) => blockShape(b.year, b.month, STEP, GAP, MONTH_GAP)),
    [blocks]
  );

  /**
   * Days that haven't happened yet are dead to the touch.
   *
   * Only the real today can ever be marked, so tapping into the future would
   * page the planner to a month whose every row is locked — a dead end that
   * looks like the app broke rather than a rule being enforced.
   */
  const isFuture = (year: number, month: number, day: number) =>
    year > now.year ||
    (year === now.year && (month > now.month || (month === now.month && day > now.day)));

  /**
   * Where the open month's block starts, so the grid can scroll to it — and 0
   * when the span doesn't hold it at all, which is what picking a past year
   * from the chip does. A year being reviewed rather than written in has no
   * month to land on, so it opens at its first one.
   */
  const focusX = useMemo(() => {
    const index = blocks.findIndex((b) => b.year === focus.year && b.month === focus.month);
    if (index < 0) return 0;
    let x = 0;
    for (let i = 0; i < index; i++) x += shapes[i].advance;
    return Math.max(0, x - SCROLL_LEAD);
  }, [blocks, shapes, focus.year, focus.month]);

  /**
   * Both halves of this are load-bearing, and for different platforms.
   *
   * iOS clamps a programmatic offset to the content size it knows about, and
   * before the first layout that is zero — so a scroll issued from an effect
   * on mount is silently dropped, and only the content-size callback ever
   * lands. Android replays a pending offset at layout instead, un-animated,
   * so the same call arrives there as a jump. Re-anchoring on a content-size
   * *change* rather than on every callback is what keeps the second one from
   * yanking the grid back while somebody is scrolling it by hand.
   */
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
    const tally = tallies[day];
    if (!tally || habitCount === 0) return palette.ghLevels[0];
    if (tally.done > 0) {
      const ratio = tally.done / habitCount;
      const level = ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4;
      return palette.ghLevels[level];
    }
    if (tally.missed > 0) return palette.ghMissed;
    return palette.ghLevels[0];
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
          <Text style={styles.headlineText} numberOfLines={1}>
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
            <Text style={[styles.infoGlyph, legend && styles.infoGlyphOn]}>i</Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Showing ${spanLabel}. Change the year shown.`}
          onPress={() => setPicking(true)}
          style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.chipText}>{spanLabel}</Text>
          {/* drawn rather than typed: no caret glyph in Josefin, and a fallback
              one lands at a different height on each platform */}
          <View style={styles.caret} />
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <Text style={styles.stat}>
          Active days: <Text style={styles.statNum}>{stats.activeDays}</Text>
        </Text>
        <Text style={styles.statDot}>·</Text>
        <Text style={styles.stat}>
          Max streak: <Text style={styles.statNum}>{stats.maxStreak}</Text>
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        // the grid sits inside the planner's scroll view; without this the
        // first tap on a cell with the keyboard up is eaten as a dismiss
        keyboardShouldPersistTaps="always"
        // Android's stretch at either end spins up a layer over a grid that is
        // nothing but small squares, and the rubber band reads as a glitch
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
                  // the days this column holds, after the lead-in that the 1st
                  // starts partway down — that lead is padding, not cells, so
                  // a year is 365 views instead of the 430-odd a padded grid
                  // would mount on the platform that can least afford them
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
                              // Deliberately not dimmed. An empty cell is
                              // already near-invisible against the dark card,
                              // so fading the rest of the year erases the
                              // grid's shape instead of reading as "not yet" —
                              // the days ahead just don't respond.
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
        <View
          style={styles.legend}
          accessible
          accessibilityLabel="Colour key: the greens run from one habit kept to all of them; red is a day marked missed."
        >
          <Text style={styles.legendText}>less</Text>
          {palette.ghLevels.map((c, i) => (
            <View key={i} style={[styles.legendCell, { backgroundColor: c }]} />
          ))}
          <Text style={styles.legendText}>more</Text>
          <View style={[styles.legendCell, styles.legendMissed]} />
          <Text style={styles.legendText}>missed</Text>
        </View>
      ) : null}

      {/*
        A Modal, not an overlay drawn in place. The planner's back handler
        hands an unclaimed Android back press to the system, which closes the
        app — and a panel this tall would hang outside the planner's scroll
        view, where Android draws it but won't route a touch to it.
      */}
      <Modal
        visible={picking}
        transparent
        animationType="fade"
        onRequestClose={() => setPicking(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setPicking(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>SHOW</Text>
            <ScrollView
              style={styles.sheetList}
              showsVerticalScrollIndicator={false}
              overScrollMode="never"
            >
              {options.map((option) => {
                // the same word the chip shows, so the menu never renames what it is
                // already displaying
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
                    <Text style={[styles.optionText, on && styles.optionTextOn]}>{label}</Text>
                    {on ? <Text style={styles.optionTick}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
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
    // Josefin sets a tall, top-heavy line box; without the explicit height and
    // the padding off, Android drops the glyph a couple of points and the dot
    // over the i clips against the circle
    infoGlyph: {
      fontSize: 9,
      lineHeight: 13,
      fontFamily: FONT.bold,
      color: p.inkSoft,
      includeFontPadding: false,
    },
    infoGlyphOn: { color: p.accent },

    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingLeft: 10,
      paddingRight: 9,
      paddingVertical: 6,
      borderRadius: RADIUS.chip,
      backgroundColor: p.chip,
      borderWidth: 1,
      borderColor: p.lineFaint,
    },
    chipText: {
      fontSize: 12,
      fontFamily: FONT.semibold,
      color: p.ink,
      includeFontPadding: false,
    },
    caret: {
      width: 6,
      height: 6,
      borderRightWidth: 1.5,
      borderBottomWidth: 1.5,
      borderColor: p.inkSoft,
      transform: [{ rotate: '45deg' }, { translateY: -1 }],
    },

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
    // the same treatment as the labels either side of it: left to the system
    // font it sits a couple of points lower on Android than on iOS
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
    // in normal flow under the block and sized to it, so centring is arithmetic
    // rather than text measurement — the one way it lands identically on both
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

    legend: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      marginTop: 10,
    },
    legendText: {
      fontSize: 10,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      marginHorizontal: 3,
      includeFontPadding: false,
    },
    legendCell: { width: 10, height: 10, borderRadius: 2 },
    legendMissed: { backgroundColor: p.ghMissed, marginLeft: 6 },

    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 22,
    },
    sheet: {
      // the same surface the due-date sheet uses, shadow and all — and for the
      // reason given there: it floats over a dimmed page rather than over the
      // aurora, so it takes the solid background, not the translucent card
      ...cardSurface(p),
      backgroundColor: p.bg,
      width: '100%',
      maxWidth: 260,
      padding: 16,
    },
    sheetTitle: {
      fontSize: 13,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
      marginBottom: 10,
    },
    // capped so a phone that has been kept for years can't push the list off
    // the bottom of the screen
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
