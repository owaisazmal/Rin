import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CheckGlyph, CloseGlyph, PlusGlyph } from './Glyphs';
import { useRevealOnFocus, withoutTabs } from './KeyboardSafeScroll';
import SectionHeader from './SectionHeader';
import {
  CardItem,
  CardKind,
  MAX_CARD_ITEMS,
  MAX_CARD_ITEM_LEN,
  MAX_CARD_NOTE_LEN,
} from '../types';
import { FONT, Palette, RADIUS, cardSurface, useTheme } from '../theme';

/** A user-made card: a note, a list, or a checklist. */

interface Props {
  title: string;
  kind: CardKind;
  items: CardItem[];
  onChangeText: (index: number, text: string) => void;
  onToggle: (index: number) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

export default function CustomCard({
  title,
  kind,
  items,
  onChangeText,
  onToggle,
  onAdd,
  onRemove,
}: Props) {
  const { palette } = useTheme();
  const revealOnFocus = useRevealOnFocus();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  // a blank row is not a thing to do, so it is in neither half of the count
  const written = items.filter((item) => item.text.trim() !== '');
  const ticked = written.filter((item) => item.done).length;

  return (
    <View style={styles.card}>
      <SectionHeader
        // the built-in cards shout their names, so this one does too
        title={(title.trim() || 'Untitled').toUpperCase()}
        right={
          kind === 'note' ? null : (
            <View style={styles.headerRight}>
              {kind === 'checklist' && written.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>
                    {ticked}/{written.length}
                  </Text>
                </View>
              )}
              {/* gone at the limit rather than greyed out, as on OBSERVATIONS */}
              {items.length < MAX_CARD_ITEMS && (
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Add a line to ${title}`}
                  onPress={onAdd}
                  style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.6 }]}
                >
                  <PlusGlyph color={palette.accent} />
                </Pressable>
              )}
            </View>
          )
        }
      />
      <View style={styles.divider} />

      {kind === 'note' ? (
        <TextInput
          style={styles.note}
          value={items[0]?.text ?? ''}
          maxLength={MAX_CARD_NOTE_LEN}
          onChangeText={(t) => onChangeText(0, withoutTabs(t).slice(0, MAX_CARD_NOTE_LEN))}
          placeholder="write here…"
          placeholderTextColor={palette.inkSoft}
          // the page scrolls this box clear of the keyboard — see KeyboardSafeScroll
          onFocus={revealOnFocus}
          // Return adds a line here; the done bar closes the keyboard.
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
        />
      ) : (
        <View style={styles.list}>
          {items.map((item, i) => (
            <View key={i} style={styles.row}>
              {kind === 'checklist' ? (
                <Pressable
                  hitSlop={8}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: item.done }}
                  accessibilityLabel={item.text || 'untitled line'}
                  onPress={() => onToggle(i)}
                  style={({ pressed }) => [
                    styles.check,
                    item.done && styles.checkOn,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  {item.done && <CheckGlyph color={palette.onState} size={13} />}
                </Pressable>
              ) : (
                <View style={styles.dash} />
              )}
              <TextInput
                style={[styles.input, kind === 'checklist' && item.done && styles.inputDone]}
                value={item.text}
                maxLength={MAX_CARD_ITEM_LEN}
                onChangeText={(t) => onChangeText(i, withoutTabs(t).slice(0, MAX_CARD_ITEM_LEN))}
                placeholder={kind === 'checklist' ? 'something to tick off…' : 'write it down…'}
                placeholderTextColor={palette.inkSoft}
                onFocus={revealOnFocus}
                returnKeyType="done"
                // `multiline` is for wrapping, not paragraphs — see Observations
                submitBehavior="blurAndSubmit"
                multiline
              />
              {items.length > 1 && (
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Remove line"
                  onPress={() => onRemove(i)}
                  style={({ pressed }) => [styles.remove, pressed && { opacity: 0.5 }]}
                >
                  <CloseGlyph color={palette.inkSoft} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
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
    countText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      color: p.inkSoft,
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
    note: {
      minHeight: 96,
      backgroundColor: p.chip,
      borderRadius: RADIUS.control,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 12,
      fontSize: 14,
      lineHeight: 20,
      fontFamily: FONT.regular,
      color: p.ink,
    },
    list: {
      gap: 10,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: p.chip,
      borderRadius: RADIUS.control,
      paddingLeft: 14,
      paddingRight: 8,
    },
    dash: {
      width: 14,
      height: 3,
      borderRadius: 1.5,
      backgroundColor: p.accent,
      marginRight: 12,
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
    checkOn: {
      backgroundColor: p.done,
      borderColor: p.done,
    },
    input: {
      flex: 1,
      paddingVertical: 12,
      fontSize: 14,
      fontFamily: FONT.regular,
      color: p.ink,
    },
    inputDone: {
      color: p.inkSoft,
      textDecorationLine: 'line-through',
    },
    remove: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
