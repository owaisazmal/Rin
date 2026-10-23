import React, { ReactNode, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT, MODAL_ORIENTATIONS, Palette, RADIUS, SCALE, cardSurface, useTheme } from '../theme';

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
      {/* drawn rather than typed: no caret glyph in Josefin, and a fallback
          one lands at a different height on each platform */}
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
  /*
    A Modal, not an overlay drawn in place. The planner's back handler
    hands an unclaimed Android back press to the system, which closes the
    app — and a panel this tall would hang outside the planner's scroll
    view, where Android draws it but won't route a touch to it.
  */
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={MODAL_ORIENTATIONS}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { maxWidth }]} onPress={() => {}}>
          <Text style={styles.sheetTitle} maxFontSizeMultiplier={SCALE.heading}>
            {title}
          </Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
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
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 22,
    },
    sheet: {
      // solid like the due-date sheet, since it floats over a dimmed page, not the aurora
      ...cardSurface(p),
      backgroundColor: p.bg,
      width: '100%',
      padding: 16,
    },
    sheetTitle: {
      fontSize: 13,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
      marginBottom: 10,
    },
  });
