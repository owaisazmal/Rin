import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { ThemeMode, useTheme } from '../theme';

/**
 * The theme's looping clip.
 *
 * Both cuts are line art on a solid field, and that field is encoded as the
 * exact colour of the page behind it — ivory on the light cut, charcoal on the
 * dark one. So there is nothing to hide: the video's own ground is the page's
 * ground, and only the drawing reads.
 *
 * It used to arrive as line art on pure white and pure black, dropped out with
 * `mixBlendMode` — `multiply` on light, `screen` on dark. That worked until a
 * finger touched the screen: Android abandons the offscreen layer a blend mode
 * needs while a scroll is in flight, and the raw field snapped back as a hard
 * black rectangle for the length of the gesture. A hardware layer did not hold
 * it either. Matching the colours in the file removes the blend, and with it
 * the iOS overlay and edge fades that existed only because iOS refuses to blend
 * a video layer at all.
 */

// Static paths, so Metro can find and bundle them — a computed path wouldn't
// be visible to the bundler.
const CUTS = {
  dark: require('../../assets/video/dark.mp4'),
  light: require('../../assets/video/light.mp4'),
} as const;

export default function ThemeBackdrop() {
  const { mode } = useTheme();

  /**
   * The clip lags the palette on purpose.
   *
   * Changing the source releases one player and builds another, decoding a
   * different file. Measured on Android, doing that in the same commit as the
   * theme change held the repaint for ~1.5–2s and the toggle looked broken.
   * This lets the palette flip immediately and brings the clip along once the
   * work of switching is done.
   */
  const [cut, setCut] = useState<ThemeMode>(mode);

  // Built once, from whichever cut was current at mount. Passing a changing
  // source to useVideoPlayer is what tore the player down and built a new one.
  const first = useRef(mode).current;
  const player = useVideoPlayer(CUTS[first], (p) => {
    p.loop = true;
    // both files carry an audio track; decoration must never make a sound
    p.muted = true;
    // ...and must never behave like media, either. Left on the default the
    // Android player takes audio focus and claims the media-button session,
    // so a decorative loop would pause the user's music and swallow the play
    // button on their headphones.
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });

  useEffect(() => {
    if (cut === mode) return;
    let cancelled = false;
    // Wait for the theme's own repaint to land, then hand the same player a new
    // source. replaceAsync loads off the UI thread — expo-video documents it as
    // the way to avoid exactly this stall. The timeout is a floor: if the app
    // never goes idle, the clip should still catch up rather than never swap.
    const handle = requestIdleCallback(
      () => {
        player.replaceAsync(CUTS[mode]).then(() => {
          if (cancelled) return;
          player.play();
          setCut(mode);
        });
      },
      { timeout: 400 }
    );
    return () => {
      cancelled = true;
      cancelIdleCallback(handle);
    };
  }, [mode, cut, player]);

  return (
    <View style={styles.fill} pointerEvents="none">
      <VideoView
        style={styles.fill}
        player={player}
        // `contain`, not `cover`: the field is the page's own colour, so there
        // is no letterbox to see and fitting the whole drawing costs nothing.
        contentFit="contain"
        nativeControls={false}
        allowsPictureInPicture={false}
        // A SurfaceView is punched through the view hierarchy and does not move
        // in step with the scroller it sits in. A TextureView composites like
        // any other view, which is what a decorative layer inside a scrolling
        // page needs.
        surfaceType="textureView"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
