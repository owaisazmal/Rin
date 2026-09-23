import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useRevealOnFocus } from './KeyboardSafeScroll';
import MarkButton from './MarkButton';
import SectionHeader from './SectionHeader';
import { CellState, Habit, MAX_HABITS, MAX_HABIT_NAME, cellKey } from '../types';
import { FONT, Palette, RADIUS, cardSurface, useTheme } from '../theme';

/**
 * The day's habits, and the habits themselves.
 *
 * Two modes in one card: checking (name, done, missed) is what the card shows
 * almost all the time, and editing (rename, remove, add) is a step away behind
 * EDIT. They are kept apart because a remove cross next to a missed cross reads
 * as two of the same thing.
 */

interface Props {
  day: number;
  daysInMonth: number;
  monthName: string;
  isToday: boolean;
  /** current day-of-month, or null when the open month isn't the current one */
  todayDay: number | null;
  habits: Habit[];
  grid: Record<string, CellState>;
  onSet: (day: number, habitId: string, state: CellState) => void;
  onShiftDay: (delta: number) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

function PlusGlyph({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24">
      <Path
        d="M12 5.5v13M5.5 12h13"
        stroke={color}
        strokeWidth={2.6}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

function CloseGlyph({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24">
      <Path
        d="M7 7 L17 17 M17 7 L7 17"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

const modeAnimation = LayoutAnimation.create(180, 'easeInEaseOut', 'opacity');

export default function DailyCheck({
  day,
  daysInMonth,
  monthName,
  isToday,
  todayDay,
  habits,
  grid,
  onSet,
  onShiftDay,
  onAdd,
  onRename,
  onRemove,
}: Props) {
  const { palette } = useTheme();
  const revealOnFocus = useRevealOnFocus();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const [editing, setEditing] = useState(false);
  const inputs = useRef(new Map<string, TextInput>());
  const focusNew = useRef(false);
  const seen = useRef(new Set(habits.map((h) => h.id)));

  // a habit added from here opens for naming straight away
  useEffect(() => {
    const added = habits.find((h) => !seen.current.has(h.id));
    seen.current = new Set(habits.map((h) => h.id));
    if (!added || !focusNew.current) return;
    focusNew.current = false;
    requestAnimationFrame(() => inputs.current.get(added.id)?.focus());
  }, [habits]);

  const add = useCallback(() => {
    focusNew.current = true;
    setEditing(true);
    onAdd();
  }, [onAdd]);

  const toggleEditing = useCallback(() => {
    LayoutAnimation.configureNext(modeAnimation);
    if (editing) Keyboard.dismiss();
    setEditing(!editing);
  }, [editing]);

  const atLimit = habits.length >= MAX_HABITS;
  const canPrev = day > 1;
  const canNext = day < daysInMonth;

  return (
    <View style={styles.card}>
      <SectionHeader
        title="DAILY CHECK"
        right={
          <View style={styles.dayNav}>
            <Pressable
              hitSlop={8}
              disabled={!canPrev}
              accessibilityRole="button"
              accessibilityLabel="Previous day"
              onPress={() => onShiftDay(-1)}
              style={({ pressed }) => [
                styles.navBtn,
                (pressed || !canPrev) && { opacity: canPrev ? 0.6 : 0.35 },
              ]}
            >
              <Text style={styles.navArrow}>‹</Text>
            </Pressable>
            <View>
              <Text style={styles.dayLabel}>
                {monthName.slice(0, 3)} {day}
              </Text>
              {isToday && <Text style={styles.todayBadge}>TODAY</Text>}
            </View>
            <Pressable
              hitSlop={8}
              disabled={!canNext}
              accessibilityRole="button"
              accessibilityLabel="Next day"
              onPress={() => onShiftDay(1)}
              style={({ pressed }) => [
                styles.navBtn,
                (pressed || !canNext) && { opacity: canNext ? 0.6 : 0.35 },
              ]}
            >
              <Text style={styles.navArrow}>›</Text>
            </Pressable>
          </View>
        }
      />

      {habits.length === 0 ? (
        <Text style={styles.empty}>No habits yet — add one to start checking it off.</Text>
      ) : editing ? (
        <View style={styles.editList}>
          {habits.map((h, i) => (
            <View key={h.id} style={styles.editRow}>
              <Text style={styles.num}>{i + 1}</Text>
              <TextInput
                ref={(el) => {
                  if (el) inputs.current.set(h.id, el);
                  else inputs.current.delete(h.id);
                }}
                style={styles.input}
                value={h.name}
                maxLength={MAX_HABIT_NAME}
                onChangeText={(t) => onRename(h.id, t.slice(0, MAX_HABIT_NAME))}
                placeholder="habit name…"
                placeholderTextColor={palette.inkSoft}
                autoCapitalize="sentences"
                // the page scrolls this line clear of the keyboard — see KeyboardSafeScroll
                onFocus={revealOnFocus}
                returnKeyType="done"
              />
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${h.name || 'habit'}`}
                onPress={() => onRemove(h.id)}
                style={({ pressed }) => [styles.remove, pressed && { opacity: 0.5 }]}
              >
                <CloseGlyph color={palette.inkSoft} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <>
          {!isToday && (
            <Text style={styles.locked}>
              {day < (todayDay ?? 0) || todayDay === null
                ? 'Past days are locked — only today can be marked.'
                : "You can't mark a day before it arrives."}
            </Text>
          )}
          {habits.map((h) => {
            const state = grid[cellKey(day, h.id)] ?? 0;
            return (
              <View key={h.id} style={styles.habitRow}>
                <Text style={styles.habitName} numberOfLines={1}>
                  {h.name || 'Unnamed habit'}
                </Text>
                <MarkButton
                  kind="done"
                  active={state === 1}
                  disabled={!isToday}
                  palette={palette}
                  onPress={() => onSet(day, h.id, state === 1 ? 0 : 1)}
                />
                <MarkButton
                  kind="missed"
                  active={state === 2}
                  disabled={!isToday}
                  palette={palette}
                  onPress={() => onSet(day, h.id, state === 2 ? 0 : 2)}
                />
              </View>
            );
          })}
        </>
      )}

      <View style={styles.footer}>
        {atLimit ? (
          <Text style={styles.limit}>Maximum of {MAX_HABITS} habits reached.</Text>
        ) : (
          <Pressable
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Add habit"
            onPress={add}
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.7 }]}
          >
            <PlusGlyph color={palette.accent} />
            <Text style={styles.addText}>Add habit</Text>
          </Pressable>
        )}
        {(habits.length > 0 || editing) && (
          <View style={styles.footerRight}>
            <Text style={styles.count}>
              {habits.length}/{MAX_HABITS}
            </Text>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Finish editing habits' : 'Edit habits'}
              onPress={toggleEditing}
              style={({ pressed }) => [
                styles.toggle,
                editing && styles.toggleActive,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.toggleText, editing && styles.toggleTextActive]}>
                {editing ? 'DONE' : 'EDIT'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    card: {
      ...cardSurface(p),
      padding: 18,
    },
    dayNav: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    navBtn: {
      width: 28,
      height: 28,
      borderRadius: RADIUS.pill,
      backgroundColor: p.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navArrow: {
      fontSize: 16,
      fontFamily: FONT.bold,
      color: p.ink,
      lineHeight: 19,
    },
    dayLabel: {
      fontSize: 13,
      fontFamily: FONT.bold,
      color: p.ink,
      minWidth: 58,
      textAlign: 'center',
    },
    todayBadge: {
      fontSize: 9,
      fontFamily: FONT.bold,
      color: p.accent,
      letterSpacing: 1,
      textAlign: 'center',
    },
    empty: {
      fontSize: 13,
      lineHeight: 19,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      paddingVertical: 4,
    },
    locked: {
      fontSize: 11,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      paddingBottom: 8,
    },
    habitRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      borderTopWidth: 1,
      borderTopColor: p.lineFaint,
    },
    habitName: {
      flex: 1,
      fontSize: 14,
      fontFamily: FONT.medium,
      color: p.ink,
    },
    editList: {
      gap: 8,
    },
    /** each name is its own raised field, so the mode reads at a glance */
    editRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: p.chip,
      borderRadius: RADIUS.control,
      paddingLeft: 12,
      paddingRight: 6,
    },
    num: {
      width: 22,
      fontSize: 11,
      fontFamily: FONT.bold,
      color: p.inkSoft,
    },
    input: {
      flex: 1,
      paddingVertical: 11,
      fontSize: 14,
      fontFamily: FONT.medium,
      color: p.ink,
    },
    remove: {
      width: 30,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: p.lineFaint,
      minHeight: 46,
    },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: p.accentSoft,
      borderRadius: RADIUS.control,
      paddingVertical: 8,
      paddingLeft: 12,
      paddingRight: 14,
    },
    addText: {
      fontSize: 13,
      fontFamily: FONT.bold,
      color: p.accent,
    },
    limit: {
      fontSize: 12,
      fontFamily: FONT.regular,
      color: p.inkSoft,
    },
    footerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    count: {
      fontSize: 11,
      fontFamily: FONT.bold,
      color: p.inkSoft,
    },
    toggle: {
      borderRadius: RADIUS.chip,
      borderWidth: 1,
      borderColor: p.lineFaint,
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    toggleActive: {
      backgroundColor: p.accent,
      borderColor: p.accent,
    },
    toggleText: {
      fontSize: 10,
      fontFamily: FONT.bold,
      letterSpacing: 1.2,
      color: p.accent,
    },
    toggleTextActive: {
      color: p.onAccent,
    },
  });
