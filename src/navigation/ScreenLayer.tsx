import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';

/** Screen transitions: one native 0→1 value per layer; screens are transparent, so a covered one fades out */

/** iOS-ish: quick to leave, long tail settling in. */
const OPEN_SPEC = { duration: 320, easing: Easing.bezier(0.32, 0.72, 0, 1) };
const CLOSE_SPEC = { duration: 260, easing: Easing.bezier(0.32, 0.72, 0, 1) };

/** How far the covered screen slides away, as a fraction of the screen width. */
const PARALLAX = 0.24;
/** Width of the left-hand strip that starts a swipe back. */
const EDGE_WIDTH = 36;
/** Drag this far, or flick this fast, and the screen goes rather than returns. */
const DISMISS_DISTANCE = 0.32;
const DISMISS_VELOCITY = 0.4;

export interface ScreenTransition {
  /** 0 = fully off-stage, 1 = fully covering. Native-driven. */
  progress: Animated.Value;
  /** what the caller asked for — the target, not the current position */
  visible: boolean;
  /** stays true through the exit animation, so the screen isn't torn out mid-slide */
  mounted: boolean;
  /** true only while fully open and standing still — the cue to drop the screen below */
  settledOpen: boolean;
  /** a swipe has taken hold of `progress`; whatever is underneath must come back */
  beginDrag: () => void;
  /** the swipe let go: `open` says which end it settled at */
  endDrag: (open: boolean) => void;
}

export function useScreenTransition(visible: boolean): ScreenTransition {
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = useState(visible);
  const [settledOpen, setSettledOpen] = useState(visible);
  // the first pass only records the start, so cold start doesn't slide in
  const armed = useRef(false);

  useEffect(() => {
    if (visible) setMounted(true);
    else setSettledOpen(false);

    if (!armed.current) {
      armed.current = true;
      progress.setValue(visible ? 1 : 0);
      return;
    }

    const anim = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      ...(visible ? OPEN_SPEC : CLOSE_SPEC),
    });
    anim.start(({ finished }) => {
      if (!finished) return;
      if (visible) setSettledOpen(true);
      else setMounted(false);
    });
    return () => anim.stop();
  }, [visible, progress]);

  const beginDrag = useCallback(() => setSettledOpen(false), []);
  const endDrag = useCallback((open: boolean) => setSettledOpen(open), []);

  return { progress, visible, mounted, settledOpen, beginDrag, endDrag };
}

type Presentation = 'push' | 'fade';

interface LayerProps {
  /** How this screen enters; omit for the bottom screen, which only ever recedes. */
  transition?: ScreenTransition;
  /** progress of the layer stacked directly on top, if there is one */
  coveredBy?: Animated.Value;
  presentation?: Presentation;
  /** called once the swipe-back has carried the screen off — pop it here */
  onSwipeBack?: () => void;
  swipeBackEnabled?: boolean;
  /** stop drawing entirely (the layer above has fully covered this one) */
  hidden?: boolean;
  children: ReactNode;
}

/** One screen in the stack: slides in, recedes when covered, swipes away from the left edge. */
export function ScreenLayer({
  transition,
  coveredBy,
  presentation = 'push',
  onSwipeBack,
  swipeBackEnabled = true,
  hidden = false,
  children,
}: LayerProps) {
  const { width } = useWindowDimensions();
  const progress = transition?.progress;
  const canSwipe = !!(transition && onSwipeBack && swipeBackEnabled);
  const beginDrag = transition?.beginDrag;
  const endDrag = transition?.endDrag;

  const pan = useMemo(() => {
    if (!canSwipe || !progress || !beginDrag || !endDrag) return undefined;
    // settle where it was let go; by the time the caller pops, it is already off-stage
    const settle = (open: boolean, velocity: number) => {
      Animated.spring(progress, {
        toValue: open ? 1 : 0,
        velocity: -velocity / width,
        useNativeDriver: true,
        bounciness: 0,
        speed: 14,
      }).start(({ finished }) => {
        if (!finished) return;
        endDrag(open);
        if (!open) onSwipeBack?.();
      });
    };

    return PanResponder.create({
      // capture, so an edge swipe wins over any scroll view it lands on
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        g.x0 <= EDGE_WIDTH && g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderGrant: () => beginDrag(),
      onPanResponderMove: (_e, g) => {
        const travelled = Math.max(0, g.dx) / width;
        progress.setValue(Math.max(0, 1 - travelled));
      },
      onPanResponderRelease: (_e, g) => {
        const goes = g.dx > width * DISMISS_DISTANCE || g.vx > DISMISS_VELOCITY;
        settle(!goes, g.vx);
      },
      onPanResponderTerminate: (_e, g) => settle(true, g.vx),
    });
  }, [canSwipe, progress, beginDrag, endDrag, onSwipeBack, width]);

  const style = useMemo(() => {
    // loosely typed: whichever of enter/cover this layer has gets composed
    const translates: any[] = [];
    const opacities: any[] = [];
    const transform: any[] = [];

    if (progress) {
      if (presentation === 'push') {
        translates.push(
          progress.interpolate({ inputRange: [0, 1], outputRange: [width, 0] })
        );
        // in fast, so the screen reads as solid well before it stops moving
        opacities.push(
          progress.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0.9, 1] })
        );
      } else {
        opacities.push(progress);
        transform.push({
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [14, 0],
          }),
        });
        transform.push({
          scale: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.98, 1],
          }),
        });
      }
    }

    if (coveredBy) {
      translates.push(
        coveredBy.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -width * PARALLAX],
        })
      );
      // clears out early: two transparent screens must not overlap for long
      opacities.push(
        coveredBy.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 0.06, 0] })
      );
      transform.push({
        scale: coveredBy.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] }),
      });
    }

    const translateX =
      translates.length === 2
        ? Animated.add(translates[0], translates[1])
        : translates[0];
    if (translateX !== undefined) transform.unshift({ translateX });

    const opacity =
      opacities.length === 2
        ? Animated.multiply(opacities[0], opacities[1])
        : opacities[0];

    return { opacity, transform };
  }, [progress, coveredBy, presentation, width]);

  if (transition && !transition.mounted) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, style, hidden && styles.hidden]}
      // taps during an exit belong to whatever is arriving
      pointerEvents={transition && !transition.visible ? 'none' : 'auto'}
      {...(pan?.panHandlers ?? {})}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hidden: { display: 'none' },
});
