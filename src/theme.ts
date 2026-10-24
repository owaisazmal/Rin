import { createContext, useContext } from 'react';
import { Platform } from 'react-native';
import type { ModalProps, ViewStyle } from 'react-native';
import { COLUMN_MAX } from './fit';

export type ThemeMode = 'dark' | 'light';
/** What Settings stores; `system` is resolved to a ThemeMode from the OS before anything draws */
export type ThemePreference = ThemeMode | 'system';

/** The four brand colours every palette value is a shade of, bar the done and missed greens and reds */
const BRAND = {
  charcoal: '#4A4A4A',
  grey: '#CBCBCB',
  ivory: '#FFFFE3',
  slate: '#6D8196',
} as const;

/** The streak flame, the same on either ground, since no brand hue is warm */
export const FIRE = {
  bodyTop: '#F97316',
  bodyBottom: '#FBBF24',
  coreTop: '#FDE047',
  coreBottom: '#FEF08A',
} as const;

/** One real font file per weight, since iOS ignores `fontWeight` once a custom `fontFamily` is set */
export const FONT = {
  regular: 'JosefinSans_400Regular',
  medium: 'JosefinSans_500Medium',
  semibold: 'JosefinSans_600SemiBold',
  bold: 'JosefinSans_700Bold',
  italic: 'JosefinSans_400Regular_Italic',
} as const;

/** Line height for text that can wrap; on 3x iPhones a whole-pixel height can clip the last line */
export function wrapSafe(size: number): number {
  return Platform.OS === 'ios' ? size + 0.01 : size;
}

/** maxFontSizeMultiplier caps; `row` is text squeezed beside controls, and body text has none */
export const SCALE = { heading: 1.4, figure: 1.6, row: 2, glyph: 1 } as const;

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
  /** foregrounds on filled surfaces; light mode's accent and state fills are too far apart to share one */
  onAccent: string;
  onState: string;
  /** green and red carry a meaning no brand colour can */
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
  bg: '#0d0d0d',
  // darker shades of charcoal and slate, so the drift stays a wash on near-black
  blobs: ['#333333', '#4c5b6b', '#333333', '#242424', '#4c5b6b'],
  blobStrength: 0.55,
  card: 'rgba(24,24,24,0.78)',
  chip: 'rgba(40,40,40,0.9)',
  ink: BRAND.ivory,
  inkSoft: BRAND.grey,
  line: BRAND.charcoal,
  lineFaint: '#242424',
  // slate lightened so it clears 4.5:1 on the dark ground
  accent: '#8fa5ba',
  accentSoft: 'rgba(143,165,186,0.20)',
  onAccent: '#0d0d0d',
  onState: '#0d0d0d',
  done: '#93c63f',
  doneSoft: 'rgba(147,198,63,0.20)',
  missed: '#ef4c63',
  missedSoft: 'rgba(239,76,99,0.18)',
  cellEmpty: '#1a1a1a',
  ghLevels: ['#2a2a2a', '#386021', '#497b2d', '#6da939', '#93c63f'],
  ghMissed: '#7d2f3c',
  shadow: '#000000',
  shadowOpacity: 0.5,
};

export const lightPalette: Palette = {
  bg: BRAND.ivory,
  // a darker grey than the brand's, since a step away from white is harder to see than one from black
  blobs: ['#A0A0A0', '#A0A0A0', BRAND.slate, BRAND.grey, BRAND.slate],
  // above dark's 0.55 on purpose: equal measured spread still read fainter on a light page
  blobStrength: 0.65,
  // 20% see-through so the drift shows through cards; charcoal text still holds about 7:1
  card: 'rgba(255,255,250,0.80)',
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

/** Corner radii; `pill` is for genuinely circular elements (icon buttons, dots), not capsules */
export const RADIUS = {
  card: 18,
  control: 10,
  chip: 8,
  pill: 999,
} as const;

/** The content column: full width on a phone, centred at a readable width on iPads and tablets */
export const COLUMN = { width: '100%', maxWidth: COLUMN_MAX, alignSelf: 'center' } as const;

/** iPhone modals default to portrait only, but an unfolded Duo shows the app on its side */
export const MODAL_ORIENTATIONS: ModalProps['supportedOrientations'] = ['portrait', 'landscape'];

/** The shadow as one CSS colour; both palettes keep `shadow` as `#rrggbb` */
function shadowRgba(p: Palette): string {
  const n = parseInt(p.shadow.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${p.shadowOpacity})`;
}

/** Every planner card's surface; Android uses `boxShadow`, since `elevation` shows through translucent cards */
export function cardSurface(p: Palette): ViewStyle {
  return {
    backgroundColor: p.card,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: p.lineFaint,
    ...Platform.select<ViewStyle>({
      ios: {
        shadowColor: p.shadow,
        shadowOpacity: p.shadowOpacity,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 12 },
      },
      default: {
        // CSS blur is twice the Gaussian sigma iOS takes, so 40 here matches iOS's 20
        boxShadow: [
          { offsetX: 0, offsetY: 12, blurRadius: 40, color: shadowRgba(p) },
        ],
      },
    }),
  };
}

export interface Theme {
  /** resolved, so everything that draws sees only dark or light */
  mode: ThemeMode;
  preference: ThemePreference;
  palette: Palette;
  setPreference: (preference: ThemePreference) => void;
}

export const ThemeContext = createContext<Theme>({
  mode: 'dark',
  preference: 'dark',
  palette: darkPalette,
  setPreference: () => {},
});

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
