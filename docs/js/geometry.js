/**
 * Every shape on this page, drawn from the app's own maths.
 *
 * This file is a one-to-one port of `src/logo.ts`, `src/components/RadialTracker.tsx`,
 * `src/components/YearChart.tsx`, `src/components/StreakBadge.tsx` and
 * `src/screens/introArt.tsx`. It is the only place the geometry lives, so the site
 * cannot drift from the app it documents. If a number here disagrees with the app,
 * the app is right and this is a bug.
 *
 * The mark and the tracker look like the same drawing and are not the same function:
 * different inner-radius basis, different gap model, different ring gap, no corner
 * rounding on the tracker, and 0-based against 1-based days. They stay separate.
 */

/* ------------------------------------------------------------------ palettes */

/** src/theme.ts — the four brand colours, and the three deliberate exceptions. */
export const BRAND = {
  charcoal: '#4A4A4A',
  grey: '#CBCBCB',
  ivory: '#FFFFE3',
  slate: '#6D8196',
};

export const FIRE = {
  bodyTop: '#F97316',
  bodyBottom: '#FBBF24',
  coreTop: '#FDE047',
  coreBottom: '#FEF08A',
};

export const DARK = {
  bg: '#242424',
  blobs: [BRAND.charcoal, BRAND.slate, BRAND.charcoal, '#3a3a3a', BRAND.slate],
  blobStrength: 0.55,
  card: 'rgba(49,49,49,0.78)',
  chip: 'rgba(66,66,66,0.9)',
  ink: BRAND.ivory,
  inkSoft: BRAND.grey,
  line: '#5a5a5a',
  lineFaint: '#343434',
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

export const LIGHT = {
  bg: BRAND.ivory,
  blobs: [BRAND.grey, BRAND.grey, BRAND.slate, BRAND.grey, BRAND.slate],
  blobStrength: 0.3,
  card: 'rgba(255,255,250,0.88)',
  chip: '#ececdb',
  ink: BRAND.charcoal,
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

export const palettes = { dark: DARK, light: LIGHT };

/* ---------------------------------------------------------------- the mark */

export const MARK = {
  SECTORS: 12,
  RINGS: 4,
  /** days already marked; the tick sits on the one after */
  FILLED: 8,
  MISSED: new Set(['1:3', '4:1', '6:2']),
  INNER_FRAC: 0.4,
  /** the one constant behind the ring gap, the sector gap and the corner stroke */
  K: 0.034,
  EXTENT: 1.1,
  TICK_RADIUS: 1.075,
  TICK_WIDTH: 0.04,
  TICK_PAD_DEG: 2.2,
  /**
   * Pending cells are a shade of the ground, not `cellEmpty` — that one is tuned to
   * sit inside a card, and on the bare page it takes the ring's shape with it.
   */
  EMPTY_FILL: { dark: '#363636', light: '#e4e4d2' },
};

const f2 = (n) => Number(n.toFixed(2));

/** 0° is 12 o'clock and angles run clockwise, like the tracker. */
function pt(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [f2(cx + r * Math.sin(a)), f2(cy - r * Math.cos(a))];
}

export function annularSector(cx, cy, r1, r2, a1, a2) {
  const [x1, y1] = pt(cx, cy, r2, a1);
  const [x2, y2] = pt(cx, cy, r2, a2);
  const [x3, y3] = pt(cx, cy, r1, a2);
  const [x4, y4] = pt(cx, cy, r1, a1);
  return (
    `M${x1} ${y1}A${f2(r2)} ${f2(r2)} 0 0 1 ${x2} ${y2}` +
    `L${x3} ${y3}A${f2(r1)} ${f2(r1)} 0 0 0 ${x4} ${y4}Z`
  );
}

/**
 * Stroke width that rounds the cell corners. Every cell is stroked in its *own*
 * fill colour with round joins — that, and nothing else, is what rounds them. The
 * outlines below are already pulled in by half of this, so the result lands back
 * on the nominal grid.
 */
export const cornerStroke = (R) => R * MARK.K;

export function cellState(day, ring) {
  if (day >= MARK.FILLED) return 'empty';
  return MARK.MISSED.has(`${day}:${ring}`) ? 'missed' : 'done';
}

/** All 48 cells of a mark centred on (cx, cy) with outer radius R, day-major. */
export function markCells(cx, cy, R) {
  const inner = R * MARK.INNER_FRAC;
  const ringGap = R * MARK.K;
  const ringW = (R - inner) / MARK.RINGS;
  const sectorDeg = 360 / MARK.SECTORS;
  /** a fixed *distance*, not a fixed angle, so the inner ring isn't pinched */
  const gap = R * MARK.K;
  const inset = cornerStroke(R) / 2;

  const cells = [];
  for (let day = 0; day < MARK.SECTORS; day++) {
    for (let ring = 0; ring < MARK.RINGS; ring++) {
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

/** The accent tick over the next day's sector: an open arc, stroked with round caps. */
export function todayTick(cx, cy, R) {
  const r = R * MARK.TICK_RADIUS;
  const sectorDeg = 360 / MARK.SECTORS;
  const [x1, y1] = pt(cx, cy, r, MARK.FILLED * sectorDeg + MARK.TICK_PAD_DEG);
  const [x2, y2] = pt(cx, cy, r, (MARK.FILLED + 1) * sectorDeg - MARK.TICK_PAD_DEG);
  return { d: `M${x1} ${y1}A${f2(r)} ${f2(r)} 0 0 1 ${x2} ${y2}`, width: R * MARK.TICK_WIDTH };
}

/**
 * The mark as SVG markup. Always generated at a large radius and scaled by the
 * viewBox — `logo.ts` rounds to two decimals inside the path string, so drawing
 * it directly at R=10 would visibly quantise the geometry.
 */
export function markSVG({ box = 200, mode = 'dark', palette = DARK, cells = null, tick = true } = {}) {
  const R = box / 2 / MARK.EXTENT;
  const c = box / 2;
  const sw = f2(cornerStroke(R));
  const fill = (s) =>
    s === 'done' ? palette.done : s === 'missed' ? palette.missed : MARK.EMPTY_FILL[mode];

  const list = cells || markCells(c, c, R);
  const paths = list
    .map(
      (k) =>
        `<path d="${k.d}" fill="${fill(k.state)}" stroke="${fill(k.state)}"` +
        ` stroke-width="${sw}" stroke-linejoin="round"/>`
    )
    .join('');

  const t = todayTick(c, c, R);
  const tickPath = tick
    ? `<path d="${t.d}" fill="none" stroke="${palette.accent}" stroke-width="${f2(
        t.width
      )}" stroke-linecap="round"/>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" aria-hidden="true">` +
    `${paths}${tickPath}</svg>`
  );
}

/* ------------------------------------------------------------- the tracker */

/** Faint placeholder rings keep the dense whiteboard-grid look when few habits exist. */
export const MIN_RINGS = 6;

function tpt(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

export function trackerSector(cx, cy, r1, r2, a1, a2) {
  const p1 = tpt(cx, cy, r2, a1);
  const p2 = tpt(cx, cy, r2, a2);
  const p3 = tpt(cx, cy, r1, a2);
  const p4 = tpt(cx, cy, r1, a1);
  const large = a2 - a1 > 180 ? 1 : 0;
  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${r2} ${r2} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${r1} ${r1} 0 ${large} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export function trackerGeometry(size, daysInMonth, habitCount) {
  const cx = size / 2;
  const cy = size / 2;
  const labelBand = 22;
  const outerR = size / 2 - labelBand;
  const innerR = size * 0.13;
  const sector = 360 / daysInMonth;
  const gap = Math.min(1.2, sector * 0.08);
  const ringCount = Math.max(habitCount, MIN_RINGS);
  const ringWidth = (outerR - innerR) / ringCount;
  return { cx, cy, labelBand, outerR, innerR, sector, gap, ringCount, ringWidth };
}

/**
 * Every cell of a live tracker. `stateAt(day, ring)` returns 0 pending / 1 done /
 * 2 missed; rings past `habitCount` are placeholders and always pending.
 */
export function trackerCells(size, daysInMonth, habitCount, stateAt) {
  const g = trackerGeometry(size, daysInMonth, habitCount);
  const out = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const a1 = (day - 1) * g.sector + g.gap / 2;
    const a2 = day * g.sector - g.gap / 2;
    for (let ring = 0; ring < g.ringCount; ring++) {
      const real = ring < habitCount;
      const r1 = g.innerR + ring * g.ringWidth;
      const r2 = r1 + g.ringWidth;
      out.push({
        // the flat −1 is the ring gap, on the outer edge only
        d: trackerSector(g.cx, g.cy, r1, r2 - 1, a1, a2),
        state: real ? stateAt(day, ring) || 0 : 0,
        day,
        ring,
        real,
      });
    }
  }
  return out;
}

export function trackerDayLabels(size, daysInMonth) {
  const g = trackerGeometry(size, daysInMonth, 0);
  const r = g.outerR + g.labelBand / 2 + 1;
  const out = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const p = tpt(g.cx, g.cy, r, (day - 0.5) * g.sector);
    out.push({ day, x: p.x, y: p.y });
  }
  return out;
}

/* ------------------------------------------------------------ the year grid */

export const YEAR = { CELL: 13, GAP: 3, STEP: 16, MONTH_ROW_H: 18, WEEKDAY_COL_W: 20 };
export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];
export const WEEKDAY_SHORT = ['', 'M', '', 'W', '', 'F', ''];

export const monthLength = (year, month) => new Date(year, month + 1, 0).getDate();

export function yearCalendar(year) {
  const startOffset = new Date(year, 0, 1).getDay(); // 0 = Sunday
  const dates = [];
  const monthStartCol = [];
  for (let m = 0; m < 12; m++) {
    monthStartCol.push(Math.floor((startOffset + dates.length) / 7));
    const len = monthLength(year, m);
    for (let d = 1; d <= len; d++) dates.push({ m, d });
  }
  const weekCount = Math.ceil((startOffset + dates.length) / 7);
  return { startOffset, dates, monthStartCol, weekCount };
}

/** Placed rects for every real day of the year; the leading and trailing blanks are skipped. */
export function yearCells(year) {
  const { startOffset, dates, weekCount } = yearCalendar(year);
  const { STEP, CELL, MONTH_ROW_H, WEEKDAY_COL_W } = YEAR;
  const out = [];
  for (let w = 0; w < weekCount; w++) {
    for (let r = 0; r < 7; r++) {
      const date = dates[w * 7 + r - startOffset];
      if (!date) continue;
      out.push({
        m: date.m,
        d: date.d,
        x: WEEKDAY_COL_W + w * STEP,
        y: MONTH_ROW_H + r * STEP,
        size: CELL,
      });
    }
  }
  return out;
}

/**
 * `ghLevels` is not five activity levels: index 0 is empty and only 1–4 are the
 * done ramp. `ghMissed` is a separate sixth colour, used only when nothing was
 * done *and* something was missed.
 */
export function yearLevel(m, d, months) {
  const info = months[m];
  if (!info || !info.habitCount) return { level: 0 };
  const t = info.tallies[d];
  if (!t) return { level: 0 };
  if (t.done > 0) {
    const ratio = t.done / info.habitCount;
    return { level: ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4 };
  }
  if (t.missed > 0) return { level: 0, missed: true };
  return { level: 0 };
}

/* ---------------------------------------------------------------- the flame */

export const FLAME_BODY =
  'M12 2.2c.4 2.6 2 3.9 3.4 5.4A7.6 7.6 0 0 1 17.8 13a5.8 5.8 0 1 1-11.6 0c0-2 .9-3.5 1.9-4.7.2 1.2.8 2 1.6 2.3.7-3 .5-6 2.3-8.4z';
export const FLAME_CORE =
  'M12 12.1c1.6 1.5 2.5 2.7 2.5 4a2.5 2.5 0 0 1-5 0c0-1.3.9-2.5 2.5-4z';
/** the ink runs y 2.2–18.8, so the window shifts up 1.5 to centre the drawing, not the box */
export const FLAME_VIEWBOX = '0 -1.5 24 24';
export const FLAME_DIM = 0.45;

/**
 * Drawn rather than typed as an emoji so the unlit state is possible at all.
 * `idPrefix` must be unique per instance — two badges sharing a gradient id fight.
 */
export function flameSVG({ size = 19, lit = true, idPrefix = 'streak' } = {}) {
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${FLAME_VIEWBOX}" aria-hidden="true">`;
  if (!lit) {
    // same two paths, but the core is punched out with even-odd winding rather
    // than painted, so one flat tone stays honestly monochrome
    return (
      open +
      `<path d="${FLAME_BODY} ${FLAME_CORE}" fill-rule="evenodd" fill="currentColor" fill-opacity="${FLAME_DIM}"/></svg>`
    );
  }
  return (
    open +
    '<defs>' +
    `<linearGradient id="${idPrefix}Body" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${FIRE.bodyTop}"/><stop offset="1" stop-color="${FIRE.bodyBottom}"/></linearGradient>` +
    `<linearGradient id="${idPrefix}Core" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${FIRE.coreTop}"/><stop offset="1" stop-color="${FIRE.coreBottom}"/></linearGradient>` +
    '</defs>' +
    `<path d="${FLAME_BODY}" fill="url(#${idPrefix}Body)"/>` +
    `<path d="${FLAME_CORE}" fill="url(#${idPrefix}Core)"/></svg>`
  );
}

/* -------------------------------------------------------------- intro art */

/**
 * `FadingStreak` from introArt.tsx: a run of check-ins thinning out to the right.
 * Deterministic — the same pattern every load, on purpose.
 */
export function fadingStreak({ cell = 15, gap = 5, cols = 12, rows = 5 } = {}) {
  const step = cell + gap;
  const rects = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const density = 1 - c / (cols - 1);
      const on = ((c * 7 + r * 3) % 10) < density * 11;
      rects.push({
        x: c * step,
        y: r * step,
        size: cell,
        col: c,
        level: on ? Math.min(4, 1 + Math.floor(density * 3.4)) : -1,
      });
    }
  }
  return { width: cols * step, height: rows * step, rects };
}

/* ------------------------------------------------------------------ quotes */

/** src/quotes.ts, verbatim — the site, the app and the widget agree by construction. */
export const DISCIPLINE_QUOTES = [
  "Discipline doesn't care how you feel. Discipline is doing what needs to be done, even when you don't feel like doing it.",
  'We are what we repeatedly do. Excellence, then, is not an act, but a habit.',
  'Motivation gets you going, but discipline keeps you growing.',
  'You will never always be motivated, so you must learn to be disciplined.',
  'Small disciplines repeated with consistency every day lead to great achievements.',
  'Discipline is choosing between what you want now and what you want most.',
  'Suffer the pain of discipline or suffer the pain of regret.',
  'The successful warrior is the average man, with laser-like focus.',
  "Don't count the days. Make the days count.",
  'Success is nothing more than a few simple disciplines, practiced every day.',
  'Freedom is impossible without discipline.',
  'A river cuts through rock not because of its power, but because of its persistence.',
  'You don’t have to be extreme, just consistent.',
  'The hard days are what make you stronger.',
  'Discipline is the bridge between goals and accomplishment.',
];

const DAY_MS = 86400000;

/** Stable quote for a given date — changes once per day, matching src/quotes.ts. */
export function quoteForDate(date) {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / DAY_MS
  );
  return DISCIPLINE_QUOTES[dayOfYear % DISCIPLINE_QUOTES.length];
}
