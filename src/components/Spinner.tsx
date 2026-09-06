import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { FONT, useTheme } from '../theme';

/**
 * The waiting indicator, drawn rather than imported.
 *
 * `ActivityIndicator` renders the platform's own spinner, which arrives in the
 * platform's own colours and sits in this app about as comfortably as the system
 * date picker did. This is the same shape the tracker is built from: a ring with
 * an arc travelling round it, in the palette's accent over its faintest line.
 *
 * The rotation runs on the native driver, which matters here more than usual —
 * the thing it is covering for is a busy JS thread, and a spinner that stutters
 * whenever the work it represents is happening would be worse than none.
 */
export default function Spinner({ size = 28 }: { size?: number }) {
  const { palette: p } = useTheme();

  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const stroke = Math.max(2, size / 10);
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={{
        width: size,
        height: size,
        transform: [
          {
            rotate: spin.interpolate({
              inputRange: [0, 1],
              outputRange: ['0deg', '360deg'],
            }),
          },
        ],
      }}
    >
      <Svg width={size} height={size}>
        {/* the track it travels, so the gap reads as movement rather than a flicker */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={p.lineFaint}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={p.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * 0.28} ${circumference}`}
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

/** Spinner over a line of text, centred: the whole-page waiting state */
export function LoadingBlock({ label }: { label: string }) {
  const { palette } = useTheme();
  return (
    <View style={styles.block}>
      <Spinner size={30} />
      <Text style={[styles.label, { color: palette.inkSoft }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { alignItems: 'center', paddingVertical: 48, gap: 14 },
  label: { fontSize: 12, fontFamily: FONT.regular, letterSpacing: 0.3 },
});
