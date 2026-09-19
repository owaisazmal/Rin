import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT, Palette, RADIUS, useTheme } from '../theme';

/**
 * A bar that sits on top of the keyboard with one way out of an edit.
 *
 * The keyboard's own return key already says DONE and the page dismisses on a
 * drag, but neither announces itself: someone who has just typed into a field
 * has to know the return key changed meaning. This is the visible version of
 * the same thing.
 *
 * It belongs *inside* the screen's `KeyboardAvoidingView`, as the last child
 * after the scroll view — and as an ordinary one, not an absolute one. That
 * view pads its box by the keyboard's height, which shrinks the column its
 * children are laid out in, so the last child in the column lands exactly on
 * top of the keyboard with no second measurement to keep in step.
 *
 * Absolute positioning was tried first and does not work: `bottom: 0` anchors
 * to the padding box's outer edge, the padding is not subtracted, and the bar
 * renders underneath the keyboard where nobody can see it. Positioning it
 * outside the avoiding view instead would mean tracking the keyboard height,
 * which Android reports in window coordinates an edge-to-edge app cannot use
 * directly.
 */

/**
 * Android never emits the `will` pair, so it has to be told to watch `did`.
 * The distinction is worth keeping rather than using `did` on both: on iOS
 * `will` fires before the keyboard animates, so the bar travels up with it
 * instead of appearing once it has already arrived.
 */
const SHOW = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

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
      <Pressable
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Finish editing"
        // the same thing the return key does, and the same thing a drag does
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
