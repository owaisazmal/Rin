import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { CloseGlyph, PlusGlyph } from './Glyphs';
import { useRevealOnFocus } from './KeyboardSafeScroll';
import MarkButton from './MarkButton';
import SectionHeader from './SectionHeader';
import { CellState, Habit, MAX_HABITS, MAX_HABIT_NAME, cellKey } from '../types';
import { DayWhen } from '../marking';
import { FONT, Palette, RADIUS, SCALE, cardSurface, useTheme, wrapSafe } from '../theme';

/** The day's habits to check off, with editing (rename, remove, add) behind EDIT. */

interface Props {
  day: number;
  daysInMonth: number;
  monthName: string;
  when: DayWhen;
  /** whether this habit can be marked on this day, by the rule in marking.ts */
  canMark: (habitId: string) => boolean;
  habits: Habit[];
  grid: Record<string, CellState>;
  onSet: (day: number, habitId: string, state: CellState) => void;
  onShiftDay: (delta: number) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

const modeAnimation = LayoutAnimation.create(180, 'easeInEaseOut', 'opacity');

export default function DailyCheck({
  day,
  daysInMonth,
  monthName,
  when,
  canMark,
  habits,
  grid,
  onSet,
  onShiftDay,
  onAdd,
  onRename,
  onRemove,
}: Props) {
  const { palette } = useTheme();
  const { fontScale } = useWindowDimensions();
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

  const add = () => {
    focusNew.current = true;
    setEditing(true);
    onAdd();
  };

  const toggleEditing = () => {
    LayoutAnimation.configureNext(modeAnimation);
    if (editing) Keyboard.dismiss();
    setEditing(!editing);
  };

  const atLimit = habits.length >= MAX_HABITS;

  const dayArrow = (delta: -1 | 1) => {
    const can = delta < 0 ? day > 1 : day < daysInMonth;
    return (
      <Pressable
        hitSlop={8}
        disabled={!can}
        accessibilityRole="button"
        accessibilityLabel={delta < 0 ? 'Previous day' : 'Next day'}
        onPress={() => onShiftDay(delta)}
        style={({ pressed }) => [styles.navBtn, (pressed || !can) && { opacity: can ? 0.6 : 0.35 }]}
      >
        <Text style={styles.navArrow} maxFontSizeMultiplier={SCALE.glyph}>
          {delta < 0 ? '‹' : '›'}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.card}>
      <SectionHeader
        title="DAILY CHECK"
        right={
          <View style={styles.dayNav}>
            {dayArrow(-1)}
            <View>
              <Text style={styles.dayLabel} maxFontSizeMultiplier={SCALE.figure}>
                {monthName.slice(0, 3)} {day}
              </Text>
              {when === 'today' && (
                <Text style={styles.todayBadge} maxFontSizeMultiplier={SCALE.figure}>
                  TODAY
                </Text>
              )}
            </View>
            {dayArrow(1)}
          </View>
        }
      />

      {habits.length === 0 ? (
        <Text style={styles.empty}>No habits yet. Add one to start checking it off.</Text>
      ) : editing ? (
        <View style={styles.editList}>
          {habits.map((h, i) => (
            <View key={h.id} style={styles.editRow}>
              <Text style={styles.num} maxFontSizeMultiplier={SCALE.figure}>
                {i + 1}
              </Text>
              <TextInput
                ref={(el) => {
                  if (el) inputs.current.set(h.id, el);
                  else inputs.current.delete(h.id);
                }}
                style={styles.input}
                maxFontSizeMultiplier={SCALE.row}
                value={h.name}
                maxLength={MAX_HABIT_NAME}
                onChangeText={(t) => onRename(h.id, t.slice(0, MAX_HABIT_NAME))}
                placeholder="habit name…"
                placeholderTextColor={palette.inkSoft}
                autoCapitalize="sentences"
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
          {when !== 'today' && (
            <Text style={styles.locked}>
              {when === 'future'
                ? "You can't mark a day before it arrives."
                : habits.some((h) => canMark(h.id))
                ? 'Fill in anything left blank. Marks already made stay as they are.'
                : 'Marks on past days stay as they are.'}
            </Text>
          )}
          {habits.map((h) => {
            const state = grid[cellKey(day, h.id)] ?? 0;
            return (
              <View key={h.id} style={styles.habitRow}>
                <Text
                  style={styles.habitName}
                  maxFontSizeMultiplier={SCALE.row}
                  // one line at the default size, room to wrap once the text is enlarged
                  numberOfLines={fontScale > 1 ? 2 : 1}
                >
                  {h.name || 'Unnamed habit'}
                </Text>
                {([1, 2] as const).map((mark) => (
                  <MarkButton
                    key={mark}
                    kind={mark === 1 ? 'done' : 'missed'}
                    habit={h.name || 'Unnamed habit'}
                    active={state === mark}
                    disabled={!canMark(h.id)}
                    palette={palette}
                    onPress={() => onSet(day, h.id, state === mark ? 0 : mark)}
                  />
                ))}
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
            <PlusGlyph color={palette.accent} size={14} weight={2.6} />
            <Text style={styles.addText} maxFontSizeMultiplier={SCALE.heading}>
              Add habit
            </Text>
          </Pressable>
        )}
        {(habits.length > 0 || editing) && (
          <View style={styles.footerRight}>
            <Text style={styles.count} maxFontSizeMultiplier={SCALE.figure}>
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
              <Text
                style={[styles.toggleText, editing && styles.toggleTextActive]}
                maxFontSizeMultiplier={SCALE.heading}
              >
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
      lineHeight: wrapSafe(19),
      fontFamily: FONT.regular,
      color: p.inkSoft,
      paddingVertical: 4,
    },
    locked: {
      fontSize: wrapSafe(11),
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
      flexShrink: 1,
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
