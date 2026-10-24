import { useEffect, useRef } from 'react';
import { Animated, Pressable } from 'react-native';
import { Palette, RADIUS } from '../theme';
import { Glyph } from './Glyphs';

/** Done / missed toggle. */

const SIZE = 40;
const CHECK = 'M5 12.8 L9.7 17.5 L19 6.8';
const CROSS = 'M7 7 L17 17 M17 7 L7 17';

export default function MarkButton({
  kind,
  habit,
  active,
  disabled = false,
  palette,
  onPress,
}: {
  kind: 'done' | 'missed';
  /** the habit's name, for screen readers */
  habit: string;
  active: boolean;
  /** a past day's existing mark can't be changed, and a future day can't be marked */
  disabled?: boolean;
  palette: Palette;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (active) {
      scale.setValue(0.72);
      Animated.spring(scale, {
        toValue: 1,
        friction: 5,
        tension: 140,
        useNativeDriver: true,
      }).start();
    }
  }, [active, scale]);

  const fill = kind === 'done' ? palette.done : palette.missed;
  const soft = kind === 'done' ? palette.doneSoft : palette.missedSoft;

  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Mark ${habit} ${kind}`}
      accessibilityState={{ selected: active }}
    >
      {({ pressed }) => (
        <Animated.View
          style={{
            width: SIZE,
            height: SIZE,
            borderRadius: RADIUS.control,
            borderWidth: 1.5,
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: 8,
            borderColor: active ? fill : palette.lineFaint,
            backgroundColor: active ? fill : soft,
            // a locked day still shows its marks, just muted and untappable
            opacity: disabled ? (active ? 0.5 : 0.28) : pressed ? 0.65 : 1,
            transform: [{ scale }],
          }}
        >
          <Glyph
            d={kind === 'done' ? CHECK : CROSS}
            color={active ? palette.onState : palette.inkSoft}
            size={20}
            weight={2.8}
          />
        </Animated.View>
      )}
    </Pressable>
  );
}
