import {
  ReactNode,
  RefObject,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import KeyboardDoneBar from './KeyboardDoneBar';

/**
 * A page you can type on: the scroll view, the thing that gets out of the
 * keyboard's way, and the way out of an edit — as one piece.
 *
 * Both screens with fields on them were assembling this by hand, and the
 * arrangement is easier to get wrong than it looks. Three separate rules have
 * to hold at once:
 *
 *  1. The done bar has to be the last ordinary child of the avoiding view, for
 *     the reason set out in KeyboardDoneBar. That was a sentence in a comment
 *     asking two call sites to remember it. Here it is the shape of the file.
 *
 *  2. Nothing in React Native scrolls the field you just tapped into view — not
 *     on iOS. The avoiding view pads its own bottom by the keyboard's height,
 *     which shrinks the scroll view; but a scroll view that loses height keeps
 *     its scroll position, so the window onto the page loses its bottom and
 *     whatever was down there goes behind the keyboard, still focused, still
 *     taking what you type. That is what OBSERVATIONS did: last card but one on
 *     a long page, always in the part that disappears. iOS has a native fix,
 *     but it is switched on by a scroll view prop that also sets a bottom
 *     content inset of its own, which would be counted on top of the padding
 *     the avoiding view has already added. So the scrolling is done here.
 *
 *  3. Nothing should take the keyboard away except asking for it to go. See the
 *     two props at the bottom of this file.
 *
 * Everything below is one of those three. Nothing here knows the keyboard's
 * height, the safe area, or how tall the done bar is, and that is deliberate:
 * the scroll view's own laid-out height has all three subtracted from it
 * already, so measuring it is both simpler and harder to get wrong than adding
 * the pieces back up.
 */

/**
 * How much page to leave around the line being typed on.
 *
 * Landing the field flush against the bottom edge is technically visible and
 * reads as broken — there is no gap between what you are writing and the bar
 * under it, and nothing of the line below for context.
 */
const BREATHING_ROOM = 16;

/**
 * How often to ask where the page is scrolled to, in milliseconds.
 *
 * Deliberately lax, and deliberately not the obvious 16: React Native reads any
 * value of 16 or below as no throttling at all, which would put a JS callback
 * on every frame of every flick — on the one screen that is already animating a
 * chart and a drifting background, and which had no scroll listener of any kind
 * before this component existed. It can afford to be lax because the number is
 * only ever read while the page is standing still. The two end-of-scroll
 * handlers pin the resting position exactly; this is the backstop.
 */
const SCROLL_SAMPLE_MS = 250;

/**
 * Handed down rather than passed as a prop, because the fields are three and
 * four levels below the scroll view and none of the components in between have
 * any business carrying a scrolling concern through.
 */
const RevealOnFocus = createContext<() => void>(() => {});

/**
 * Give this to a `TextInput`'s `onFocus` and the page will make room for it.
 *
 * Needed in addition to the keyboard's own events because tapping from one
 * field straight to the next, with the keyboard already up, changes what has to
 * be visible without changing anything about the keyboard — no event, no layout
 * change, nothing else to listen to.
 *
 * Only useful to a field rendered *inside* a KeyboardSafeScroll. A screen that
 * renders the scroll view itself sits above the provider, so calling it there
 * returns the do-nothing default — and such a screen does not need it anyway,
 * because with a single field the keyboard's own event says everything.
 */
export function useRevealOnFocus(): () => void {
  return useContext(RevealOnFocus);
}

/** The iPad's Tab key types a tab into a multiline field; these fields each hold one line */
export const withoutTabs = (text: string) => text.replace(/\t/g, '');

interface Props extends ScrollViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export default function KeyboardSafeScroll({
  children,
  style,
  // Taken by name rather than left in the spread: every one of these is set
  // below, and a caller's copy would otherwise be dropped without a word.
  onLayout: alsoOnLayout,
  onContentSizeChange: alsoOnContentSizeChange,
  onScroll: alsoOnScroll,
  onScrollBeginDrag: alsoOnScrollBeginDrag,
  onScrollEndDrag: alsoOnScrollEndDrag,
  onMomentumScrollEnd: alsoOnMomentumScrollEnd,
  ...rest
}: Props) {
  const list = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  /**
   * The scroll view's own height — the window onto the page, not the page. The
   * avoiding view has already taken the keyboard out of it, and the done bar
   * has already taken its own height out of it, so this is the one number the
   * arithmetic needs.
   */
  const viewport = useRef(0);
  /** the page's full height; no ceiling to bump into until it has been measured */
  const pageHeight = useRef(Number.POSITIVE_INFINITY);
  /** kept in a ref, not state: nothing here should re-render the page */
  const offset = useRef(0);
  /**
   * Whether the reader has taken the page somewhere themselves since this edit
   * began.
   *
   * Scrolling while typing is now allowed — that is half of what this component
   * fixes — and the moment it is allowed it has to be respected. Without this,
   * anything that resizes the keyboard mid-edit (the emoji key, dictation, the
   * suggestion strip coming and going) fires a reveal and snaps the page back
   * to the field, throwing away whatever they had scrolled up to look at.
   */
  const strayed = useRef(false);

  const reveal = useCallback(() => {
    // Android already does this, a layer below, and does it better placed than
    // this could: ReactScrollView scrolls a newly focused child into view as
    // part of granting it focus. Running this as well would be a second scroll
    // chasing the first — and worse, an animated one, which on Android reports
    // a touch that interrupts it as the beginning of a drag. Since a drag there
    // still dismisses the keyboard, reveal would have quietly invented a new
    // way to lose an edit on the platform that never had this problem.
    if (Platform.OS !== 'ios') return;

    const field = TextInput.State.currentlyFocusedInput();
    const inner = content.current;
    const scroller = list.current;
    const height = viewport.current;
    if (!field || !inner || !scroller || height <= 0) return;

    // Measured against the content, not the screen, so the answer is a position
    // on the page and can be compared directly with where the page is scrolled
    // to. Measuring against the screen would drag the safe area and the
    // keyboard's own geometry back into this.
    field.measureLayout(
      inner,
      (_x, top, _width, lineHeight) => {
        const seen = offset.current;
        const bottom = top + lineHeight;

        let next: number | null = null;
        if (bottom + BREATHING_ROOM > seen + height) {
          // below the window: bring its bottom up to just above the edge
          next = bottom + BREATHING_ROOM - height;
        } else if (lineHeight + BREATHING_ROOM * 2 > height) {
          // Too tall to sit in the window with room at both ends. Nothing is
          // wrong yet — the branch above already decided the bottom is in view
          // — and the bottom is the end that matters, because that is where the
          // caret is. Without this the branch below would fire on the very next
          // reveal, scroll to show the top instead, and put the line being
          // typed on back under the keyboard; the reveal after that would put
          // it back. Neither position is wrong on its own, which is what makes
          // choosing between them every time so unpleasant to look at.
          return;
        } else if (top - BREATHING_ROOM < seen) {
          // Off the top, which is what tapping the visible sliver of a field
          // whose first line is already under the header does. Rarer than the
          // other way round, and the same complaint: you cannot see the line
          // you are typing on.
          next = top - BREATHING_ROOM;
        }
        // already in view — leave the page alone. Scrolling a field that can be
        // seen perfectly well is the other way to make this feel broken.
        if (next === null) return;

        // Never past either end. A field finishing within BREATHING_ROOM of the
        // bottom of the page would otherwise park the view in the empty space
        // past it, which iOS does not rubber-band back for a scroll it was told
        // to make.
        const furthest = Math.max(0, pageHeight.current - height);
        scroller.scrollTo({ y: Math.min(Math.max(0, next), furthest), animated: true });
      },
      // A row added a moment ago has no layout yet, so there is nothing to
      // reveal and nothing to say about it — the alternative is React Native's
      // own console warning. Worth knowing that this is not the only way out:
      // under the new renderer a measurement against a node that has already
      // been torn down returns having called neither of these.
      () => {}
    );
  }, []);

  /** the page moved on its own; honour a reader who has moved it themselves */
  const revealUnlessStrayed = useCallback(() => {
    if (!strayed.current) reveal();
  }, [reveal]);

  /**
   * A field took focus, which begins an edit — so wherever they had scrolled to
   * during the last one stops counting.
   *
   * Nothing is revealed here unless the keyboard is already up. With it still
   * closed the scroll view is at its full height and the field they just tapped
   * is on screen by definition, so any scroll started now would be aimed at
   * geometry that is about to change, and cancelled a frame later by the real
   * one. `keyboardDidShow` makes that one properly.
   */
  const revealOnFocus = useCallback(() => {
    strayed.current = false;
    if (Keyboard.isVisible()) reveal();
  }, [reveal]);

  /**
   * `keyboardDidShow`, not `willShow`, and a frame after it at that.
   *
   * The avoiding view is listening to the keyboard too — to `willShow` on iOS,
   * to this very event on Android — and it applies its padding through state,
   * asynchronously. It also mounts before this does, so on Android its listener
   * is called first and has still not resized anything by the time this one
   * runs. Measuring there would find the scroll view at its full height and
   * conclude the field was never hidden. Waiting for the next frame is waiting
   * for that commit, on both platforms and without guessing at a duration.
   *
   * The layout handler below is the deterministic half of this pair and would
   * very likely carry it alone; this is here because a resize that arrives late
   * should still be answered, and revealing twice costs nothing — the second
   * one finds the field already in view and leaves the page alone.
   *
   * A plain listener rather than the scroll view's own `onKeyboardDidShow`
   * prop: that prop exists so React Native's internal keyboard metrics are up
   * to date before it calls you, and nothing here reads them.
   */
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      requestAnimationFrame(revealUnlessStrayed);
    });
    return () => shown.remove();
  }, [revealUnlessStrayed]);

  /**
   * The keyboard is not the only thing that resizes the window. An emoji
   * keyboard, a suggestion strip, a paired hardware keyboard, rotation — all of
   * them change it without a `didShow`, and all of them can put the focused
   * field back underneath.
   */
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      alsoOnLayout?.(e);
      const height = e.nativeEvent.layout.height;
      if (height === viewport.current) return;
      viewport.current = height;
      revealUnlessStrayed();
    },
    [revealUnlessStrayed, alsoOnLayout]
  );

  /**
   * The page itself growing, which is what a `multiline` field does when the
   * line being typed wraps onto the next one. Without this the field is put in
   * view once, against the geometry of its first line, and then quietly grows
   * back down behind the keyboard while somebody writes into it.
   */
  const onContentSizeChange = useCallback(
    (width: number, height: number) => {
      alsoOnContentSizeChange?.(width, height);
      pageHeight.current = height;
      revealUnlessStrayed();
    },
    [revealUnlessStrayed, alsoOnContentSizeChange]
  );

  const note = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      note(e);
      alsoOnScroll?.(e);
    },
    [note, alsoOnScroll]
  );

  const onScrollBeginDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      note(e);
      strayed.current = true;
      alsoOnScrollBeginDrag?.(e);
    },
    [note, alsoOnScrollBeginDrag]
  );

  // Where the page actually comes to rest, which is the only moment that
  // matters: a flick's last throttled `onScroll` can land well short of the
  // end, and a scroll this component asked for reports itself here too.
  const onScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      note(e);
      alsoOnScrollEndDrag?.(e);
    },
    [note, alsoOnScrollEndDrag]
  );

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      note(e);
      alsoOnMomentumScrollEnd?.(e);
    },
    [note, alsoOnMomentumScrollEnd]
  );

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      {Platform.OS === 'android' && (
        // After Tab, Android gives focus to the first focusable view when an edit
        // ends. This is that view, so the next keys don't land in another field.
        <View
          focusable
          collapsable={false}
          importantForAccessibility="no"
          pointerEvents="none"
          style={styles.focusCatcher}
        />
      )}
      <ScrollView
        // Spread first, so nothing a caller passes can quietly take over one of
        // the props below — those are the whole point of this component.
        {...rest}
        ref={list}
        // React Native types this ref as never-null, which no ref ever is
        // before its first render; the cast is the whole of the difference.
        innerViewRef={content as RefObject<View>}
        style={[styles.flex, style]}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEventThrottle={SCROLL_SAMPLE_MS}
        /*
          On iOS these were the other way round, and between them they took the
          keyboard away for almost any touch: a tap anywhere that isn't a button
          — a card, a heading, the gap between two cards — and any drag at all.
          That was survivable while the only way out of an edit was to find one,
          and it stopped being survivable the moment a field could be hidden:
          the instinct when you can't see what you're typing is to scroll and
          look for it, and scrolling was one of the things that threw the edit
          away. `always` lets every tap through to whatever is under it without
          the scroll view first blurring the field — `handled` does not; it only
          stops the scroll view from *stealing* the tap, and still blurs on the
          way back up. `none` leaves dragging to mean dragging. What is left is
          the done bar and the return key, and both are deliberate.

          Android keeps what it shipped, and the split is not timidity — the two
          platforms do not run the same code here. `on-drag` on Android is React
          Native's own JS, added on purpose as a second way out; on iOS the same
          word is handed to UIKit, which resigns first responder a few points
          into *any* drag. And the trap that made dismissal hurt is an iOS trap
          to begin with: Android scrolls a newly focused child into view by
          itself, a layer below this one, so nobody there was ever hunting for a
          field they could not see.
        */
        keyboardShouldPersistTaps={Platform.OS === 'ios' ? 'always' : 'handled'}
        keyboardDismissMode={Platform.OS === 'ios' ? 'none' : 'on-drag'}
      >
        <RevealOnFocus.Provider value={revealOnFocus}>{children}</RevealOnFocus.Provider>
      </ScrollView>

      {/* Last child of the avoiding view on purpose — see the note in the component */}
      <KeyboardDoneBar />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  focusCatcher: {
    position: 'absolute',
    width: 1,
    height: 1,
  },
});
