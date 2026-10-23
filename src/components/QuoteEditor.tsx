import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_QUOTE_LENGTH, quoteProblem } from '../quotes';
import { FONT, MODAL_ORIENTATIONS, Palette, RADIUS, SCALE, cardSurface, useTheme, wrapSafe } from '../theme';

/** Writes a new quote of the user's own, or rewrites one */

interface Props {
  visible: boolean;
  /** the user's list as it stands, to catch a repeat */
  custom: string[];
  /** which quote is being rewritten, or null for a new one */
  index: number | null;
  onCancel: () => void;
  onSave: (text: string) => void;
}

export default function QuoteEditor({ visible, custom, index, onCancel, onSave }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) setText(index === null ? '' : (custom[index] ?? ''));
    // only on opening, so a list change underneath doesn't wipe what is typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, index]);

  const problem = quoteProblem(custom, index, text);
  const save = () => {
    if (!problem) onSave(text);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
      supportedOrientations={MODAL_ORIENTATIONS}
    >
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <Pressable
          style={[
            styles.backdrop,
            {
              paddingTop: Math.max(22, insets.top + 8),
              paddingBottom: Math.max(22, insets.bottom + 8),
            },
          ]}
          onPress={onCancel}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title} maxFontSizeMultiplier={SCALE.heading}>
              {index === null ? 'NEW QUOTE' : 'EDIT QUOTE'}
            </Text>

            <TextInput
              style={styles.input}
              maxFontSizeMultiplier={SCALE.row}
              value={text}
              maxLength={MAX_QUOTE_LENGTH}
              onChangeText={setText}
              placeholder="A line worth reading every day"
              placeholderTextColor={palette.inkSoft}
              accessibilityLabel="Quote"
              autoFocus
              multiline
              // one line that wraps; Return saves rather than starting a paragraph
              submitBehavior="blurAndSubmit"
              returnKeyType="done"
              onSubmitEditing={save}
            />

            <View style={styles.meta}>
              <Text style={styles.problem} maxFontSizeMultiplier={SCALE.row}>
                {problem === 'repeat' ? 'Already in your list' : ''}
              </Text>
              <Text
                style={styles.count}
                maxFontSizeMultiplier={SCALE.row}
                accessibilityLabel={`${text.length} of ${MAX_QUOTE_LENGTH} characters`}
              >
                {text.length}/{MAX_QUOTE_LENGTH}
              </Text>
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={onCancel}
                style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.ghostText} maxFontSizeMultiplier={SCALE.heading}>
                  CANCEL
                </Text>
              </Pressable>
              <Pressable
                disabled={problem !== null}
                accessibilityState={{ disabled: problem !== null }}
                onPress={save}
                style={({ pressed }) => [
                  styles.primary,
                  problem !== null && styles.primaryOff,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.primaryText} maxFontSizeMultiplier={SCALE.heading}>
                  SAVE
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 22,
    },
    sheet: {
      ...cardSurface(p),
      backgroundColor: p.bg,
      width: '100%',
      maxWidth: 360,
      padding: 20,
    },
    title: {
      fontSize: 13,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
    },
    input: {
      marginTop: 16,
      minHeight: 96,
      backgroundColor: p.chip,
      borderRadius: RADIUS.control,
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 12,
      fontSize: 15,
      lineHeight: wrapSafe(21),
      fontFamily: FONT.italic,
      color: p.ink,
      textAlignVertical: 'top',
    },
    meta: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
      marginTop: 8,
      marginBottom: 18,
    },
    problem: {
      flex: 1,
      fontSize: 12,
      fontFamily: FONT.semibold,
      color: p.accent,
    },
    count: {
      fontSize: 12,
      fontFamily: FONT.regular,
      color: p.inkSoft,
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
    },
    ghostBtn: {
      flex: 1,
      height: 44,
      borderRadius: RADIUS.control,
      borderWidth: 1,
      borderColor: p.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ghostText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.inkSoft,
    },
    primary: {
      flex: 1,
      height: 44,
      borderRadius: RADIUS.control,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryOff: {
      opacity: 0.4,
    },
    primaryText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.onAccent,
    },
  });
