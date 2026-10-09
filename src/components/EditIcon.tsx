import React from 'react';
import Svg, { Path } from 'react-native-svg';

/** Pencil icon for the card editor, stroked like the other header icons. */
export default function EditIcon({
  color,
  size = 20,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* the body, tip at the bottom left */}
      <Path
        d="M4 20l1-4.6L15.9 4.5a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L8.6 19 4 20z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* the ferrule */}
      <Path
        d="M13.8 6.6l3.6 3.6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
