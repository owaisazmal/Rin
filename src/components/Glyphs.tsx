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
