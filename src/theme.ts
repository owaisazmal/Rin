import { createContext, useContext } from 'react';
import type { ViewStyle } from 'react-native';

export type ThemeMode = 'dark' | 'light';

/**
 * The four brand colours the whole app is built from. Every other value in the
 * palettes below is a lighter or darker shade of one of these four — no new hue
 * is ever introduced. Slate is the only chromatic one, so it carries every
 * accent; the greys and ivory carry structure and text.
 *
 * A few shades exist because the four alone can't cover both modes: slate on
 * ivory is 3.83:1 where body copy needs 4.5:1, so light mode darkens it and
 * dark mode lightens it.
 */
export const BRAND = {
  charcoal: '#4A4A4A',
  grey: '#CBCBCB',
  ivory: '#FFFFE3',
  slate: '#6D8196',
} as const;

/**
 * Fire, for the streak flame. The second deliberate exception to the four brand
 * colours, after the green and red of done/missed: an alight flame has to look
 * alight, and no brand hue is warm. Mode-independent — fire is the same colour
 * on either ground. A dead streak drops back to the palette's own ink.
 */
export const FIRE = {
  bodyTop: '#F97316',
  bodyBottom: '#FBBF24',
  coreTop: '#FDE047',
  coreBottom: '#FEF08A',
} as const;

/**
 * Josefin Sans ships weights 100–700 only, and iOS ignores `fontWeight` once a
 * custom `fontFamily` is set — so every weight in the UI maps onto a real font
 * file here instead of relying on synthetic bolding. The heaviest UI weights
 * (the old 800/900) land on Bold, which is as heavy as this family goes.
 */
export const FONT = {
  regular: 'JosefinSans_400Regular',
  medium: 'JosefinSans_500Medium',
  semibold: 'JosefinSans_600SemiBold',
  bold: 'JosefinSans_700Bold',
  italic: 'JosefinSans_400Regular_Italic',
} as const;

export interface Palette {
  /** flat colour behind the drifting background blobs */
  bg: string;
  /** the blobs are drawn in brand colours; `blobStrength` scales them back */
  blobs: string[];
  /** multiplier on each blob's opacity, so full-strength brand colour stays a wash */
  blobStrength: number;
  /** translucent so the moving background reads through every card */
  card: string;
  /** slightly raised surface inside a card (chips, number badges, inputs) */
  chip: string;
  ink: string;
  inkSoft: string;
  line: string;
  lineFaint: string;
  /** brand colour — accent bars, active states, today markers, calls to action */
  accent: string;
  accentSoft: string;
  /**
   * Foregrounds on filled surfaces. Accent and state fills sit at opposite ends
   * of the lightness range in light mode — a dark slate button vs a bright green
   * one — so one shared foreground can't stay readable on both.
   */
  onAccent: string;
  onState: string;
  /**
   * Habit checked off / missed. The one deliberate exception to the four brand
   * colours: green and red carry meaning no brand colour can.
   */
  done: string;
  doneSoft: string;
  missed: string;
  missedSoft: string;
  cellEmpty: string;
  /** GitHub-style intensity ramp, index 0 = empty */
  ghLevels: string[];
  ghMissed: string;
  /** card drop-shadow — tinted, so even shadows stay inside the brand hues */
  shadow: string;
  /** shadow strength; heavier on dark, barely there on light */
  shadowOpacity: number;
}

export const darkPalette: Palette = {
  bg: '#242424',
  // charcoal blobs on a darker charcoal ground — the grey drift, in palette
  blobs: [BRAND.charcoal, BRAND.slate, BRAND.charcoal, '#3a3a3a', BRAND.slate],
  blobStrength: 0.55,
  card: 'rgba(49,49,49,0.78)',
  chip: 'rgba(66,66,66,0.9)',
  ink: BRAND.ivory,
  inkSoft: BRAND.grey,
  line: '#5a5a5a',
  lineFaint: '#343434',
  // slate lightened so it clears 4.5:1 on the charcoal ground
  accent: '#8fa5ba',
  accentSoft: 'rgba(143,165,186,0.20)',
  onAccent: '#242424',
  onState: '#242424',
  done: '#93c63f',
  doneSoft: 'rgba(147,198,63,0.20)',
  missed: '#ef4c63',
  missedSoft: 'rgba(239,76,99,0.18)',
  cellEmpty: '#2e2e2e',
  ghLevels: ['#2e2e2e', '#2d4b1f', '#497b2d', '#6da939', '#93c63f'],
  ghMissed: '#7d2f3c',
  shadow: '#141414',
  shadowOpacity: 0.5,
};

export const lightPalette: Palette = {
  bg: BRAND.ivory,
  blobs: [BRAND.grey, BRAND.grey, BRAND.slate, BRAND.grey, BRAND.slate],
  blobStrength: 0.3,
  card: 'rgba(255,255,250,0.88)',
  chip: '#ececdb',
  ink: BRAND.charcoal,
  // slate darkened to clear 4.5:1 on ivory
  inkSoft: '#5f6b78',
  line: BRAND.grey,
  lineFaint: '#e3e3d3',
  accent: '#57697c',
  accentSoft: 'rgba(109,129,150,0.18)',
  onAccent: BRAND.ivory,
  onState: '#2e2e2e',
  done: '#7fb32e',
  doneSoft: 'rgba(147,198,63,0.24)',
  missed: '#e5405a',
  missedSoft: 'rgba(239,76,99,0.18)',
  cellEmpty: '#e5e5d5',
  ghLevels: ['#e5e5d5', '#d9ecb2', '#b7dc7a', '#9ccd4d', '#7fb32e'],
  ghMissed: '#eb8a99',
  shadow: BRAND.charcoal,
  shadowOpacity: 0.16,
};

/**
 * Corner radii. Rectangular surfaces get only a slight curve; `pill` is kept
 * for elements that are genuinely circular (icon buttons, dots), not capsules.
 */
export const RADIUS = {
  card: 18,
  control: 10,
  chip: 8,
  pill: 999,
} as const;

/** Shared surface every card on the planner screen sits on */
export function cardSurface(p: Palette): ViewStyle {
  return {
    backgroundColor: p.card,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: p.lineFaint,
    shadowColor: p.shadow,
    shadowOpacity: p.shadowOpacity,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  };
}

export interface Theme {
  mode: ThemeMode;
  palette: Palette;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeContext = createContext<Theme>({
  mode: 'dark',
  palette: darkPalette,
  setMode: () => {},
});

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
