import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from '../theme';

/**
 * Slow-drifting soft blobs behind the whole app.
 *
 * Every blob picks a fresh random direction, distance and duration for each leg
 * of its journey, so the motion never settles into a visible loop. Only opacity
 * and transforms animate, which keeps the whole thing on the native driver.
 */

interface BlobSpec {
  key: string;
  /** diameter, as a fraction of the shorter screen edge */
  size: number;
  /** resting top-left corner, as a fraction of the screen box (may be negative to bleed off-screen) */
  x: number;
  y: number;
  /** how far it may wander from rest, as a fraction of the shorter screen edge */
  travel: number;
  opacity: number;
}

/** Index into palette.blobs matches the spec order; the last one is the accent glow. */
const SPECS: BlobSpec[] = [
  { key: 'a', size: 1.35, x: -0.35, y: -0.12, travel: 0.26, opacity: 0.95 },
  { key: 'b', size: 1.05, x: 0.42, y: 0.08, travel: 0.3, opacity: 0.85 },
  { key: 'c', size: 1.5, x: -0.2, y: 0.42, travel: 0.24, opacity: 0.9 },
  { key: 'd', size: 0.9, x: 0.45, y: 0.68, travel: 0.32, opacity: 0.8 },
  { key: 'e', size: 0.8, x: -0.05, y: 0.18, travel: 0.38, opacity: 0.14 },
];

const MIN_LEG_MS = 9000;
const MAX_LEG_MS = 19000;

function DriftBlob({
  spec,
  color,
  strength,
  unit,
  width,
  height,
}: {
  spec: BlobSpec;
  color: string;
  /** scales the blob back so a full-strength brand colour still reads as a wash */
  strength: number;
  unit: number;
  width: number;
  height: number;
}) {
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  const diameter = spec.size * unit;
  const travel = spec.travel * unit;

  useEffect(() => {
    let alive = true;

    // Each leg eases out from wherever the previous one stopped, so the blob
    // wanders continuously instead of snapping back to a home position.
    const leg = () => {
      if (!alive) return;
      const angle = Math.random() * Math.PI * 2;
      const distance = travel * (0.3 + Math.random() * 0.7);
      const duration = MIN_LEG_MS + Math.random() * (MAX_LEG_MS - MIN_LEG_MS);
      const common = {
        duration,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      };
      Animated.parallel([
        Animated.timing(tx, { ...common, toValue: Math.cos(angle) * distance }),
        Animated.timing(ty, { ...common, toValue: Math.sin(angle) * distance }),
        Animated.timing(scale, { ...common, toValue: 0.85 + Math.random() * 0.45 }),
      ]).start(({ finished }) => {
        if (finished) leg();
      });
    };

    leg();
    return () => {
      alive = false;
      tx.stopAnimation();
      ty.stopAnimation();
      scale.stopAnimation();
    };
  }, [travel, tx, ty, scale]);

  const gradientId = `aurora-${spec.key}`;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: spec.x * width,
        top: spec.y * height,
        width: diameter,
        height: diameter,
        opacity: spec.opacity * strength,
        transform: [{ translateX: tx }, { translateY: ty }, { scale }],
      }}
    >
      <Svg width={diameter} height={diameter}>
        <Defs>
          {/*
           * The radius reaches the square's corner, not its edge — so the ramp
           * is still at roughly a quarter alpha where the circle below clips
           * it, and every blob keeps a faint rim.
           *
           * That rim is the whole effect. `r="50%"` lands the transparent stop
           * exactly on the rim instead, and the blobs stop reading as circles
           * at all: they blur out into one formless wash, and a third of the
           * spread goes with them. Corner distance is `√2 / 2` of the box, so
           * the gradient has to be given the radius outright.
           */}
          <RadialGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            cx={diameter / 2}
            cy={diameter / 2}
            r={(diameter / 2) * Math.SQRT2}
          >
            <Stop offset="0%" stopColor={color} stopOpacity={1} />
            <Stop offset="45%" stopColor={color} stopOpacity={0.5} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle
          cx={diameter / 2}
          cy={diameter / 2}
          r={diameter / 2}
          fill={`url(#${gradientId})`}
        />
      </Svg>
    </Animated.View>
  );
}

export default function AuroraBackground() {
  const { mode, palette } = useTheme();
  const { width, height } = useWindowDimensions();
  const unit = Math.min(width, height);

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: palette.bg, overflow: 'hidden' }]}
    >
      {SPECS.map((spec, i) => (
        // Remounting on theme change swaps the gradient stops cleanly; the
        // reset in blob position is hidden by the full-screen colour change.
        <DriftBlob
          key={`${mode}-${spec.key}`}
          spec={spec}
          color={palette.blobs[i]}
          strength={palette.blobStrength}
          unit={unit}
          width={width}
          height={height}
        />
      ))}
    </View>
  );
}
