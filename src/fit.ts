/** One planner column on a phone, two once the window fits two phone-width ones (an unfolded iPhone Duo, an iPad) */

/** The single column's cap, centred on anything wider */
export const COLUMN_MAX = 640;
/** The two columns' cap, gap included */
export const SPLIT_MAX = 980;

const GUTTER = 16;
const GAP = 14;
/** the tracker card's side padding */
export const CARD_PADDING = 16;
const MIN_COLUMN = 360;
const CHART_MAX = 420;
// of the window's height, so a short screen still fits the whole tracker card
const CHART_HEIGHT_SHARE = 0.47;

export interface Size {
  width: number;
  height: number;
}

export interface SideInsets {
  left: number;
  right: number;
}

export interface Insets extends SideInsets {
  top: number;
}

/** Just below the clock and Wi-Fi in the Duo's right-hand status column */
export const RAIL_TOP = 172;

/** The Duo keeps its status bar in a column down the right edge, with room under it for the planner's buttons */
export function usesSideRail(insets: Insets): boolean {
  return insets.right >= 60 && insets.top < insets.right;
}

export interface PlannerFit {
  /** tracker and daily check on the left, the cards on the right */
  split: boolean;
  /** width of one column, either way */
  column: number;
  /** side of the radial chart */
  chart: number;
}

export function plannerFit(window: Size, insets: SideInsets): PlannerFit {
  const room = window.width - insets.left - insets.right;
  const half = (Math.min(room, SPLIT_MAX) - 2 * GUTTER - GAP) / 2;
  const split = half >= MIN_COLUMN;
  const column = Math.floor(split ? half : Math.min(room, COLUMN_MAX) - 2 * GUTTER);
  const chart = Math.min(column - 2 * CARD_PADDING, CHART_MAX, window.height * CHART_HEIGHT_SHARE);
  return { split, column, chart: Math.max(0, Math.floor(chart)) };
}
