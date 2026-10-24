import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT, Palette, RADIUS, useTheme } from '../theme';

/** The way out of an edit, on the keyboard; must be the avoiding view's last non-absolute child */

// Android has no `will` events; on iOS they let the bar travel up with the keyboard
const SHOW = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

/** How far the bar's colour runs down behind the keyboard */
const UNDER = 64;

export default function KeyboardDoneBar() {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const styles = useMemo(() => makeStyles(palette), [palette]);

  useEffect(() => {
    const shown = Keyboard.addListener(SHOW, () => setOpen(true));
    const hidden = Keyboard.addListener(HIDE, () => setOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  if (!open) return null;

  return (
    <View style={styles.bar}>
      {/* fills in behind the rounded top corners of the iOS keyboard */}
      {Platform.OS === 'ios' && <View pointerEvents="none" style={styles.under} />}
      <Pressable
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Finish editing"
        onPress={() => Keyboard.dismiss()}
        style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.label}>DONE</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: p.chip,
      borderTopWidth: 1,
      borderTopColor: p.lineFaint,
    },
    under: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: -UNDER,
      height: UNDER,
      backgroundColor: p.chip,
    },
    btn: {
      paddingHorizontal: 18,
      paddingVertical: 8,
      borderRadius: RADIUS.control,
      backgroundColor: p.accent,
    },
    label: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.onAccent,
    },
  });
