import React, { useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import SectionHeader from './SectionHeader';
import { Habit, MAX_HABITS, MAX_HABIT_NAME } from '../types';
import { useTheme, cardSurface, RADIUS, FONT } from '../theme';

interface Props {
  habits: Habit[];
  onRename: (id: string, name: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

export default function HabitsList({ habits, onRename, onAdd, onRemove }: Props) {
  const { palette } = useTheme();

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
          alignItems: 'center',
          borderBottomWidth: 1,
          borderBottomColor: palette.lineFaint,
          paddingVertical: 2,
        },
        num: {
          width: 24,
          height: 24,
          borderRadius: RADIUS.pill,
          backgroundColor: palette.chip,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 10,
        },
        numText: {
          fontFamily: FONT.bold,
          fontSize: 11,
          color: palette.inkSoft,
        },
        input: {
          flex: 1,
          paddingVertical: 10,
          fontSize: 14,
          fontFamily: FONT.medium,
          color: palette.ink,
        },
        remove: {
          fontSize: 20,
          fontFamily: FONT.regular,
          color: palette.inkSoft,
          paddingHorizontal: 8,
        },
        addBtn: {
          marginTop: 12,
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: palette.accentSoft,
          borderRadius: RADIUS.control,
          paddingVertical: 9,
          paddingHorizontal: 16,
        },
        addText: {
          fontSize: 13,
          fontFamily: FONT.bold,
          color: palette.accent,
        },
        limit: {
          marginTop: 12,
          fontSize: 12,
          fontFamily: FONT.regular,
          color: palette.inkSoft,
        },
        empty: {
          fontSize: 13,
          fontFamily: FONT.regular,
          color: palette.inkSoft,
          paddingVertical: 4,
        },
      }),
    [palette]
  );

  return (
    <View style={styles.card}>
      <SectionHeader
        title="HABITS"
        right={
          <View style={styles.countBadge}>
            <Text style={styles.countText}>
              {habits.length}/{MAX_HABITS}
            </Text>
          </View>
        }
      />
      {habits.length === 0 && (
        <Text style={styles.empty}>No habits yet — add your first one.</Text>
      )}
      {habits.map((h, i) => (
        <View key={h.id} style={styles.row}>
          <View style={styles.num}>
            <Text style={styles.numText}>{i + 1}</Text>
          </View>
          <TextInput
            style={styles.input}
            value={h.name}
            maxLength={MAX_HABIT_NAME}
            onChangeText={(t) => onRename(h.id, t.slice(0, MAX_HABIT_NAME))}
            placeholder="habit name…"
            placeholderTextColor={palette.inkSoft}
            autoCapitalize="sentences"
            returnKeyType="done"
          />
          <Pressable
            hitSlop={8}
            onPress={() => onRemove(h.id)}
            style={({ pressed }) => pressed && { opacity: 0.5 }}
          >
            <Text style={styles.remove}>×</Text>
          </Pressable>
        </View>
      ))}
      {habits.length < MAX_HABITS ? (
        <Pressable
          onPress={onAdd}
          hitSlop={6}
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.addText}>＋ Add habit</Text>
        </Pressable>
      ) : (
        <Text style={styles.limit}>Maximum of {MAX_HABITS} habits reached.</Text>
      )}
    </View>
  );
}
