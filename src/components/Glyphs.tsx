import React from 'react';
import Svg, { Path } from 'react-native-svg';

/** Small stroked glyphs shared by the card buttons. */

function Glyph({ d, color, size }: { d: string; color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={d}
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

interface Props {
  color: string;
  size?: number;
}

export function PlusGlyph({ color, size = 16 }: Props) {
  return <Glyph d="M12 5.5v13M5.5 12h13" color={color} size={size} />;
}

export function CloseGlyph({ color, size = 14 }: Props) {
  return <Glyph d="M7 7 L17 17 M17 7 L7 17" color={color} size={size} />;
}

export function CheckGlyph({ color, size = 14 }: Props) {
  return <Glyph d="M5.5 12.5l4.2 4.2L18.5 7.8" color={color} size={size} />;
}

export function ChevronGlyph({ color, size = 14, up = false }: Props & { up?: boolean }) {
  return <Glyph d={up ? 'M6.5 14.5L12 9l5.5 5.5' : 'M6.5 9.5L12 15l5.5-5.5'} color={color} size={size} />;
}

export function ShareGlyph({ color, size = 16 }: Props) {
  return <Glyph d="M12 14V4M8.2 7.6 12 3.8l3.8 3.8M7.5 10.5H6v9h12v-9h-1.5" color={color} size={size} />;
}

/** a link that leaves the app */
export function ExternalGlyph({ color, size = 14 }: Props) {
  return <Glyph d="M9.5 6.5h8v8M17.5 6.5 7 17" color={color} size={size} />;
}

export function UnlockGlyph({ color, size = 16 }: Props) {
  return <Glyph d="M6 11h12v9H6zM8.5 11V7.6a3.5 3.5 0 0 1 6.9-.9" color={color} size={size} />;
}

/** a JSON file */
export function BracesGlyph({ color, size = 16 }: Props) {
  return (
    <Glyph
      d="M9.5 4.5H9C7.4 4.5 6.5 5.4 6.5 7v2.2c0 1.4-.8 2.3-2 2.8 1.2.5 2 1.4 2 2.8V17c0 1.6.9 2.5 2.5 2.5h.5M14.5 4.5h.5c1.6 0 2.5.9 2.5 2.5v2.2c0 1.4.8 2.3 2 2.8-1.2.5-2 1.4-2 2.8V17c0 1.6-.9 2.5-2.5 2.5h-.5"
      color={color}
      size={size}
    />
  );
}

/** a CSV file */
export function GridGlyph({ color, size = 16 }: Props) {
  return <Glyph d="M5 5.5h14v13H5zM5 10h14M5 14.5h14M10.5 5.5v13" color={color} size={size} />;
}
