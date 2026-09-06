import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * Sliders rather than the usual cog. A cog is a ring with spokes around it,
 * which at 20pt is the sun in ThemeIcon almost exactly. Rails and knobs read
 * as "settings" without the collision, and keep the stroked line style of the
 * other icons.
 */
export default function SettingsIcon({
  color,
  size = 20,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M3 8.5h3.4M11.4 8.5H21M3 15.5h6.4M14.6 15.5H21"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
      <Circle cx={8.9} cy={8.5} r={2.5} stroke={color} strokeWidth={2} fill="none" />
      <Circle cx={12.1} cy={15.5} r={2.5} stroke={color} strokeWidth={2} fill="none" />
    </Svg>
  );
}
