import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckGlyph, ChevronGlyph, CloseGlyph } from './Glyphs';
import SegmentedControl from './SegmentedControl';
import { BUILTIN_TITLES, PlannerLayout, canAddCard, isBuiltinCard } from '../layout';
import { CardKind, MAX_CARD_TITLE, MAX_CUSTOM_CARDS } from '../types';
import { FONT, Palette, RADIUS, cardSurface, useTheme, wrapSafe } from '../theme';

/**
 * The sheet for showing, ordering and creating the cards below the daily check.
 * Changes apply as they are made.
 */

const KINDS: readonly { value: CardKind; label: string }[] = [
  { value: 'note', label: 'NOTE' },
  { value: 'list', label: 'LIST' },
  { value: 'checklist', label: 'CHECKLIST' },
];

const KIND_LABEL: Record<CardKind, string> = {
  note: 'NOTE',
  list: 'LIST',
  checklist: 'CHECKLIST',
};

/** A row's height and the gap under it; rows are placed and scrolled by these */
const ROW_HEIGHT = 52;
const ROW_GAP = 8;
const ROW_STEP = ROW_HEIGHT + ROW_GAP;

/** A row that slides to a new place in the list instead of jumping there. */
function SlideRow({
  index,
  lifted,
  style,
  children,
}: {
  index: number;
  /** the row being moved rides over the one it swaps with */
  lifted: boolean;
  style: ViewStyle;
  children: ReactNode;
}) {
  const was = useRef(index);
  /** how far short of its place the last slide still is */
  const left = useRef(0);
  // A fresh value per move, starting where the row is now, so it lands with the new `top`.
  const y = useMemo(
    () => new Animated.Value((was.current - index) * ROW_STEP + left.current),
    [index]
  );

  useEffect(() => {
    was.current = index;
    const watch = y.addListener(({ value }) => {
      left.current = value;
    });
    const slide = Animated.timing(y, {
      toValue: 0,
      duration: 260,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      useNativeDriver: true,
    });
    slide.start(({ finished }) => {
      if (finished) left.current = 0;
    });
    return () => {
      slide.stop();
      y.removeListener(watch);
    };
  }, [index, y]);

  return (
    <Animated.View
      style={[
        style,
        { top: index * ROW_STEP, zIndex: lifted ? 1 : 0, transform: [{ translateY: y }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

interface Props {
  visible: boolean;
  layout: PlannerLayout;
  onToggle: (id: string) => void;
  onMove: (id: string, by: -1 | 1) => void;
  onRename: (id: string, title: string) => void;
  /** asks before it deletes; that conversation belongs to the screen */
  onRemove: (id: string) => void;
  onAdd: (title: string, kind: CardKind) => void;
  onClose: () => void;
}

export default function LayoutEditor({
  visible,
  layout,
  onToggle,
  onMove,
  onRename,
  onRemove,
  onAdd,
  onClose,
}: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const list = useRef<ScrollView>(null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<CardKind>('list');
  const ready = name.trim() !== '';
  const [moved, setMoved] = useState<string | null>(null);

  const move = (id: string, by: -1 | 1) => {
    setMoved(id);
    onMove(id, by);
  };

  const add = () => {
    if (!ready) return;
    onAdd(name, kind);
    setName('');
    // the new card lands at the bottom of the list, which may be out of sight
    setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  };

  const renaming = useRef<number | null>(null);

  /** The keyboard shrinks the list, so scroll the row being renamed back into view. */
  const reveal = useCallback(() => {
    const row = renaming.current;
    if (row !== null) list.current?.scrollTo({ y: row * ROW_STEP, animated: true });
  }, []);

  useEffect(() => {
    // not before the keyboard has settled: the list is still shrinking until then
    const shown = Keyboard.addListener('keyboardDidShow', reveal);
    return () => shown.remove();
  }, [reveal]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {/* tapping the dim area behind the sheet dismisses it, as a sheet should */}
        <Pressable
          // keeps the sheet below the status bar when the keyboard is up
          style={[
            styles.backdrop,
            {
              paddingTop: Math.max(22, insets.top + 8),
              paddingBottom: Math.max(22, insets.bottom + 8),
            },
          ]}
          onPress={onClose}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title}>YOUR CARDS</Text>
            <Text style={styles.hint}>
              What sits below your habits, top to bottom. Switch off what you don’t use.
            </Text>

            <ScrollView
              ref={list}
              style={styles.list}
              contentContainerStyle={{ height: layout.slots.length * ROW_STEP - ROW_GAP }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {layout.slots.map((slot, i) => {
                const title = isBuiltinCard(slot.id)
                  ? BUILTIN_TITLES[slot.id]
                  : (slot.custom?.title ?? '');
                const spoken = title.trim() || 'untitled card';
                return (
                  <SlideRow key={slot.id} index={i} lifted={slot.id === moved} style={styles.row}>
                    <Pressable
                      hitSlop={10}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: slot.shown }}
                      accessibilityLabel={`Show ${spoken}`}
                      onPress={() => onToggle(slot.id)}
                      style={({ pressed }) => [
                        styles.toggle,
                        slot.shown && styles.toggleOn,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      {slot.shown && <CheckGlyph color={palette.onAccent} size={13} />}
                    </Pressable>

                    <View style={[styles.name, !slot.shown && styles.nameOff]}>
                      {slot.custom ? (
                        <>
                          <TextInput
                            style={styles.nameInput}
                            value={slot.custom.title}
                            maxLength={MAX_CARD_TITLE}
                            onChangeText={(t) => onRename(slot.id, t.slice(0, MAX_CARD_TITLE))}
                            onFocus={() => {
                              renaming.current = i;
                              if (Keyboard.isVisible()) reveal();
                            }}
                            onBlur={() => {
                              renaming.current = null;
                            }}
                            placeholder="card name"
                            placeholderTextColor={palette.inkSoft}
                            accessibilityLabel={`Name of ${spoken}`}
                            returnKeyType="done"
                          />
                          <Text style={styles.kind}>{KIND_LABEL[slot.custom.kind]}</Text>
                        </>
                      ) : (
                        <Text style={styles.nameText} numberOfLines={1}>
                          {title}
                        </Text>
                      )}
                    </View>

                    <Pressable
                      hitSlop={4}
                      disabled={i === 0}
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${spoken} up`}
                      onPress={() => move(slot.id, -1)}
                      style={({ pressed }) => [
                        styles.arrow,
                        i === 0 && styles.arrowOff,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <ChevronGlyph up color={palette.ink} />
                    </Pressable>
                    <Pressable
                      hitSlop={4}
                      disabled={i === layout.slots.length - 1}
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${spoken} down`}
                      onPress={() => move(slot.id, 1)}
                      style={({ pressed }) => [
                        styles.arrow,
                        i === layout.slots.length - 1 && styles.arrowOff,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <ChevronGlyph color={palette.ink} />
                    </Pressable>
                    {slot.custom && (
                      <Pressable
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${spoken}`}
                        onPress={() => onRemove(slot.id)}
                        style={({ pressed }) => [styles.remove, pressed && { opacity: 0.5 }]}
                      >
                        <CloseGlyph color={palette.missed} />
                      </Pressable>
                    )}
                  </SlideRow>
                );
              })}
            </ScrollView>

            <View style={styles.divider} />

            {canAddCard(layout) ? (
              <>
                <Text style={styles.label}>MAKE YOUR OWN</Text>
                <View style={styles.addRow}>
                  <TextInput
                    style={styles.addInput}
                    value={name}
                    maxLength={MAX_CARD_TITLE}
                    onChangeText={(t) => setName(t.slice(0, MAX_CARD_TITLE))}
                    placeholder="name it…"
                    placeholderTextColor={palette.inkSoft}
                    accessibilityLabel="Name for a new card"
                    returnKeyType="done"
                    onSubmitEditing={add}
                  />
                  <Pressable
                    disabled={!ready}
                    accessibilityRole="button"
                    accessibilityLabel="Add card"
                    onPress={add}
                    style={({ pressed }) => [
                      styles.addBtn,
                      !ready && styles.addBtnOff,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={styles.addText}>ADD</Text>
                  </Pressable>
                </View>
                <SegmentedControl options={KINDS} value={kind} onChange={setKind} />
              </>
            ) : (
              <Text style={styles.hint}>
                {MAX_CUSTOM_CARDS} cards of your own is the most the planner holds. Delete one to
                make another.
              </Text>
            )}

            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.done, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.doneText}>DONE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    flex: {
      flex: 1,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 22,
    },
    sheet: {
      ...cardSurface(p),
      backgroundColor: p.bg,
      width: '100%',
      maxWidth: 380,
      // the list inside is what gives when the keyboard takes the room
      maxHeight: '100%',
      padding: 20,
    },
    title: {
      fontSize: 13,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
      marginBottom: 6,
    },
    hint: {
      fontSize: 12,
      lineHeight: wrapSafe(17),
      fontFamily: FONT.regular,
      color: p.inkSoft,
    },
    list: {
      flexShrink: 1,
      marginTop: 14,
    },
    row: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: p.chip,
      borderRadius: RADIUS.control,
      paddingLeft: 12,
      paddingRight: 6,
      gap: 6,
    },
    toggle: {
      width: 22,
      height: 22,
      borderRadius: RADIUS.pill,
      borderWidth: 1.5,
      borderColor: p.line,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 6,
    },
    toggleOn: {
      backgroundColor: p.accent,
      borderColor: p.accent,
    },
    name: {
      flex: 1,
      justifyContent: 'center',
    },
    /** a hidden card keeps its row and its place, and reads as switched off */
    nameOff: {
      opacity: 0.45,
    },
    nameText: {
      fontSize: 14,
      fontFamily: FONT.semibold,
      color: p.ink,
    },
    nameInput: {
      fontSize: 14,
      fontFamily: FONT.semibold,
      color: p.ink,
      padding: 0,
    },
    kind: {
      marginTop: 3,
      fontSize: 9,
      fontFamily: FONT.bold,
      letterSpacing: 1.2,
      color: p.inkSoft,
    },
    arrow: {
      width: 30,
      height: 30,
      borderRadius: RADIUS.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.card,
    },
    arrowOff: {
      opacity: 0.3,
    },
    remove: {
      width: 30,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    divider: {
      height: 1,
      backgroundColor: p.lineFaint,
      marginVertical: 16,
    },
    label: {
      fontSize: 10,
      fontFamily: FONT.bold,
      letterSpacing: 1.5,
      color: p.inkSoft,
      marginBottom: 8,
    },
    addRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 8,
    },
    addInput: {
      flex: 1,
      height: 42,
      backgroundColor: p.chip,
      borderRadius: RADIUS.control,
      paddingHorizontal: 12,
      paddingVertical: 0,
      fontSize: 14,
      fontFamily: FONT.regular,
      color: p.ink,
    },
    addBtn: {
      height: 42,
      paddingHorizontal: 18,
      borderRadius: RADIUS.control,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addBtnOff: {
      opacity: 0.4,
    },
    addText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.onAccent,
    },
    done: {
      marginTop: 18,
      height: 44,
      borderRadius: RADIUS.control,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.onAccent,
    },
  });
