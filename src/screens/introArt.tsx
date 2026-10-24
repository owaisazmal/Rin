import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { quietLoop } from '../components/ThemeBackdrop';
import { FIRE, Palette, RADIUS } from '../theme';

/** The four intro illustrations, each sized into the same box so the words below never move */

/** The size the art may occupy — the page's column, and the box's height. */
export interface ArtBox {
  width: number;
  height: number;
}

/** The largest rectangle of `ratio` (width over height) that fits in the box */
function fit(box: ArtBox, ratio: number): { width: number; height: number } {
  const byHeight = box.height * ratio;
  return byHeight <= box.width
    ? { width: byHeight, height: box.height }
    : { width: box.width, height: box.width / ratio };
}

/** An open padlock — nothing here is locked away, including the source */
export function OpenSource({ palette: p, box }: { palette: Palette; box: ArtBox }) {
  // held back from full height, or it reads as a blown-up icon
  const size = fit({ width: box.width, height: box.height * 0.84 }, 52 / 58);
  return (
    <Svg width={size.width} height={size.height} viewBox="0 0 52 58">
      {/* the shackle stops at the top of its arc: a small gap would read as closed */}
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
export function FadingStreak({ palette: p, box }: { palette: Palette; box: ArtBox }) {
  const cols = 12;
  const rows = 5;
  // cell and gap in the year grid's own 3:1 proportion
  const step = Math.min(box.width / cols, box.height / rows);
  const gap = step * 0.25;
  const cell = step - gap;
  return (
    <Svg width={cols * step - gap} height={rows * step - gap}>
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((_, c) => {
          // solid at the left, thinning through the middle, gone by the right
          const density = 1 - c / (cols - 1);
          const on = (c * 7 + r * 3) % 10 < density * 11;
          const level = on ? p.ghLevels[Math.min(4, 1 + Math.floor(density * 3.4))] : p.cellEmpty;
          return (
            <Rect
              key={`${r}-${c}`}
              x={c * step}
              y={r * step}
              width={cell}
              height={cell}
              rx={cell * 0.27}
              fill={level}
            />
          );
        })
      )}
    </Svg>
  );
}

/** `assets/video/light.mp4` is 468×750; the plate takes the clip's shape */
const CLIP_RATIO = 468 / 750;

/** Looping desk clip — someone mid-thought, which is the page's whole point */
export function ThinkingClip({ palette: p, box }: { palette: Palette; box: ArtBox }) {
  const styles = useMemo(() => makeClipStyles(p), [p]);
  const size = fit(box, CLIP_RATIO);

  const player = useVideoPlayer(require('../../assets/video/light.mp4'), quietLoop);

  return (
    // black line art on white, so it keeps a light plate in both themes
    <View style={[styles.plate, size]} pointerEvents="none">
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="contain"
        nativeControls={false}
        allowsPictureInPicture={false}
      />
      <View style={styles.warm} />
    </View>
  );
}

/** The daily ritual: one mark, and the flame it keeps alight */
export function MarkAndFlame({ palette: p, box }: { palette: Palette; box: ArtBox }) {
  const size = fit(box, 196 / 92);
  return (
    <Svg width={size.width} height={size.height} viewBox="0 0 196 92">
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
      {/* scaled up and shifted so the flame's ink, not its box, centres on (164, 46) */}
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
      borderRadius: RADIUS.card,
      borderWidth: 1,
      borderColor: p.lineFaint,
      overflow: 'hidden',
      // pure white like the clip's field, so any letterbox bar matches it
      backgroundColor: '#FFFFFF',
    },
    warm: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      // warms the plate and the footage together towards the brand ivory
      backgroundColor: 'rgba(255,255,227,0.30)',
    },
  });
