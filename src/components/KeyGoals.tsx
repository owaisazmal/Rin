import React, { useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import SectionHeader from './SectionHeader';
import { KeyGoal, MAX_GOAL_LEN } from '../types';
import { useTheme, cardSurface, RADIUS, FONT } from '../theme';

interface Props {
  goals: KeyGoal[];
  onChangeText: (index: number, text: string) => void;
  onToggleDone: (index: number) => void;
}

export default function KeyGoals({ goals, onChangeText, onToggleDone }: Props) {
  const { palette } = useTheme();

  const doneCount = goals.filter((g) => g.done && g.text.trim()).length;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          ...cardSurface(palette),
          padding: 18,
        },
        countBadge: {
          backgroundColor: palette.chip,
          borderRadius: RADIUS.chip,
          paddingHorizontal: 10,
          paddingVertical: 3,
        },
        countText: {
          fontSize: 11,
          fontFamily: FONT.bold,
          color: palette.inkSoft,
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
          fontSize: 10,
          fontFamily: FONT.bold,
          letterSpacing: 0.5,
          color: palette.inkSoft,
          borderWidth: 1,
          borderColor: palette.line,
          borderRadius: RADIUS.chip,
          paddingVertical: 4,
          paddingHorizontal: 10,
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
        right={
          <View style={styles.countBadge}>
            <Text style={styles.countText}>
              {doneCount}/{goals.length}
            </Text>
          </View>
        }
      />
      <View style={styles.row}>
        {goals.map((g, i) => (
          <View key={i} style={[styles.goalBox, g.done && styles.goalBoxDone]}>
            <TextInput
              style={[styles.input, g.done && styles.inputDone]}
              value={g.text}
              maxLength={MAX_GOAL_LEN}
              onChangeText={(t) => onChangeText(i, t.slice(0, MAX_GOAL_LEN))}
              placeholder="goal"
              placeholderTextColor={palette.inkSoft}
              multiline
              textAlign="center"
            />
            <Pressable
              hitSlop={6}
              onPress={() => onToggleDone(i)}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Text style={[styles.check, g.done && styles.checkDone]}>
                {g.done ? '✓ DONE' : 'MARK DONE'}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
