import { ReactNode, useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, MODAL_ORIENTATIONS, Palette, RADIUS, cardSurface, useTheme } from '../theme';

/** A card floating over a dimmed page; tapping the dim area closes it */
export function Sheet({
  visible,
  onClose,
  avoidKeyboard = false,
  style,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** for sheets with fields: rise above the keyboard and keep clear of the status bar */
  avoidKeyboard?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const backdrop = (
    <Pressable
      style={[
        styles.backdrop,
        avoidKeyboard && {
          paddingTop: Math.max(22, insets.top + 8),
          paddingBottom: Math.max(22, insets.bottom + 8),
        },
      ]}
      onPress={onClose}
    >
      <Pressable style={[styles.sheet, style]} onPress={() => {}}>
        {children}
      </Pressable>
    </Pressable>
  );
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={MODAL_ORIENTATIONS}
    >
      {avoidKeyboard ? (
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          {backdrop}
        </KeyboardAvoidingView>
      ) : (
        backdrop
      )}
    </Modal>
  );
}

/** Cancel beside the sheet's main action */
export function SheetActions({
  onCancel,
  confirmLabel,
  onConfirm,
  disabled = false,
  maxFontSizeMultiplier,
}: {
  onCancel: () => void;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  maxFontSizeMultiplier?: number;
}) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={styles.actions}>
      <Pressable
        onPress={onCancel}
        style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.ghostText} maxFontSizeMultiplier={maxFontSizeMultiplier}>
          CANCEL
        </Text>
      </Pressable>
      <Pressable
        disabled={disabled}
        onPress={onConfirm}
        style={({ pressed }) => [
          styles.primary,
          disabled && styles.primaryOff,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.primaryText} maxFontSizeMultiplier={maxFontSizeMultiplier}>
          {confirmLabel}
        </Text>
      </Pressable>
    </View>
  );
}

/** Minutes move in fives — a time is never meaningfully 18:37 */
const MINUTE_STEP = 5;

const pad = (n: number) => String(n).padStart(2, '0');

/** hour : minute steppers; `minutes` counts from midnight and wraps within the day */
export function TimeSteppers({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const shift = (by: number) => onChange((((minutes + by) % 1440) + 1440) % 1440);
  return (
    <>
      <Stepper
        styles={styles}
        unit="hour"
        value={pad(Math.floor(minutes / 60))}
        onDown={() => shift(-60)}
        onUp={() => shift(60)}
      />
      <Text style={styles.colon}>:</Text>
      <Stepper
        styles={styles}
        unit="minute"
        value={pad(minutes % 60)}
        onDown={() => shift(-MINUTE_STEP)}
        onUp={() => shift(MINUTE_STEP)}
      />
    </>
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
  /** named in the labels, since "−" on its own tells a screen reader nothing */
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
    flex: { flex: 1 },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 22,
    },
    sheet: {
      // solid, since it floats over a dimmed page rather than the aurora
      ...cardSurface(p),
      backgroundColor: p.bg,
      width: '100%',
      maxWidth: 360,
      padding: 20,
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
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: p.chip,
      borderRadius: RADIUS.control,
      paddingHorizontal: 4,
    },
    stepBtn: {
      width: 30,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepGlyph: {
      fontSize: 16,
      fontFamily: FONT.bold,
      color: p.accent,
      lineHeight: 19,
    },
    stepValue: {
      minWidth: 28,
      textAlign: 'center',
      fontSize: 16,
      fontFamily: FONT.bold,
      color: p.ink,
    },
    colon: {
      fontSize: 16,
      fontFamily: FONT.bold,
      color: p.inkSoft,
      paddingHorizontal: 6,
    },
  });
