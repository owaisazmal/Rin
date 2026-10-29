import Svg, { Path } from 'react-native-svg';
import type { ThemeMode } from '../theme';

/** Stroked line icons on a 24-unit grid, shared by the buttons and headers. */
export function Glyph({
  d,
  color,
  size,
  weight = 2.4,
}: {
  d: string;
  color: string;
  size: number;
  weight?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={d}
        stroke={color}
        strokeWidth={weight}
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
  weight?: number;
}

export function PlusGlyph({ color, size = 16, weight }: Props) {
  return <Glyph d="M12 5.5v13M5.5 12h13" color={color} size={size} weight={weight} />;
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

export function ImportGlyph({ color, size = 16 }: Props) {
  return <Glyph d="M12 3.8v10M8.2 10.2 12 14l3.8-3.8M7.5 10.5H6v9h12v-9h-1.5" color={color} size={size} />;
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

/** a task that comes back */
export function RepeatGlyph({ color, size = 11 }: Props) {
  return <Glyph d="M19 12a7 7 0 1 1-2.05-4.95M17.5 3v4.5H13" color={color} size={size} weight={2.6} />;
}

// The header icons: the same strokes at weight 2, 20pt by default.

export function SummaryIcon({ color, size = 20 }: Props) {
  return <Glyph d="M3.5 20.5h17M7 16.5v-4M12 16.5V5.5M17 16.5v-7" color={color} size={size} weight={2} />;
}

export function EditIcon({ color, size = 20 }: Props) {
  return (
    <Glyph
      d="M4 20l1-4.6L15.9 4.5a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L8.6 19 4 20zM13.8 6.6l3.6 3.6"
      color={color}
      size={size}
      weight={2}
    />
  );
}

export function HistoryIcon({ color, size = 20 }: Props) {
  return (
    <Glyph
      d="M3.6 12a8.4 8.4 0 1 0 2.6-6.1M3.2 3.9v4h4M12 7.6V12l3 1.9"
      color={color}
      size={size}
      weight={2}
    />
  );
}

/** sliders, since a cog at this size reads as ThemeIcon's sun */
export function SettingsIcon({ color, size = 20 }: Props) {
  return (
    <Glyph
      d="M3 8.5h3.4M11.4 8.5H21M3 15.5h6.4M14.6 15.5H21M6.4 8.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0zM9.6 15.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0z"
      color={color}
      size={size}
      weight={2}
    />
  );
}

/** sun or moon, drawn because iOS renders ☀/☾ as colour emoji */
export function ThemeIcon({ mode, color, size = 20 }: Props & { mode: ThemeMode }) {
  const d =
    mode === 'light'
      ? 'M7.6 12a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0-8.8 0zM12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7'
      : 'M20.5 14.6A8.8 8.8 0 1 1 11.1 3.5a6.9 6.9 0 0 0 9.4 11.1z';
  return <Glyph d={d} color={color} size={size} weight={2} />;
}
