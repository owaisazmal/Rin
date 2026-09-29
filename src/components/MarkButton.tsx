import React, { useEffect, useRef } from 'react';
import { Animated, Pressable } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Palette, RADIUS } from '../theme';

/**
 * Done / missed toggle.
 *
 * The glyphs are stroked SVG paths rather than the "✓" and "✗" text characters —
 * those render at whatever weight and baseline the system font decides on, which
 * is what made the old buttons look uneven.
 */

const SIZE = 40;

function CheckGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path
        d="M5 12.8 L9.7 17.5 L19 6.8"
        stroke={color}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function CrossGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path
        d="M7 7 L17 17 M17 7 L7 17"
        stroke={color}
        strokeWidth={2.8}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

export default function MarkButton({
  kind,
  active,
  disabled = false,
  palette,
  onPress,
}: {
  kind: 'done' | 'missed';
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
  const Glyph = kind === 'done' ? CheckGlyph : CrossGlyph;

  return (
    <Pressable hitSlop={6} onPress={onPress} disabled={disabled}>
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
          <Glyph color={active ? palette.onState : palette.inkSoft} />
        </Animated.View>
      )}
    </Pressable>
  );
}
