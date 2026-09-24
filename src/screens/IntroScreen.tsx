import { ReactNode, useMemo, useRef, useState } from 'react';
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LogoMark from '../components/LogoMark';
import { COLUMN, FONT, Palette, RADIUS, useTheme } from '../theme';
import { FadingStreak, MarkAndFlame, OpenSource, ThinkingClip } from './introArt';

/**
 * What the app is for, before anyone is asked to sign in.
 *
 * Terms first: what the app does with your data is the one thing a stranger
 * has no way to verify from the outside, so it is answered before any pitch
 * rather than buried in a policy nobody opens. Then the case, in the order
 * someone actually meets it — the problem, the part that turns out to matter,
 * and what it costs them daily. Two of the illustrations are the app's own
 * grid and marks, so the pitch is showing the product rather than stock
 * artwork of it.
 */

type PageKind = 'open' | 'grid' | 'clip' | 'marks';

const PAGES: { kind: PageKind; eyebrow: string; title: string; body: string }[] = [
  {
    kind: 'open',
    eyebrow: 'BEFORE ANYTHING ELSE',
    title: 'Built for myself.\nOpen to everyone.',
    body:
      'No analytics, no trackers, no account needed — your habits sit on your phone and go nowhere else. The source is public and stays that way for as long as this app exists. If something here bothers you, read it, fork it, and build the version you would rather use.',
  },
  {
    kind: 'grid',
    eyebrow: 'THE PROBLEM',
    title: 'Habits don’t break.\nThey fade.',
    body:
      'Nobody quits on purpose. You miss a Tuesday, then most of a week, and by the time it registers there is nothing to point at. A grid remembers the things memory quietly rounds off.',
  },
  {
    kind: 'clip',
    eyebrow: 'THE USEFUL PART',
    title: 'The reason matters\nmore than the miss.',
    body:
      'A blank square tells you what happened, never why. Every month keeps room for notes, so “travel weeks are hard” stops being a vague feeling and turns into something you can plan around.',
  },
  {
    kind: 'marks',
    eyebrow: 'WHAT IT COSTS YOU',
    title: 'One mark a day.',
    body:
      'Tick it or cross it — that is the entire ritual. The year fills in behind you, the streak keeps its own count, and widgets put it on your home screen so remembering is not your job.',
  },
];

/** Page-indicator geometry: a dot, the air after it, and the capsule on top */
const DOT = 6;
const DOT_GAP = 12;
const PITCH = DOT + DOT_GAP;
const THUMB = 20;

