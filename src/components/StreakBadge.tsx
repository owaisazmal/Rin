import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { FIRE, FONT, Palette, RADIUS } from '../theme';

/**
 * Current-streak counter for the header.
 *
 * A live streak sets the flame alight — real fire colours, orange at the tip
 * over a yellow core. At zero the identical silhouette is drawn in the palette's
 * own ink and dimmed, so the badge reads as the same flame gone out rather than
 * a different icon.
 */
export default function StreakBadge({
  days,
  palette: p,
}: {
  days: number;
  palette: Palette;
}) {
  const lit = days > 0;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={
        lit ? `Streak active, ${days} ${days === 1 ? 'day' : 'days'}` : 'No active streak'
      }
      style={[styles.pill, { borderColor: p.lineFaint, backgroundColor: p.card }]}
    >
      <Flame lit={lit} color={p.ink} />
      {/* capped so the header still fits at the largest text sizes; the label carries the number */}
      <Text
        maxFontSizeMultiplier={2}
        style={[styles.count, { color: p.ink, opacity: lit ? 1 : DIM }]}
      >
        {days}
      </Text>
    </View>
  );
}

/** How far the flame and its count fade once the streak is broken */
const DIM = 0.45;

/**
 * Drawn rather than typed as "🔥" so the unlit state is possible at all — the
 * emoji is always alight, and always the same colour, on both platforms.
 */
function Flame({ lit, color }: { lit: boolean; color: string }) {
  const body =
    'M12 2.2c.4 2.6 2 3.9 3.4 5.4A7.6 7.6 0 0 1 17.8 13a5.8 5.8 0 1 1-11.6 0c0-2 .9-3.5 1.9-4.7.2 1.2.8 2 1.6 2.3.7-3 .5-6 2.3-8.4z';
  const core = 'M12 12.1c1.6 1.5 2.5 2.7 2.5 4a2.5 2.5 0 0 1-5 0c0-1.3.9-2.5 2.5-4z';

  return (
    // The flame's ink runs y 2.2–18.8, so it sits 1.5 units high in a square
    // viewBox. Shifting the window up by that much centres the drawing itself
    // rather than the empty box around it.
    <Svg width={FLAME} height={FLAME} viewBox="0 -1.5 24 24">
      {lit ? (
        <>
          <Defs>
            <LinearGradient id="streakBody" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={FIRE.bodyTop} />
              <Stop offset="1" stopColor={FIRE.bodyBottom} />
            </LinearGradient>
            <LinearGradient id="streakCore" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={FIRE.coreTop} />
              <Stop offset="1" stopColor={FIRE.coreBottom} />
            </LinearGradient>
          </Defs>
          <Path d={body} fill="url(#streakBody)" />
          <Path d={core} fill="url(#streakCore)" />
        </>
      ) : (
        // Same two paths, but the core is punched out with even-odd winding
        // instead of painted — one flat tone stays honestly monochrome.
        <Path d={`${body} ${core}`} fillRule="evenodd" fill={color} fillOpacity={DIM} />
      )}
    </Svg>
  );
}

const FLAME = 19;

const styles = StyleSheet.create({
  pill: {
    height: 44,
    minWidth: 44,
    paddingHorizontal: 11,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  count: {
    fontFamily: FONT.bold,
    fontSize: 16,
    // Boxed to the flame's own height and stripped of Android's extra font
    // padding, so `alignItems: center` centres the glyphs against the flame
    // rather than against Josefin's tall, top-heavy line box.
    lineHeight: FLAME,
    includeFontPadding: false,
    letterSpacing: 0.3,
    // Josefin still lands its digits 1.5pt high inside that box — measured
    // identically on both platforms. Nudged by transform, not margin, so the
    // correction doesn't feed back into the row's own centring.
    transform: [{ translateY: 1.5 }],
  },
});
