import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { BRAND, FIRE, Palette, RADIUS } from '../theme';

/**
 * The four intro illustrations.
 *
 * Three are drawn in the app's own vocabulary — the open lock, the year grid
 * and the marks — rather than stock artwork, so the intro is showing the thing
 * it describes. The fourth is the desk clip.
 */

/** An open padlock — nothing here is locked away, including the source */
export function OpenSource({ palette: p }: { palette: Palette }) {
  return (
    <Svg width={104} height={116} viewBox="0 0 52 58">
      {/*
        Shackle swung clear on the right. It ends at the top of the arc rather
        than dropping back towards the body: a couple of units of gap reads as
        a closed lock at this size, and the whole point is that it is open.
      */}
      <Path
        d="M17 24V15a9 9 0 0 1 18 0"
        stroke={p.accent}
        strokeWidth={3.4}
        strokeLinecap="round"
        fill="none"
      />
      <Rect
        x={6}
        y={24}
        width={40}
        height={30}
        rx={8}
        fill={p.accentSoft}
        stroke={p.accent}
        strokeWidth={3}
      />
      {/* keyhole drawn as < > — the thing you're free to look inside is code */}
      <Path
        d="M22 34.5 L18 39 L22 43.5 M30 34.5 L34 39 L30 43.5"
        stroke={p.accent}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** A run of check-ins that trails off into nothing: the fade this app is for */
export function FadingStreak({ palette: p }: { palette: Palette }) {
  const cell = 15;
  const gap = 5;
  const cols = 12;
  const rows = 5;
  return (
    <Svg width={cols * (cell + gap)} height={rows * (cell + gap)}>
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((_, c) => {
          // solid at the left, thinning through the middle, gone by the right
          const density = 1 - c / (cols - 1);
          const on = (c * 7 + r * 3) % 10 < density * 11;
          const level = on ? p.ghLevels[Math.min(4, 1 + Math.floor(density * 3.4))] : p.cellEmpty;
          return (
            <Rect
              key={`${r}-${c}`}
              x={c * (cell + gap)}
              y={r * (cell + gap)}
              width={cell}
              height={cell}
              rx={4}
              fill={level}
            />
          );
        })
      )}
    </Svg>
  );
}

/** Looping desk clip — someone mid-thought, which is the page's whole point */
export function ThinkingClip({ palette: p }: { palette: Palette }) {
  const styles = useMemo(() => makeClipStyles(p), [p]);

  const player = useVideoPlayer(
    require('../../assets/video/light.mp4'),
    (v) => {
      v.loop = true;
      // the file carries an audio track; an illustration must never make a sound
      v.muted = true;
      // ...nor behave like media. On the default the Android player takes audio
      // focus and the media-button session, so a decorative loop would pause
      // the user's music and swallow the play button on their headphones.
      v.audioMixingMode = 'mixWithOthers';
      v.play();
    }
  );

  return (
    // The clip is black line art on white, so it keeps its own light plate in
    // both themes — in dark mode it reads as a print pinned to the page rather
    // than a white rectangle that missed the memo.
    <View style={styles.plate} pointerEvents="none">
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
      />
      <View style={styles.warm} />
    </View>
  );
}

/** The daily ritual: one mark, and the flame it keeps alight */
export function MarkAndFlame({ palette: p }: { palette: Palette }) {
  return (
    <Svg width={196} height={92} viewBox="0 0 196 92">
      <Rect x={6} y={20} width={52} height={52} rx={12} fill={p.doneSoft} />
      <Path
        d="M20 46.5 L29 55.5 L45 36.5"
        stroke={p.done}
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Rect x={72} y={20} width={52} height={52} rx={12} fill={p.missedSoft} />
      <Path
        d="M87 35 L109 57 M109 35 L87 57"
        stroke={p.missed}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />
      <Circle cx={164} cy={46} r={26} fill={p.accentSoft} />
      {/*
        The flame's ink runs y 28.9–41, so it is both small for this circle and
        sits well above its centre. Scaled to fill the chip and shifted so the
        drawing — not its bounding box — lands on (164, 46).
      */}
      <G transform="translate(-164 -23.9) scale(2)">
        <Path
          d="M164 28.9c.3 1.9 1.5 2.8 2.5 3.9a5.6 5.6 0 0 1 1.8 3.9 4.3 4.3 0 1 1-8.6 0c0-1.5.7-2.6 1.4-3.5.15.9.6 1.5 1.2 1.7.5-2.2.4-4.4 1.7-6z
             M164 36.2c1.2 1.1 1.9 2 1.9 3a1.9 1.9 0 0 1-3.8 0c0-1 .7-1.9 1.9-3z"
          fillRule="evenodd"
          fill={FIRE.bodyBottom}
        />
      </G>
    </Svg>
  );
}

const makeClipStyles = (p: Palette) =>
  StyleSheet.create({
    plate: {
      width: '100%',
      // the clip is 4:3; matching it means no letterboxed seam inside the plate
      aspectRatio: 4 / 3,
      borderRadius: RADIUS.card,
      borderWidth: 1,
      borderColor: p.lineFaint,
      overflow: 'hidden',
      backgroundColor: BRAND.ivory,
    },
    warm: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      // knocks the clip's pure white back towards the brand ivory, so the plate
      // and the footage read as one surface
      backgroundColor: 'rgba(255,255,227,0.30)',
    },
  });
