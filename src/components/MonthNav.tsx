import React, { useMemo } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { MONTH_NAMES } from '../dates';
import { FONT, Palette, RADIUS, cardSurface, useTheme } from '../theme';

/**
 * The month bar: an arrow either side of the name, and a swipe across the bar
 * that moves the way the months themselves do — left for the next one. The
 * label slides in from the side the month came from, on a value the caller
 * replays whenever the month changes.
 */
interface Props {
  year: number;
  /** 0-based */
  month: number;
  onShift: (delta: number) => void;
  /** 0 → 1 as the label arrives */
  anim: Animated.Value;
  /** -1 going back, +1 going forward, 0 when the month didn't move */
  enterFrom: number;
}

export default function MonthNav({ year, month, onShift, anim, enterFrom }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) > 44 || Math.abs(g.vx) > 0.35) onShift(g.dx < 0 ? 1 : -1);
        },
      }),
    [onShift]
  );

  return (
    <View style={styles.bar} {...swipe.panHandlers}>
      <Pressable
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Previous month"
        onPress={() => onShift(-1)}
        style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.navArrow}>‹</Text>
      </Pressable>
      <Animated.View
        style={[
          styles.labelBox,
          {
            opacity: anim,
            transform: [
              {
                translateX: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [enterFrom * 18, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Text style={styles.monthLabel}>{MONTH_NAMES[month]}</Text>
        <Text style={styles.yearLabel}>{year}</Text>
      </Animated.View>
      <Pressable
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Next month"
        onPress={() => onShift(1)}
        style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.navArrow}>›</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    bar: {
      ...cardSurface(p),
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
      paddingHorizontal: 10,
    },
    navBtn: {
      width: 34,
      height: 34,
      borderRadius: RADIUS.pill,
      backgroundColor: p.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navArrow: {
      fontSize: 20,
      fontFamily: FONT.bold,
      color: p.ink,
      lineHeight: 24,
    },
    labelBox: {
      alignItems: 'center',
    },
    monthLabel: {
      fontSize: 16,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.ink,
    },
    yearLabel: {
      fontSize: 11,
      fontFamily: FONT.semibold,
      letterSpacing: 1,
      color: p.inkSoft,
    },
  });
