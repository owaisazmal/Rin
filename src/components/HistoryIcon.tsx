import React from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * A clock with its hand swept back, the usual shorthand for "what happened
 * before now". Stroked at the same weight as SettingsIcon and ThemeIcon so the
 * three sit together in the header without one looking heavier than the rest.
 */
export default function HistoryIcon({
  color,
  size = 20,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* open at the top left, where the arrow doubles back */}
      <Path
        d="M3.6 12a8.4 8.4 0 1 0 2.6-6.1"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M3.2 3.9v4h4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M12 7.6V12l3 1.9"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
