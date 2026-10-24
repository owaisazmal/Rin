import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CloseGlyph, PlusGlyph, RepeatGlyph } from './Glyphs';
import { useRevealOnFocus, withoutTabs } from './KeyboardSafeScroll';
import SectionHeader from './SectionHeader';
import { MAX_TASK_TEXT, Task } from '../tasks';
import { Urgency, dueLabel, pressureOf, timeLeftLabel, unfinished, urgencyOf } from '../deadlines';
import { repeatLabel } from '../recurring';
import { FONT, Palette, RADIUS, SCALE, cardSurface, useTheme, wrapSafe } from '../theme';

/** Unfinished tasks with a date on them; ticking one files it away to history. */

interface Props {
  tasks: Task[];
  /** ticking clock, so "4h left" becomes "3h left" without an edit */
  now: number;
  onAdd: () => void;
  onChangeText: (id: string, text: string) => void;
  onEditDue: (id: string) => void;
  onToggleDone: (id: string) => void;
  onRemove: (id: string) => void;
  onShowHistory: () => void;
}

function colourFor(u: Urgency, p: Palette): string {
  switch (u) {
    case 'done':
      return p.done;
    case 'overdue':
    case 'now':
      return p.missed;
    case 'soon':
    case 'near':
      return p.accent;
    default:
      return p.inkSoft;
  }
}

