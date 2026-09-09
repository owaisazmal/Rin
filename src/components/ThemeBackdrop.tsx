import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Palette, ThemeMode, useTheme } from '../theme';

/**
 * The theme's looping clip, blended into the page rather than sat on it.
 *
 * Both cuts are line art on a solid field — black on white, and colour on
 * black — so a blend mode drops that field out. `multiply` leaves white
 * untouched and keeps the dark strokes; `screen` is the mirror image.
 *
 * The two platforms need genuinely different setups to get there, so they are
 * configured separately below rather than sharing one compromise. The clips
 * themselves are shared, but only because they were re-encoded with pure
 * fields — something both platforms want and neither is harmed by.
 */

// Static paths, so Metro can find and bundle them — a computed path wouldn't
// be visible to the bundler.
const CUTS = {
  dark: require('../../assets/video/dark.mp4'),
  light: require('../../assets/video/light.mp4'),
} as const;

/**
 * Android blends the video's own layer, so the page — aurora and all — shows
 * straight through the field. Measured across the panel edge: no step at all.
 * Nothing else is needed there, and nothing added for iOS should change it.
 *
 * iOS refuses to blend a video layer. mixBlendMode on the VideoView renders a
 * solid white rectangle in light mode; on a View wrapping the VideoView, the
 * same rectangle. Both were tried and measured. What does work is blending a
 * plain View *downwards* onto the clip, which puts the field on the page's
 * exact background colour — but the clip stays opaque, so the aurora behind it
 * is missing inside the panel. Hence the bleed and the fades: no hard edge
 * left to notice.
 */
const IOS = Platform.OS === 'ios';

/**
 * How far the flat band dissolves back into the page, in points.
 *
 * Long. The fade can only live outside the clip's own box — where the overlay
 * stops being opaque, the raw white field shows through — so length is the one
 * dial available, and a short ramp still reads as an edge.
 */
const FADE = 46;

export default function ThemeBackdrop() {
  const { mode, palette } = useTheme();

  /**
   * The clip lags the palette on purpose.
   *
   * Changing the source releases one player and builds another, decoding a
   * different file. Measured on Android, doing that in the same commit as the
   * theme change held the repaint for ~1.5–2s — the toggle looked broken. This
   * lets the palette flip immediately and brings the clip along once the work
   * of switching is done.
   *
   * The blend follows this value rather than `mode`, so the pair never gets out
   * of step: for the moment in between, the outgoing clip is blended against a
   * page it now matches inversely and simply fades out of sight, which reads as
   * a crossfade rather than a glitch.
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
          // flip the blend only once the new clip is actually in, so the two
          // never disagree
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

  const blend = cut === 'dark' ? styles.onDark : styles.onLight;

  return (
    <View style={[styles.fill, IOS && styles.bleed]} pointerEvents="none">
      <VideoView
        style={IOS ? styles.fill : [styles.fill, blend]}
        player={player}
        // `contain`, not `cover`: with the field blended away there is no
        // letterbox to see, so fitting the whole drawing costs nothing and
        // stops the panel's shape from cropping it.
        contentFit="contain"
        nativeControls={false}
        allowsPictureInPicture={false}
        // Android's default SurfaceView is punched through the view hierarchy
        // and can't be drawn into the offscreen layer a blend mode needs — the
        // clip vanishes entirely. A TextureView composites normally.
        surfaceType="textureView"
      />

      {IOS ? (
        <>
          <View style={[styles.fill, { backgroundColor: palette.bg }, blend]} />
          <EdgeFade palette={palette} placement="top" />
          <EdgeFade palette={palette} placement="bottom" />
        </>
      ) : null}
    </View>
  );
}

/**
 * Dissolves the page into the flat band. It sits *outside* the panel, not
 * inside: the inside is already a uniform background colour, so a fade there
 * changes nothing — the visible seam is the aurora stopping dead at the panel's
 * edge. Running the background colour outwards from that edge, fading to
 * nothing, turns a 13-level step into a gradient with no boundary to find.
 */
function EdgeFade({ palette, placement }: { palette: Palette; placement: 'top' | 'bottom' }) {
  const id = `themeFade-${placement}`;
  const top = placement === 'top';
  return (
    <View
      style={[styles.fade, top ? { top: -FADE } : { bottom: -FADE }]}
      pointerEvents="none"
    >
      <Svg width="100%" height="100%">
        <Defs>
          {/* opaque against the panel, clear at the far end */}
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.bg} stopOpacity={top ? 0 : 1} />
            <Stop offset="1" stopColor={palette.bg} stopOpacity={top ? 1 : 0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  /** past the screen's 16pt gutter, so the band has no left or right edge */
  bleed: { left: -16, right: -16 },
  fade: { position: 'absolute', left: 0, right: 0, height: FADE },
  onLight: { mixBlendMode: 'multiply' },
  onDark: { mixBlendMode: 'screen' },
});
