import { ReactNode, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT, Palette, RADIUS, SCALE, useTheme } from '../theme';
import { Sheet } from './Sheet';

/** The chip that opens a choice and the sheet it is made in; the year grid's span and the tracker's chart share them */

export function PickerChip({
  label,
  icon,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  /** drawn before the label */
  icon?: ReactNode;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}
    >
      {icon}
      <Text style={styles.chipText} maxFontSizeMultiplier={SCALE.heading}>
        {label}
      </Text>
      {/* drawn: Josefin has no caret, and a fallback sits differently per platform */}
      <View style={styles.caret} />
    </Pressable>
  );
}

export function PickerSheet({
  visible,
  title,
  onClose,
  maxWidth = 260,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  maxWidth?: number;
  children: ReactNode;
}) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <Sheet visible={visible} onClose={onClose} style={{ maxWidth, padding: 16 }}>
      <Text style={styles.sheetTitle} maxFontSizeMultiplier={SCALE.heading}>
        {title}
      </Text>
      {children}
    </Sheet>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingLeft: 10,
      paddingRight: 9,
      paddingVertical: 6,
      borderRadius: RADIUS.chip,
      backgroundColor: p.chip,
      borderWidth: 1,
      borderColor: p.lineFaint,
    },
    chipText: {
      fontSize: 12,
      fontFamily: FONT.semibold,
      color: p.ink,
      includeFontPadding: false,
    },
    caret: {
      width: 6,
      height: 6,
      borderRightWidth: 1.5,
      borderBottomWidth: 1.5,
      borderColor: p.inkSoft,
      transform: [{ rotate: '45deg' }, { translateY: -1 }],
    },
    sheetTitle: {
      fontSize: 13,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
      marginBottom: 10,
    },
  });
