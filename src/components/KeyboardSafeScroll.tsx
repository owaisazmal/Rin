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

/** A page you can type on: scroll view, keyboard avoidance and done bar in one; on iOS it also scrolls the focused field into view. */

/** page left around the line being typed on */
const BREATHING_ROOM = 16;

/** lax on purpose: 16 or below means every frame, and the offset is only read at rest */
const SCROLL_SAMPLE_MS = 250;

const RevealOnFocus = createContext<() => void>(() => {});

/** For a field's onFocus inside a KeyboardSafeScroll: hopping fields with the keyboard up fires no keyboard event */
export function useRevealOnFocus(): () => void {
  return useContext(RevealOnFocus);
}

/** The iPad's Tab key types a tab into a multiline field; these fields each hold one line */
export const withoutTabs = (text: string) => text.replace(/\t/g, '');

type Handled =
  | 'onLayout'
  | 'onContentSizeChange'
  | 'onScroll'
  | 'onScrollBeginDrag'
  | 'onScrollEndDrag'
  | 'onMomentumScrollEnd';

interface Props extends Omit<ScrollViewProps, Handled> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** A sheet over this page has the keyboard: no padding and no done bar here. */
  keyboardElsewhere?: boolean;
}

export default function KeyboardSafeScroll({
  children,
  style,
  keyboardElsewhere = false,
  ...rest
}: Props) {
  const list = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  /** the scroll view's height, with the keyboard and done bar already taken out */
  const viewport = useRef(0);
  const pageHeight = useRef(Number.POSITIVE_INFINITY);
  const offset = useRef(0);
  /** the reader scrolled during this edit; don't snap them back to the field */
  const strayed = useRef(false);

  const reveal = useCallback(() => {
    // Android already does this; a second scroll there reads a touch as a drag and dismisses
    if (Platform.OS !== 'ios') return;

    const field = TextInput.State.currentlyFocusedInput();
    const inner = content.current;
    const scroller = list.current;
    const height = viewport.current;
    if (!field || !inner || !scroller || height <= 0) return;

    // measured against the content, so it compares directly with the scroll offset
    field.measureLayout(
      inner,
      (_x, top, _width, lineHeight) => {
        const seen = offset.current;
        const bottom = top + lineHeight;

        let next: number | null = null;
        if (bottom + BREATHING_ROOM > seen + height) {
          next = bottom + BREATHING_ROOM - height;
        } else if (lineHeight + BREATHING_ROOM * 2 > height) {
          // too tall to fit with room at both ends: keep the bottom, where the caret is
          return;
        } else if (top - BREATHING_ROOM < seen) {
          next = top - BREATHING_ROOM;
        }
        if (next === null) return;

        const furthest = Math.max(0, pageHeight.current - height);
        scroller.scrollTo({ y: Math.min(Math.max(0, next), furthest), animated: true });
      },
      // a row added a moment ago has no layout yet
      () => {}
    );
  }, []);

  const revealUnlessStrayed = useCallback(() => {
    if (!strayed.current) reveal();
  }, [reveal]);

  // with the keyboard still closed, keyboardDidShow reveals once the page has shrunk
  const revealOnFocus = useCallback(() => {
    strayed.current = false;
    if (Keyboard.isVisible()) reveal();
  }, [reveal]);

  // a frame after didShow, once the avoiding view has committed its padding
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      requestAnimationFrame(revealUnlessStrayed);
    });
    return () => shown.remove();
  }, [revealUnlessStrayed]);

  // the emoji keyboard, a suggestion strip or rotation resize the window too
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const height = e.nativeEvent.layout.height;
      if (height === viewport.current) return;
      viewport.current = height;
      revealUnlessStrayed();
    },
    [revealUnlessStrayed]
  );

  // a multiline field growing as its text wraps
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      pageHeight.current = height;
      revealUnlessStrayed();
    },
    [revealUnlessStrayed]
  );

  const note = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);

  const onScrollBeginDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      note(e);
      strayed.current = true;
    },
    [note]
  );

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding" enabled={!keyboardElsewhere}>
      {Platform.OS === 'android' && (
        // after Tab, Android focuses the first focusable view; this, not another field
        <View
          focusable
          collapsable={false}
          importantForAccessibility="no"
          pointerEvents="none"
          style={styles.focusCatcher}
        />
      )}
      <ScrollView
        {...rest}
        ref={list}
        // React Native types this ref as never-null
        innerViewRef={content as RefObject<View>}
        style={[styles.flex, style]}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        onScroll={note}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={note}
        onMomentumScrollEnd={note}
        scrollEventThrottle={SCROLL_SAMPLE_MS}
        // on iOS only the done bar and Return end an edit; UIKit's on-drag resigns on any drag
        keyboardShouldPersistTaps={Platform.OS === 'ios' ? 'always' : 'handled'}
        keyboardDismissMode={Platform.OS === 'ios' ? 'none' : 'on-drag'}
      >
        <RevealOnFocus.Provider value={revealOnFocus}>{children}</RevealOnFocus.Provider>
      </ScrollView>

      {/* the avoiding view's last ordinary child lands right on top of the keyboard */}
      {keyboardElsewhere ? null : <KeyboardDoneBar />}
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
