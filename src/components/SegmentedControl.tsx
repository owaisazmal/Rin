import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { FONT, Palette, RADIUS, SCALE, useTheme } from '../theme';

/**
 * The segmented switch for short choices, such as the sign-in tabs and the theme.
 *
 * The filled state used to jump between options. Here it is a single pill that
 * slides, so the control shows the move it just made — and the labels cross-fade
 * between resting and filled ink underneath it.
 *
 * Everything runs on the native driver, which the theme switch in particular
 * needs: choosing a mode re-renders every screen in the app with a new palette,
 * and a JS-driven slide would stutter through exactly that frame.
 */

/** Inset of the pill inside its track, on all four sides. */
const PAD = 3;

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * Height comes from the label's vertical padding, which differs by where the
   * control sits — tight in the tracker's header row, roomier in a settings card.
   */
  verticalPadding?: number;
  /** the track fills its parent unless given a width here */
  style?: StyleProp<ViewStyle>;
}

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  verticalPadding = 8,
  style,
}: Props<T>) {
  const { palette } = useTheme();
  const styles = useMemo(
    () => makeStyles(palette, verticalPadding),
    [palette, verticalPadding]
  );

  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );

  // Position is held in whole options — 0, 1, 2 — and multiplied up to pixels
  // once the track has been measured, so the pill is right on the first frame
  // even before a layout pass has happened.
  const pos = useRef(new Animated.Value(selected)).current;
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    const anim = Animated.timing(pos, {
      toValue: selected,
      duration: 240,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [selected, pos]);

  const cell = trackWidth > 0 ? (trackWidth - PAD * 2) / options.length : 0;

  return (
    <View
      style={[styles.track, style]}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[
          styles.thumb,
          { width: cell, transform: [{ translateX: Animated.multiply(pos, cell) }] },
        ]}
      />

      {options.map((option, i) => {
        // 1 while this option is under the pill, falling off to either side, so
        // the two labels either side of a move cross-fade as it passes.
        const filled = pos.interpolate({
          inputRange: [i - 1, i, i + 1],
          outputRange: [0, 1, 0],
          extrapolate: 'clamp',
        });

        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: i === selected }}
            onPress={() => onChange(option.value)}
            style={styles.btn}
          >
            <Animated.Text
              style={[styles.label, { opacity: Animated.subtract(1, filled) }]}
              maxFontSizeMultiplier={SCALE.heading}
            >
              {option.label}
            </Animated.Text>
            {/* the filled copy, stacked exactly over the resting one */}
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, styles.center, { opacity: filled }]}
            >
              <Text
                style={[styles.label, styles.labelFilled]}
                maxFontSizeMultiplier={SCALE.heading}
              >
                {option.label}
              </Text>
            </Animated.View>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (p: Palette, verticalPadding: number) =>
  StyleSheet.create({
    track: {
      flexDirection: 'row',
      borderRadius: RADIUS.control,
      backgroundColor: p.chip,
      padding: PAD,
    },
    thumb: {
      position: 'absolute',
      left: PAD,
      top: PAD,
      bottom: PAD,
      borderRadius: RADIUS.chip,
      backgroundColor: p.accent,
    },
    btn: {
      // equal shares of the track, so the pill is one width wherever it lands
      flex: 1,
      paddingVertical: verticalPadding,
      alignItems: 'center',
      justifyContent: 'center',
    },
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      fontSize: 10,
      fontFamily: FONT.bold,
      letterSpacing: 1,
      color: p.inkSoft,
    },
    labelFilled: {
      color: p.onAccent,
    },
  });
