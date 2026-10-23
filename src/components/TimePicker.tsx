import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT, MODAL_ORIENTATIONS, Palette, RADIUS, SCALE, cardSurface, useTheme } from '../theme';

/** A time of day, in the same steppers the deadline sheet uses */

const MINUTE_STEP = 5;

interface Props {
  visible: boolean;
  title: string;
  hour: number;
  minute: number;
  onCancel: () => void;
  onConfirm: (hour: number, minute: number) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

export default function TimePicker({ visible, title, hour, minute, onCancel, onConfirm }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [picked, setPicked] = useState(hour * 60 + minute);

  useEffect(() => {
    if (visible) setPicked(hour * 60 + minute);
  }, [visible, hour, minute]);

  const shift = (by: number) => setPicked((t) => (((t + by) % 1440) + 1440) % 1440);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
      supportedOrientations={MODAL_ORIENTATIONS}
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title} maxFontSizeMultiplier={SCALE.heading}>
            {title}
          </Text>

          <View style={styles.timeRow}>
            <Stepper
              styles={styles}
              unit="hour"
              value={pad(Math.floor(picked / 60))}
              onDown={() => shift(-60)}
              onUp={() => shift(60)}
            />
            <Text style={styles.colon}>:</Text>
            <Stepper
              styles={styles}
              unit="minute"
              value={pad(picked % 60)}
              onDown={() => shift(-MINUTE_STEP)}
              onUp={() => shift(MINUTE_STEP)}
            />
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
              onPress={() => onConfirm(Math.floor(picked / 60), picked % 60)}
              style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.primaryText} maxFontSizeMultiplier={SCALE.heading}>
                SET
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Stepper({
  styles,
  unit,
  value,
  onDown,
  onUp,
}: {
  styles: ReturnType<typeof makeStyles>;
  unit: string;
  value: string;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Earlier ${unit}`}
        onPress={onDown}
        style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.stepGlyph}>−</Text>
      </Pressable>
      <Text style={styles.stepValue} accessibilityLabel={`${value} ${unit}${value === '01' ? '' : 's'}`}>
        {value}
      </Text>
      <Pressable
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Later ${unit}`}
        onPress={onUp}
        style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.stepGlyph}>+</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
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
      maxWidth: 360,
      padding: 20,
    },
    title: {
      fontSize: 13,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
    },
    timeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 18,
      marginBottom: 22,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: p.chip,
      borderRadius: RADIUS.control,
      paddingHorizontal: 4,
    },
    stepBtn: {
      width: 36,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepGlyph: {
      fontSize: 18,
      fontFamily: FONT.bold,
      color: p.accent,
      lineHeight: 21,
    },
    stepValue: {
      minWidth: 32,
      textAlign: 'center',
      fontSize: 20,
      fontFamily: FONT.bold,
      color: p.ink,
    },
    colon: {
      fontSize: 20,
      fontFamily: FONT.bold,
      color: p.inkSoft,
      paddingHorizontal: 8,
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
    primaryText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.onAccent,
    },
  });
