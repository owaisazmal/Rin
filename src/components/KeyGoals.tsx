import { useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { useRevealOnFocus, withoutTabs } from './KeyboardSafeScroll';
import SectionHeader, { CountBadge } from './SectionHeader';
import { KeyGoal, MAX_GOAL_LEN } from '../types';
import { useTheme, cardSurface, RADIUS, FONT, SCALE, wrapSafe } from '../theme';

interface Props {
  goals: KeyGoal[];
  onChangeText: (index: number, text: string) => void;
  onToggleDone: (index: number) => void;
}

export default function KeyGoals({ goals, onChangeText, onToggleDone }: Props) {
  const { palette } = useTheme();
  const revealOnFocus = useRevealOnFocus();

  const doneCount = goals.filter((g) => g.done && g.text.trim()).length;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          ...cardSurface(palette),
          padding: 18,
        },
        row: {
          flexDirection: 'row',
          gap: 10,
        },
        goalBox: {
          flex: 1,
          backgroundColor: palette.chip,
          borderRadius: RADIUS.chip,
          borderWidth: 1,
          borderColor: palette.lineFaint,
          paddingVertical: 12,
          paddingHorizontal: 8,
          alignItems: 'center',
        },
        goalBoxDone: {
          backgroundColor: palette.doneSoft,
          borderColor: palette.done,
        },
        input: {
          minHeight: 48,
          fontSize: 14,
          fontFamily: FONT.bold,
          color: palette.ink,
          textAlignVertical: 'center',
          alignSelf: 'stretch',
        },
        inputDone: {
          color: palette.done,
        },
        check: {
          marginTop: 6,
          fontSize: wrapSafe(10),
          fontFamily: FONT.bold,
          letterSpacing: 0.5,
          color: palette.inkSoft,
          borderWidth: 1,
          borderColor: palette.line,
          borderRadius: RADIUS.chip,
          paddingVertical: 4,
          paddingHorizontal: 4,
          overflow: 'hidden',
        },
        checkDone: {
          color: palette.onState,
          backgroundColor: palette.done,
          borderColor: palette.done,
        },
      }),
    [palette]
  );

  return (
    <View style={styles.card}>
      <SectionHeader
        title="KEY GOALS"
        right={<CountBadge label={`${doneCount}/${goals.length}`} />}
      />
      <View style={styles.row}>
        {goals.map((g, i) => (
          <View key={i} style={[styles.goalBox, g.done && styles.goalBoxDone]}>
            <TextInput
              style={[styles.input, g.done && styles.inputDone]}
              // a third of the card, so it stops with the headings
              maxFontSizeMultiplier={SCALE.heading}
              value={g.text}
              maxLength={MAX_GOAL_LEN}
              onChangeText={(t) => onChangeText(i, withoutTabs(t).slice(0, MAX_GOAL_LEN))}
              placeholder="goal"
              placeholderTextColor={palette.inkSoft}
              onFocus={revealOnFocus}
              returnKeyType="done"
              // multiline only to wrap; Return still closes the keyboard
              submitBehavior="blurAndSubmit"
              multiline
              textAlign="center"
            />
            <Pressable
              hitSlop={6}
              onPress={() => onToggleDone(i)}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Text
                style={[styles.check, g.done && styles.checkDone]}
                // one line at any width — it shrinks to fit a narrow box rather than wrap
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
              >
                {g.done ? '✓ DONE' : 'MARK DONE'}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
