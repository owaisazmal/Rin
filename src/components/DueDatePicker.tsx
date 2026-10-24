import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import SegmentedControl from './SegmentedControl';
import { Sheet, SheetActions, TimeSteppers } from './Sheet';
import { MONTH_NAMES, monthLength, startOfDay } from '../dates';
import { clampNote } from '../recurring';
import type { RepeatEvery } from '../tasks';
import { FONT, Palette, RADIUS, useTheme } from '../theme';

/** Picking the moment a task is due; drawn, since the platform pickers can't take the app's fonts and colours */

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

type RepeatChoice = RepeatEvery | 'never';

const REPEAT_OPTIONS: { value: RepeatChoice; label: string }[] = [
  { value: 'never', label: 'NEVER' },
  { value: 'week', label: 'WEEKLY' },
  { value: 'month', label: 'MONTHLY' },
  { value: 'year', label: 'YEARLY' },
];

interface Props {
  visible: boolean;
  /** the deadline being edited, epoch ms */
  value: number;
  /** how often it comes back, or null for a one-off */
  repeat: RepeatEvery | null;
  onCancel: () => void;
  onConfirm: (due: number, repeat: RepeatEvery | null) => void;
}

/** Monday-first weeks, padded with nulls so every row has seven cells */
function monthCells(year: number, month: number): (number | null)[] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const len = monthLength(year, month);
  const cells: (number | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= len; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function DueDatePicker({ visible, value, repeat, onCancel, onConfirm }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const [picked, setPicked] = useState(() => new Date(value));
  const [cursor, setCursor] = useState(() => ({
    year: new Date(value).getFullYear(),
    month: new Date(value).getMonth(),
  }));
  const [every, setEvery] = useState<RepeatChoice>(repeat ?? 'never');
  const [todayStart, setTodayStart] = useState(() => startOfDay(Date.now()));

  // adopt the task's deadline on opening only, so it never fights the picking
  useEffect(() => {
    if (!visible) return;
    const d = new Date(value);
    setPicked(d);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
    setEvery(repeat ?? 'never');
    setTodayStart(startOfDay(Date.now()));
  }, [visible, value, repeat]);

  const cells = useMemo(() => monthCells(cursor.year, cursor.month), [cursor]);

  const shiftMonth = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  const pickDay = (day: number) => {
    const next = new Date(picked);
    next.setFullYear(cursor.year, cursor.month, day);
    setPicked(next);
  };

  // wraps within the chosen day, so the time never moves the date the grid shows
  const setTime = (minutes: number) => {
    const next = new Date(picked);
    next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    setPicked(next);
  };

  const sameDay =
    picked.getFullYear() === cursor.year && picked.getMonth() === cursor.month;

  const monthArrow = (delta: -1 | 1) => (
    <Pressable
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={delta < 0 ? 'Previous month' : 'Next month'}
      onPress={() => shiftMonth(delta)}
      style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.navArrow}>{delta < 0 ? '‹' : '›'}</Text>
    </Pressable>
  );

  return (
    <Sheet visible={visible} onClose={onCancel}>
      <Text style={styles.title}>DUE</Text>

      <View style={styles.monthNav}>
        {monthArrow(-1)}
        <Text style={styles.monthLabel}>
          {MONTH_NAMES[cursor.month]} {cursor.year}
        </Text>
        {monthArrow(1)}
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={i} style={styles.cell} />;
          const selected = sameDay && day === picked.getDate();
          const past = new Date(cursor.year, cursor.month, day).getTime() < todayStart;
          return (
            <Pressable
              key={i}
              onPress={() => pickDay(day)}
              style={({ pressed }) => [styles.cell, pressed && { opacity: 0.6 }]}
            >
              {/* keyed so Android redraws it: rounding added to a drawn view came out square */}
              <View key={selected ? 'on' : 'off'} style={[styles.dayDot, selected && styles.dayDotOn]}>
                <Text
                  style={[
                    styles.dayText,
                    past && styles.dayTextPast,
                    selected && styles.dayTextOn,
                  ]}
                >
                  {day}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.timeRow}>
        <Text style={styles.timeLabel}>TIME</Text>
        <TimeSteppers
          minutes={picked.getHours() * 60 + picked.getMinutes()}
          onChange={setTime}
        />
      </View>

      <Text style={styles.repeatLabel}>REPEAT</Text>
      <SegmentedControl options={REPEAT_OPTIONS} value={every} onChange={setEvery} />
      <Text style={styles.repeatNote}>
        {(every !== 'never' && clampNote(every, picked.getTime())) || ' '}
      </Text>

      <SheetActions
        onCancel={onCancel}
        confirmLabel="SET"
        onConfirm={() => onConfirm(picked.getTime(), every === 'never' ? null : every)}
      />
    </Sheet>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    title: {
      fontSize: 13,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
      marginBottom: 14,
    },
    monthNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    navBtn: {
      width: 32,
      height: 32,
      borderRadius: RADIUS.pill,
      backgroundColor: p.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navArrow: {
      fontSize: 18,
      fontFamily: FONT.bold,
      color: p.ink,
      lineHeight: 21,
    },
    monthLabel: {
      fontSize: 14,
      fontFamily: FONT.bold,
      letterSpacing: 1.5,
      color: p.ink,
    },
    weekRow: {
      flexDirection: 'row',
      marginBottom: 4,
    },
    weekday: {
      flex: 1,
      textAlign: 'center',
      fontSize: 10,
      fontFamily: FONT.bold,
      letterSpacing: 1,
      color: p.inkSoft,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cell: {
      width: `${100 / 7}%`,
      aspectRatio: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayDot: {
      width: 32,
      height: 32,
      borderRadius: RADIUS.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayDotOn: {
      backgroundColor: p.accent,
    },
    dayText: {
      fontSize: 13,
      fontFamily: FONT.medium,
      color: p.ink,
    },
    /** a deadline can be back-dated, but the days behind you shouldn't invite it */
    dayTextPast: {
      color: p.inkSoft,
      opacity: 0.5,
    },
    dayTextOn: {
      color: p.onAccent,
      fontFamily: FONT.bold,
      opacity: 1,
    },
    timeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 14,
      marginBottom: 14,
    },
    repeatLabel: {
      fontSize: 10,
      fontFamily: FONT.bold,
      letterSpacing: 1.5,
      color: p.inkSoft,
      marginBottom: 8,
    },
    /** always one line tall, so the sheet doesn't jump when a hint appears */
    repeatNote: {
      fontSize: 11,
      lineHeight: 15,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      marginTop: 6,
      marginBottom: 12,
    },
    timeLabel: {
      flex: 1,
      fontSize: 10,
      fontFamily: FONT.bold,
      letterSpacing: 1.5,
      color: p.inkSoft,
    },
  });
