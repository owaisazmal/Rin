import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { MAX_QUOTE_LENGTH, quoteProblem } from '../quotes';
import { FONT, Palette, RADIUS, SCALE, useTheme, wrapSafe } from '../theme';
import { Sheet, SheetActions } from './Sheet';

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
    <Sheet visible={visible} onClose={onCancel} avoidKeyboard>
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

      <SheetActions
        onCancel={onCancel}
        confirmLabel="SAVE"
        onConfirm={save}
        disabled={problem !== null}
        maxFontSizeMultiplier={SCALE.heading}
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
  });
