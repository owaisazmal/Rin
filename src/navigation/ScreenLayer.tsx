import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';

/**
 * Screen transitions, built on the Animated API alone.
 *
 * The app has no navigation library — screens are booleans in the Navigator — so this
 * is the smallest thing that makes those booleans move: one shared 0→1 value per
 * layer, driving both the screen coming in and the screen it covers, plus an
 * edge swipe that scrubs the same value by hand.
 *
 * Every screen in this app is transparent so the drifting aurora reads through
 * it, which rules out the usual push where an opaque card slides over what's
 * behind it — two transparent screens overlapping would just show both at once.
 * So the outgoing screen fades as it recedes, and is gone by the time the
 * incoming one is halfway in. What's left behind the new screen is the aurora,
 * which is what the design wants there anyway.
 */

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

/**
 * Animate a screen in and out of the stack.
 *
 * `mounted` lags `visible` on the way out so the exit can play; `settledOpen`
 * lags it on the way in so the screen underneath stays rendered until it's
 * genuinely hidden.
 */
export function useScreenTransition(visible: boolean): ScreenTransition {
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = useState(visible);
  const [settledOpen, setSettledOpen] = useState(visible);
  // The first pass only records where we started; animating from that would
  // slide the opening screen in on cold start.
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

/**
 * A swipeable layer tells its ancestors it exists, so only the innermost one
 * answers an edge swipe.
 *
 * Touch capture runs from the outside in, so without this the sign-in screen
 * would take a swipe meant for the reset screen sitting on top of it and pop
 * both at once. Each layer counts the swipeable layers open inside it and
 * passes the count up; a layer with any of them declines the gesture.
 */
const DeeperLayers = createContext<(delta: number) => void>(() => {});

type Presentation = 'push' | 'fade';

interface LayerProps {
  /**
   * How this screen enters. Omit for the screen at the bottom of the stack,
   * which is always there and only ever recedes.
   */
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

/**
 * One screen in the stack: an absolutely-positioned layer that slides and fades
 * on the way in, recedes when something covers it, and can be swiped away from
 * the left edge.
 */
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

  const notifyAncestors = useContext(DeeperLayers);
  const deeper = useRef(0);
  const countDescendant = useCallback(
    (delta: number) => {
      deeper.current += delta;
      notifyAncestors(delta);
    },
    [notifyAncestors]
  );

  const swipeActive = canSwipe && !!transition?.visible;
  useEffect(() => {
    if (!swipeActive) return;
    notifyAncestors(1);
    return () => notifyAncestors(-1);
  }, [swipeActive, notifyAncestors]);

  const beginDrag = transition?.beginDrag;
  const endDrag = transition?.endDrag;

  const pan = useMemo(() => {
    if (!canSwipe || !progress || !beginDrag || !endDrag) return undefined;
    // Settle the drag wherever it was let go, then hand the screen back to the
    // caller — by the time the boolean flips, the screen is already off-stage,
    // so the exit animation it kicks off has nothing left to travel.
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
      // Capture, so a swipe that starts on the edge wins over any scroll view
      // it happens to land on. The conditions are narrow enough that nothing
      // but a deliberate back-swipe gets taken.
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        deeper.current === 0 &&
        g.x0 <= EDGE_WIDTH &&
        g.dx > 8 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
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
    // Animated nodes, kept loosely typed: the two composed here are whichever
    // of enter/cover this layer actually has.
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
      // A screen on its way out keeps drawing but stops answering: taps during
      // an exit belong to whatever is arriving.
      pointerEvents={transition && !transition.visible ? 'none' : 'auto'}
      {...(pan?.panHandlers ?? {})}
    >
      <DeeperLayers.Provider value={countDescendant}>{children}</DeeperLayers.Provider>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hidden: { display: 'none' },
});
