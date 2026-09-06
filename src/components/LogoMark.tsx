import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { Palette, ThemeMode, useTheme } from '../theme';
import {
  EMPTY_FILL,
  MARK_EXTENT,
  MarkCell,
  MarkCellState,
  cornerStroke,
  markCells,
  todayTick,
} from '../logo';

/**
 * The logo, drawn live from the same geometry as the icon so it takes the
 * current palette rather than shipping a bitmap per theme. Decorative wherever
 * it appears: the wordmark beside it carries the name for screen readers.
 */

/** The mark is drawn in a 100-unit box; the ring leaves room for the tick. */
const MARK_BOX = 100;
const MARK_RADIUS = MARK_BOX / 2 / MARK_EXTENT;
export const MARK_VIEWBOX = `0 0 ${MARK_BOX} ${MARK_BOX}`;

const CENTER = MARK_BOX / 2;
export const MARK_CELLS: readonly MarkCell[] = markCells(CENTER, CENTER, MARK_RADIUS);
const TICK = todayTick(CENTER, CENTER, MARK_RADIUS);
const CORNER = cornerStroke(MARK_RADIUS);

function cellColour(state: MarkCellState, palette: Palette, mode: ThemeMode): string {
  if (state === 'done') return palette.done;
  if (state === 'missed') return palette.missed;
  return EMPTY_FILL[mode];
}

/** A run of cells as paths. Must sit inside an <Svg> using MARK_VIEWBOX. */
export function MarkCells({
  cells,
  palette,
  mode,
}: {
  cells: readonly MarkCell[];
  palette: Palette;
  mode: ThemeMode;
}) {
  return (
    <>
      {cells.map((c) => {
        const fill = cellColour(c.state, palette, mode);
        return (
          <Path
            key={`${c.day}:${c.ring}`}
            d={c.d}
            fill={fill}
            // stroked in its own colour with round joins: that is what rounds the corners
            stroke={fill}
            strokeWidth={CORNER}
            strokeLinejoin="round"
          />
        );
      })}
    </>
  );
}

/** The accent tick outside the ring. Same <Svg> contract as MarkCells. */
export function MarkTick({ palette }: { palette: Palette }) {
  return (
    <Path
      d={TICK.d}
      fill="none"
      stroke={palette.accent}
      strokeWidth={TICK.width}
      strokeLinecap="round"
    />
  );
}

export default function LogoMark({ size }: { size: number }) {
  const { palette, mode } = useTheme();
  return (
    <Svg width={size} height={size} viewBox={MARK_VIEWBOX}>
      <MarkCells cells={MARK_CELLS} palette={palette} mode={mode} />
      <MarkTick palette={palette} />
    </Svg>
  );
}
