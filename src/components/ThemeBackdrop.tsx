import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { VideoPlayer, VideoView, useVideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { COLUMN, Palette, ThemeMode, useTheme } from '../theme';

/** The theme's looping clip; its solid field is blended out with multiply (light) or screen (dark) */

// static requires, so Metro can bundle them
const CUTS = {
  dark: require('../../assets/video/dark.mp4'),
  light: require('../../assets/video/light.mp4'),
} as const;

// iOS won't blend video, so a View is blended onto it, with a bleed and edge fades
const IOS = Platform.OS === 'ios';

/** how far the iOS band dissolves back into the page; a short ramp still reads as an edge */
const FADE = 46;

/** Silent, looping, and never taking audio focus from the user's music */
export function quietLoop(p: VideoPlayer) {
  p.loop = true;
  p.muted = true;
  p.audioMixingMode = 'mixWithOthers';
  p.play();
}

export default function ThemeBackdrop() {
  const { mode, palette } = useTheme();
  // past the gutter and any room beside a capped column, so the band has no side edges
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const beside = 16 + Math.max(0, (width - insets.left - insets.right - COLUMN.maxWidth) / 2);
  const bleed = { left: -(beside + insets.left), right: -(beside + insets.right) };

  // lags the palette: swapping the clip in the theme's own commit stalled it ~2s on Android
  const [cut, setCut] = useState<ThemeMode>(mode);

  // built once; a changing source would tear the player down and rebuild it
  const first = useRef(mode).current;
  const player = useVideoPlayer(CUTS[first], quietLoop);

  useEffect(() => {
    if (cut === mode) return;
    let cancelled = false;
    // after the theme repaints; the timeout makes sure the clip still catches up
    const handle = requestIdleCallback(
      () => {
        player.replaceAsync(CUTS[mode]).then(() => {
          if (cancelled) return;
          player.play();
          // flip the blend only once the new clip is in
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
    <View style={[styles.fill, IOS && bleed]} pointerEvents="none">
      <VideoView
        style={IOS ? styles.fill : [styles.fill, blend]}
        player={player}
        // with the field blended away there is no letterbox, so never crop
        contentFit="contain"
        nativeControls={false}
        allowsPictureInPicture={false}
        // a SurfaceView can't be drawn into the offscreen layer a blend needs
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

/** Runs the page colour outwards from the iOS band's edge, so the aurora doesn't stop dead there */
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
  fade: { position: 'absolute', left: 0, right: 0, height: FADE },
  onLight: { mixBlendMode: 'multiply' },
  onDark: { mixBlendMode: 'screen' },
});
