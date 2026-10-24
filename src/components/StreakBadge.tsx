import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { FIRE, FONT, Palette, RADIUS } from '../theme';

/** Current-streak counter for the header; at zero the same flame is drawn out, in dim ink */
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

/** Drawn, since the 🔥 emoji can't be shown unlit */
function Flame({ lit, color }: { lit: boolean; color: string }) {
  const body =
    'M12 2.2c.4 2.6 2 3.9 3.4 5.4A7.6 7.6 0 0 1 17.8 13a5.8 5.8 0 1 1-11.6 0c0-2 .9-3.5 1.9-4.7.2 1.2.8 2 1.6 2.3.7-3 .5-6 2.3-8.4z';
  const core = 'M12 12.1c1.6 1.5 2.5 2.7 2.5 4a2.5 2.5 0 0 1-5 0c0-1.3.9-2.5 2.5-4z';

  return (
    // the ink sits 1.5 units high, so the viewBox shifts to centre the drawing
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
        // the core punched out with even-odd, so it stays one flat tone
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
    // boxed to the flame's height so centring ignores Josefin's tall line box
    lineHeight: FLAME,
    includeFontPadding: false,
    letterSpacing: 0.3,
    // Josefin's digits still sit 1.5pt high; a transform doesn't disturb the centring
    transform: [{ translateY: 1.5 }],
  },
});
