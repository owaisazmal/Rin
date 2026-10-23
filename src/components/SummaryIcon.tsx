import React from 'react';
import Svg, { Path } from 'react-native-svg';

/** Three bars on a baseline for the month's summary, stroked like the other header icons. */
export default function SummaryIcon({
  color,
  size = 20,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M3.5 20.5h17M7 16.5v-4M12 16.5V5.5M17 16.5v-7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
