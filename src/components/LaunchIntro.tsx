import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg from 'react-native-svg';
import { FONT, Palette, useTheme } from '../theme';
import { FILLED } from '../logo';
import { MARK_CELLS, MARK_VIEWBOX, MarkCells, MarkTick } from './LogoMark';

/** The opening: the mark fills itself in, then the sheet lifts off the already-drawn app. */

type Curve = (t: number) => number;
type Span = readonly [start: number, end: number];

/** [start, end] in ms on the one clock */
const T = {
  pending: [0, 300] as Span,
  sector: (i: number): Span => [220 + i * 60, 220 + i * 60 + 300],
  tick: [860, 1160] as Span,
  sub: [570, 1010] as Span,
  title: [660, 1100] as Span,
  /** breathing room after the last element lands, then the sheet lifts */
  out: [1560, 1940] as Span,
};
/** everything has landed and nothing has started to leave */
const SETTLED = T.tick[1];
const END = T.out[1];
/** Reduce Motion can still take over up to here: nothing but the pending ring has moved */
const LATEST_SKIP = T.sector(0)[0];

const PENDING_CELLS = MARK_CELLS.filter((c) => c.state === 'empty');
const DAY_CELLS = Array.from({ length: FILLED }, (_, day) =>
  MARK_CELLS.filter((c) => c.day === day)
);

const easeOut = Easing.out(Easing.cubic);
const bloomOut = Easing.out(Easing.back(1.7));
const dropOut = Easing.out(Easing.back(2.2));
const lift = Easing.inOut(Easing.quad);

export default function LaunchIntro() {
  const { palette, mode } = useTheme();
  const { width, height } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const size = Math.round(Math.min(Math.max(Math.min(width, height) * 0.46, 150), 220));

  /** ms into the timeline: one native-driven value, so the busy JS thread can't stall the stagger */
  const clock = useRef(new Animated.Value(0)).current;
  const [gone, setGone] = useState(false);

  const reduce = useRef<boolean | null>(null);
  const armed = useRef(false);
  const startedAt = useRef<number | null>(null);
  const playing = useRef<Animated.CompositeAnimation | null>(null);
  const unmounted = useRef(false);

  /** run the clock from `from` to the end, replacing whatever was running */
  const play = useCallback(
    (from: number) => {
      playing.current?.stop();
      if (from > 0) clock.setValue(from);
      playing.current = Animated.timing(clock, {
        toValue: END,
        duration: END - from,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      playing.current.start(({ finished }) => {
        if (finished && !unmounted.current) setGone(true);
      });
    },
    [clock]
  );

  useEffect(() => {
    unmounted.current = false;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (unmounted.current) return;
      reduce.current = on;
      const since = startedAt.current === null ? null : Date.now() - startedAt.current;
      // Reduce Motion answered while only the pending ring has moved: skip the build
      if (on && since !== null && since <= LATEST_SKIP) play(SETTLED);
    });
    return () => {
      unmounted.current = true;
      playing.current?.stop();
    };
  }, [play]);

  // two frames first, so a launch stall can't eat the start of the run
  const begin = () => {
    if (armed.current) return;
    armed.current = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (unmounted.current) return;
        startedAt.current = Date.now();
        play(reduce.current ? SETTLED : 0);
      })
    );
  };

  /** `curve` over one span, sampled into clamped keyframes so overshoot survives */
  const over = ([start, end]: Span, curve: Curve, from: number, to: number, steps = 12) => {
    const inputRange: number[] = [];
    const outputRange: number[] = [];
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      inputRange.push(start + (end - start) * u);
      outputRange.push(from + (to - from) * curve(u));
    }
    return clock.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
  };
  const bloom = (span: Span, from: number, curve: Curve) => ({
    opacity: over(span, easeOut, 0, 1),
    transform: [{ scale: over(span, curve, from, 1) }],
  });
  const rise = (span: Span) => ({
    opacity: over(span, easeOut, 0, 1),
    transform: [{ translateY: over(span, easeOut, 10, 0) }],
  });

  if (gone) return null;

  return (
    <Animated.View
      style={[styles.sheet, { opacity: over(T.out, lift, 1, 0) }]}
      onLayout={begin}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        style={[
          styles.stage,
          // the sheet grows slightly as it goes, so the app reads as coming forward
          { transform: [{ scale: over(T.out, lift, 1, 1.06) }] },
        ]}
      >
        <View style={{ width: size, height: size }}>
          <Animated.View style={[styles.layer, { opacity: over(T.pending, easeOut, 0, 1) }]}>
            <Svg width={size} height={size} viewBox={MARK_VIEWBOX}>
              <MarkCells cells={PENDING_CELLS} palette={palette} mode={mode} />
            </Svg>
          </Animated.View>
          {DAY_CELLS.map((cells, day) => (
            <Animated.View key={day} style={[styles.layer, bloom(T.sector(day), 0.5, bloomOut)]}>
              <Svg width={size} height={size} viewBox={MARK_VIEWBOX}>
                <MarkCells cells={cells} palette={palette} mode={mode} />
              </Svg>
            </Animated.View>
          ))}
          <Animated.View style={[styles.layer, bloom(T.tick, 0.7, dropOut)]}>
            <Svg width={size} height={size} viewBox={MARK_VIEWBOX}>
              <MarkTick palette={palette} />
            </Svg>
          </Animated.View>
        </View>
        <Animated.Text style={[styles.sub, rise(T.sub)]}>MONTHLY</Animated.Text>
        <Animated.Text style={[styles.title, rise(T.title)]}>PLANNING</Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    sheet: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: p.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stage: {
      alignItems: 'center',
    },
    layer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    sub: {
      marginTop: 28,
      marginBottom: 4,
      fontSize: 12,
      fontFamily: FONT.bold,
      letterSpacing: 4,
      color: p.accent,
    },
    title: {
      fontSize: 36,
      fontFamily: FONT.bold,
      letterSpacing: 1.5,
      color: p.ink,
    },
  });
