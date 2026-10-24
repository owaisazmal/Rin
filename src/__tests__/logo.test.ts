import {
  FILLED,
  MARK_EXTENT,
  MISSED,
  RINGS,
  SECTORS,
  TICK_RADIUS,
  TICK_WIDTH,
  cellState,
  markCells,
  todayTick,
} from '../logo';

/** every number in a path, in order */
const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('markCells', () => {
  const R = 100;
  const cells = markCells(0, 0, R);

  it('draws one cell per day and ring, day-major', () => {
    expect(cells).toHaveLength(SECTORS * RINGS);
    expect(cells.map((c) => c.day)).toEqual(
      Array.from({ length: SECTORS * RINGS }, (_, i) => Math.floor(i / RINGS))
    );
    expect(cells.map((c) => c.ring)).toEqual(
      Array.from({ length: SECTORS * RINGS }, (_, i) => i % RINGS)
    );
  });

  it('marks the first days, misses the chosen cells, and leaves the rest pending', () => {
    const count = (state: string) => cells.filter((c) => c.state === state).length;
    expect(count('empty')).toBe((SECTORS - FILLED) * RINGS);
    expect(count('missed')).toBe(MISSED.size);
    expect(count('done')).toBe(FILLED * RINGS - MISSED.size);
    for (const key of MISSED) {
      const [day, ring] = key.split(':').map(Number);
      expect(cellState(day, ring)).toBe('missed');
    }
  });

  it('keeps every cell inside the outer radius and outside the hole', () => {
    for (const c of cells) {
      const n = numbers(c.d);
      const corners = [
        [n[0], n[1]],
        [n[7], n[8]],
        [n[9], n[10]],
        [n[16], n[17]],
      ];
      for (const [x, y] of corners) {
        const r = Math.hypot(x, y);
        expect(r).toBeLessThanOrEqual(R + 0.01);
        expect(r).toBeGreaterThanOrEqual(R * 0.4 - 0.01);
      }
    }
  });

  it('is pure', () => {
    expect(markCells(50, 50, 40)).toEqual(markCells(50, 50, 40));
  });
});

describe('todayTick', () => {
  it('sits over the day after the last marked one, inside the mark extent', () => {
    const R = 100;
    const tick = todayTick(0, 0, R);
    const n = numbers(tick.d);
    const start = [n[0], n[1]];
    const end = [n[7], n[8]];
    const angle = ([x, y]: number[]) => ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
    const sector = 360 / SECTORS;
    expect(angle(start)).toBeGreaterThan(FILLED * sector);
    expect(angle(end)).toBeLessThan((FILLED + 1) * sector);
    expect(Math.hypot(start[0], start[1])).toBeCloseTo(R * TICK_RADIUS, 0);
    expect(tick.width).toBeCloseTo(R * TICK_WIDTH);
    expect(TICK_RADIUS + TICK_WIDTH / 2).toBeLessThanOrEqual(MARK_EXTENT);
  });
});
