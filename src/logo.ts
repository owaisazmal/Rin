// The mark, a radial tracker caught mid-month; assets/logo was generated from these same numbers.

export const SECTORS = 12;
export const RINGS = 4;
/** days already marked; the tick sits on the one after */
export const FILLED = 8;
/** `day:ring` pairs that were missed rather than done */
export const MISSED: ReadonlySet<string> = new Set(['1:3', '4:1', '6:2']);

/** the tick's centreline and stroke width, as multiples of the outer radius */
export const TICK_RADIUS = 1.075;
export const TICK_WIDTH = 0.04;
/** everything, tick included, fits inside this multiple of the outer radius */
export const MARK_EXTENT = 1.1;

/** A shade of the ground, since the palette's `cellEmpty` all but vanishes outside a card */
export const EMPTY_FILL = { dark: '#363636', light: '#e4e4d2' } as const;

export type MarkCellState = 'done' | 'missed' | 'empty';

export interface MarkCell {
  /** SVG path data for the annular sector */
  d: string;
  day: number;
  ring: number;
  state: MarkCellState;
}

const f2 = (n: number) => Number(n.toFixed(2));

/** 0° is 12 o'clock and angles run clockwise, like the tracker */
function pt(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [f2(cx + r * Math.sin(a)), f2(cy - r * Math.cos(a))];
}

function annularSector(
  cx: number,
  cy: number,
  r1: number,
  r2: number,
  a1: number,
  a2: number
): string {
  const [x1, y1] = pt(cx, cy, r2, a1);
  const [x2, y2] = pt(cx, cy, r2, a2);
  const [x3, y3] = pt(cx, cy, r1, a2);
  const [x4, y4] = pt(cx, cy, r1, a1);
  return `M${x1} ${y1}A${f2(r2)} ${f2(r2)} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${f2(r1)} ${f2(r1)} 0 0 0 ${x4} ${y4}Z`;
}

/** Round-joined stroke that rounds the cell corners; outlines are pulled in by half of it */
export function cornerStroke(R: number): number {
  return R * 0.034;
}

export function cellState(day: number, ring: number): MarkCellState {
  if (day >= FILLED) return 'empty';
  return MISSED.has(`${day}:${ring}`) ? 'missed' : 'done';
}

/** All 48 cells of a mark centred on (cx, cy) with outer radius R, day-major. */
export function markCells(cx: number, cy: number, R: number): MarkCell[] {
  const inner = R * 0.4;
  const ringGap = R * 0.034;
  const ringW = (R - inner) / RINGS;
  const sectorDeg = 360 / SECTORS;
  /** the gap between sectors is a fixed distance, not a fixed angle, so the inner ring isn't pinched */
  const gap = R * 0.034;
  const inset = cornerStroke(R) / 2;

  const cells: MarkCell[] = [];
  for (let day = 0; day < SECTORS; day++) {
    for (let ring = 0; ring < RINGS; ring++) {
      const r1 = inner + ring * ringW + ringGap / 2;
      const r2 = inner + (ring + 1) * ringW - ringGap / 2;
      const rMid = (r1 + r2) / 2;
      const gapDeg = ((gap / rMid) * 180) / Math.PI;
      const insetDeg = ((inset / rMid) * 180) / Math.PI;
      const a1 = day * sectorDeg + gapDeg / 2 + insetDeg;
      const a2 = (day + 1) * sectorDeg - gapDeg / 2 - insetDeg;
      cells.push({
        d: annularSector(cx, cy, r1 + inset, r2 - inset, a1, a2),
        day,
        ring,
        state: cellState(day, ring),
      });
    }
  }
  return cells;
}

/** The accent tick over the next day's sector: an open arc to stroke with round caps. */
export function todayTick(cx: number, cy: number, R: number): { d: string; width: number } {
  const r = R * TICK_RADIUS;
  const sectorDeg = 360 / SECTORS;
  const [x1, y1] = pt(cx, cy, r, FILLED * sectorDeg + 2.2);
  const [x2, y2] = pt(cx, cy, r, (FILLED + 1) * sectorDeg - 2.2);
  return { d: `M${x1} ${y1}A${f2(r)} ${f2(r)} 0 0 1 ${x2} ${y2}`, width: R * TICK_WIDTH };
}