export default function IntroScreen({ onDone }: { onDone: () => void }) {
  const { palette } = useTheme();
  const { width, height } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  /**
   * One box for all four illustrations, so the words under them don't move.
   *
   * They used to size themselves — 116pt of padlock, 100 of grid, 250 of clip,
   * 92 of marks — which put the eyebrow, the title and the body at a different
   * height on every page. Swiping shuffled the whole block up and down. Now the
   * box is fixed and each drawing fits itself into it.
   *
   * Taken from the window rather than written down, because the page is centred
   * and only scrolls as a last resort: on a short phone a fixed box plus five
   * lines of body copy is taller than the space there is.
   */
  const box = useMemo(
    () => ({
      width: Math.min(width, COLUMN.maxWidth) - 60, // the page's 30pt gutters
      height: Math.round(Math.min(280, Math.max(150, height * 0.28))),
    }),
    [width, height]
  );

  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;

  const last = page === PAGES.length - 1;

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const advance = () => {
    if (last) {
      onDone();
      return;
    }
    scrollRef.current?.scrollTo({ x: (page + 1) * width, animated: true });
    // paging animates, but the button label shouldn't lag a whole scroll behind
    setPage(page + 1);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <LogoMark size={30} />
        <Pressable
          hitSlop={12}
          onPress={onDone}
          style={({ pressed }) => [styles.skip, pressed && { opacity: 0.6 }]}
        >
          {/* holds its slot on the last page so the bar doesn't twitch */}
          <Text style={[styles.skipText, last && styles.skipSpent]}>SKIP</Text>
        </Pressable>
      </View>

      <Animated.ScrollView
        ref={scrollRef as never}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
        style={styles.flex}
      >
        {PAGES.map((p, i) => {
          /*
            The page already travels with the scroll; these move against it, so
            the drawing and the words arrive at slightly different speeds and
            the turn reads as depth rather than as one flat sheet sliding. The
            art is the further of the two, and neither fades to nothing —
            mid-swipe both pages are on screen at once, and a full cross-fade
            leaves that moment looking washed out.
          */
          const span = [(i - 1) * width, i * width, (i + 1) * width];
          const drift = (d: number) =>
            scrollX.interpolate({
              inputRange: span,
              outputRange: [d, 0, -d],
              extrapolate: 'clamp',
            });
          const opacity = scrollX.interpolate({
            inputRange: span,
            outputRange: [0.25, 1, 0.25],
            extrapolate: 'clamp',
          });
          return (
            <IntroPage key={p.kind} width={width} contentStyle={styles.page}>
              <Animated.View
                style={[styles.art, { height: box.height, opacity, transform: [{ translateX: drift(width * 0.22) }] }]}
              >
                {p.kind === 'open' ? <OpenSource palette={palette} box={box} /> : null}
                {p.kind === 'grid' ? <FadingStreak palette={palette} box={box} /> : null}
                {p.kind === 'clip' ? <ThinkingClip palette={palette} box={box} /> : null}
                {p.kind === 'marks' ? <MarkAndFlame palette={palette} box={box} /> : null}
              </Animated.View>
              <Animated.View
                style={{ opacity, transform: [{ translateX: drift(width * 0.08) }] }}
              >
                <Text style={styles.eyebrow}>{p.eyebrow}</Text>
                <Text style={styles.title}>{p.title}</Text>
                <Text style={styles.body}>{p.body}</Text>
              </Animated.View>
            </IntroPage>
          );
        })}
      </Animated.ScrollView>

      <View style={styles.footer}>
        {/*
          A capsule that slides along a row of dots, rather than a dot that
          stretches into one.

          Stretching was the old trick and it could not work: `scaleX` scales
          the rendered layer, corner radius and all, so a 7pt circle pulled out
          to 3.1× came out as an ellipse with 11pt ends — a lopsided blob, not a
          pill. Width would keep the ends round, but width is not a property the
          native driver can animate, and this is driven by the scroll offset on
          the native thread. So the thing that moves keeps one size and one
          shape, and only travels: `translateX` distorts nothing, and it tracks
          the finger continuously instead of snapping when the page lands.
        */}
        <View style={styles.dots}>
          <View style={[styles.track, { width: PAGES.length * PITCH - DOT_GAP }]}>
            {PAGES.map((p) => (
              <View key={p.kind} style={styles.dot} />
            ))}
            <Animated.View
              style={[
                styles.thumb,
                {
                  transform: [
                    {
                      translateX: scrollX.interpolate({
                        inputRange: [0, (PAGES.length - 1) * width],
                        outputRange: [0, (PAGES.length - 1) * PITCH],
                        extrapolate: 'clamp',
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>
        </View>

        <Pressable
          onPress={advance}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.primaryText}>{last ? 'GET STARTED' : 'NEXT'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/** One page: centred when it fits, scrollable when large text makes it taller than its room */
function IntroPage({
  width,
  contentStyle,
  children,
}: {
  width: number;
  contentStyle: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const [room, setRoom] = useState(0);
  const [need, setNeed] = useState(0);
  const overflows = room > 0 && need > room + 1;
  return (
    <View style={{ width }} onLayout={(e) => setRoom(e.nativeEvent.layout.height)}>
      <ScrollView
        // when cut off, stop short of the dots so the last line doesn't look like it runs under them
        style={overflows && { marginBottom: 16 }}
        contentContainerStyle={contentStyle}
        onContentSizeChange={(_, h) => setNeed(h)}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: 'transparent' },
    flex: { flex: 1 },
    topBar: {
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      marginTop: 4,
    },
    skip: { paddingVertical: 6, paddingHorizontal: 4 },
    skipText: {
      fontSize: 11,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.inkSoft,
    },
    skipSpent: { opacity: 0 },
    page: {
      ...COLUMN,
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 30,
    },
    art: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 34,
    },
    eyebrow: {
      fontSize: 10,
      fontFamily: FONT.bold,
      letterSpacing: 3,
      color: p.accent,
      marginBottom: 10,
    },
    title: {
      fontSize: 29,
      lineHeight: 35,
      fontFamily: FONT.bold,
      color: p.ink,
      marginBottom: 14,
      // Two lines' worth, because one page's title is a single line and the
      // rest are two. The block is centred, so without this that page's copy
      // sits lower than its neighbours' and the words step down as you swipe
      // onto it. The art box above holds its own height for the same reason.
      minHeight: 70,
    },
    body: {
      fontSize: 14,
      lineHeight: 22,
      fontFamily: FONT.regular,
      color: p.inkSoft,
      // Five lines, which is what the longest of the four runs to on a phone of
      // ordinary width. Same reason as the title above: the block is centred,
      // so a page whose copy runs a line longer than its neighbours' would lift
      // the whole thing and the words would step as you swipe onto it. On a
      // narrow enough screen a page can still outgrow this, and then it lifts —
      // but by the one line it has gained, not by the four the art used to.
      minHeight: 110,
    },
    footer: {
      ...COLUMN,
      paddingHorizontal: 30,
      paddingBottom: 12,
    },
    dots: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    track: {
      height: DOT,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    dot: {
      width: DOT,
      height: DOT,
      borderRadius: RADIUS.pill,
      backgroundColor: p.accent,
      opacity: 0.3,
    },
    thumb: {
      position: 'absolute',
      top: 0,
      // centred on the first dot, and from there it moves one pitch per page
      left: (DOT - THUMB) / 2,
      width: THUMB,
      height: DOT,
      borderRadius: RADIUS.pill,
      backgroundColor: p.accent,
    },
    primary: {
      height: 52,
      borderRadius: RADIUS.control,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: {
      fontSize: 12,
      fontFamily: FONT.bold,
      letterSpacing: 2,
      color: p.onAccent,
    },
  });