export default function Deadlines({
  tasks,
  now,
  onAdd,
  onChangeText,
  onEditDue,
  onToggleDone,
  onRemove,
  onShowHistory,
}: Props) {
  const { palette } = useTheme();
  const revealOnFocus = useRevealOnFocus();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const ordered = useMemo(() => unfinished(tasks), [tasks]);
  const overdue = ordered.filter((t) => t.due <= now).length;
  const finished = tasks.length - ordered.length;

  return (
    <View style={styles.card}>
      <SectionHeader
        title="DEADLINES"
        right={
          <View style={styles.headerRight}>
            {ordered.length > 0 && (
              <View style={[styles.countBadge, overdue > 0 && styles.countBadgeLate]}>
                <Text
                  style={[styles.countText, overdue > 0 && styles.countTextLate]}
                  maxFontSizeMultiplier={SCALE.figure}
                >
                  {overdue > 0 ? `${overdue} OVERDUE` : `${ordered.length} DUE`}
                </Text>
              </View>
            )}
            <Pressable
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Add a task with a deadline"
              onPress={onAdd}
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.6 }]}
            >
              <PlusGlyph color={palette.accent} />
            </Pressable>
          </View>
        }
      />
      <View style={styles.divider} />

      {ordered.length === 0 ? (
        <Text style={styles.empty}>
          {finished > 0
            ? 'Nothing outstanding. Everything with a date on it is done.'
            : 'Nothing with a date on it. Add a task, give it a deadline, and the reminders get more insistent as it approaches.'}
        </Text>
      ) : (
        <View style={styles.list}>
          {ordered.map((t) => {
            const tone = colourFor(urgencyOf(t, now), palette);
            const fill = pressureOf(t.due, now);
            const repeats = t.repeat ? repeatLabel(t.repeat.every) : null;
            return (
              <View key={t.id} style={styles.row}>
                <View style={styles.rowTop}>
                  <Pressable
                    hitSlop={8}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: false }}
                    accessibilityLabel={`Finish ${t.text || 'untitled task'}`}
                    onPress={() => onToggleDone(t.id)}
                    style={({ pressed }) => [styles.check, pressed && { opacity: 0.6 }]}
                  />
                  <TextInput
                    style={styles.input}
                    maxFontSizeMultiplier={SCALE.row}
                    value={t.text}
                    maxLength={MAX_TASK_TEXT}
                    onChangeText={(v) => onChangeText(t.id, withoutTabs(v).slice(0, MAX_TASK_TEXT))}
                    placeholder="what has to be finished…"
                    placeholderTextColor={palette.inkSoft}
                    onFocus={revealOnFocus}
                    returnKeyType="done"
                    // multiline only to wrap; Return still closes the keyboard
                    submitBehavior="blurAndSubmit"
                    multiline
                  />
                  <Pressable
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Remove task"
                    onPress={() => onRemove(t.id)}
                    style={({ pressed }) => [styles.remove, pressed && { opacity: 0.5 }]}
                  >
                    <CloseGlyph color={palette.inkSoft} />
                  </Pressable>
                </View>

                <View style={styles.meta}>
                  <Pressable
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Due ${dueLabel(t.due, now)}${repeats ? `, repeats ${repeats}` : ''}. Change deadline`}
                    onPress={() => onEditDue(t.id)}
                    style={({ pressed }) => [
                      styles.dueChip,
                      { borderColor: tone },
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Text
                      style={[styles.dueText, { color: tone }]}
                      maxFontSizeMultiplier={SCALE.figure}
                    >
                      {dueLabel(t.due, now)}
                    </Text>
                  </Pressable>
                  <Text
                    style={[styles.left, { color: tone }]}
                    maxFontSizeMultiplier={SCALE.figure}
                  >
                    {timeLeftLabel(t.due, now)}
                  </Text>
                  {repeats && (
                    <View style={styles.repeats}>
                      <RepeatGlyph color={palette.inkSoft} />
                      <Text style={styles.repeatsText} maxFontSizeMultiplier={SCALE.figure}>
                        {repeats}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${Math.round(fill * 100)}%`, backgroundColor: tone },
                    ]}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}

      {finished > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${finished} finished. Show history`}
          onPress={onShowHistory}
          style={({ pressed }) => [styles.historyLink, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.historyCount} maxFontSizeMultiplier={SCALE.figure}>
            {finished} finished
          </Text>
          <Text style={styles.historyText} maxFontSizeMultiplier={SCALE.heading}>
            SHOW HISTORY ›
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    card: {
      ...cardSurface(p),
      padding: 18,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    countBadge: {
      backgroundColor: p.chip,
      borderRadius: RADIUS.chip,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    countBadgeLate: {
      backgroundColor: p.missedSoft,
    },
    countText: {
      fontSize: 10,
      fontFamily: FONT.bold,
      letterSpacing: 1,
      color: p.inkSoft,
    },
    countTextLate: {
      color: p.missed,
    },
    addBtn: {
      width: 30,
      height: 30,
      borderRadius: RADIUS.pill,
      backgroundColor: p.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    divider: {
      height: 1,
      backgroundColor: p.lineFaint,
      marginBottom: 14,
    },
    empty: {
      fontSize: 13,
      lineHeight: wrapSafe(19),
      fontFamily: FONT.regular,
      color: p.inkSoft,
    },
    list: {
      gap: 12,
    },
    row: {
      backgroundColor: p.chip,
      borderRadius: RADIUS.control,
      paddingTop: 8,
      paddingBottom: 12,
      paddingHorizontal: 12,
    },
    rowTop: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: RADIUS.pill,
      borderWidth: 1.5,
      borderColor: p.line,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    input: {
      flex: 1,
      paddingVertical: 8,
      fontSize: 14,
      fontFamily: FONT.regular,
      color: p.ink,
    },
    remove: {
      width: 26,
      height: 26,
      alignItems: 'center',
      justifyContent: 'center',
    },
    meta: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      // clears the check circle, so the date lines up with the task text
      marginLeft: 32,
      marginBottom: 8,
      columnGap: 10,
      rowGap: 4,
    },
    dueChip: {
      borderWidth: 1,
      borderRadius: RADIUS.chip,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    dueText: {
      fontSize: 11,
      fontFamily: FONT.semibold,
    },
    left: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 0.3,
    },
    repeats: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    repeatsText: {
      fontSize: 11,
      fontFamily: FONT.semibold,
      color: p.inkSoft,
    },
    historyLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 14,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: p.lineFaint,
    },
    historyCount: {
      flexShrink: 1,
      fontSize: 12,
      fontFamily: FONT.regular,
      color: p.inkSoft,
    },
    historyText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 1.2,
      color: p.accent,
    },
    /** fills over the last week, so the pressure reads between the colour bands */
    track: {
      height: 3,
      borderRadius: 1.5,
      backgroundColor: p.cellEmpty,
      marginLeft: 32,
      overflow: 'hidden',
    },
    fill: {
      height: 3,
      borderRadius: 1.5,
    },
  });
