/**
 * Rin — the site's behaviour.
 *
 * Nothing here is a mock-up of the app: the tracker is the app's real geometry
 * over a real (in-memory) month, the year grid and the history log are derived
 * from that same month rather than stored twice, and the request ledger reports
 * what the browser actually fetched. If a claim on this page can be checked,
 * this file is what makes it checkable.
 *
 * Motion rules, from the app: transform and opacity only; every reveal fires
 * once and is unobserved immediately; the aurora is the only thing that repeats.
 */

import {
  DARK,
  FLAME_DIM,
  LIGHT,
  MARK,
  MONTH_ABBR,
  MONTH_NAMES,
  WEEKDAY_SHORT,
  YEAR,
  flameSVG,
  fadingStreak,
  markCells,
  markSVG,
  monthLength,
  quoteForDate,
  todayTick,
  trackerCells,
  trackerDayLabels,
  trackerGeometry,
  yearCalendar,
  yearCells,
  yearLevel,
} from './geometry.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const lessMotion = () => reduced.matches;

/**
 * The app's easing curves, as literals. The Web Animations API resolves no CSS
 * custom properties, so `var(--ease-out)` silently throws there — these have to
 * be the same tables the stylesheet carries, spelled out.
 *
 * The app samples each React Native curve into 13 keyframes and interpolates
 * linearly between them, so the piecewise result *is* the motion, not an
 * approximation of it.
 */
const EASE = {
  /** Easing.out(Easing.cubic) */
  out: 'linear(0, .2297, .4213, .5781, .7037, .8015, .875, .9277, .963, .9844, .9954, .9994, 1)',
  /** Easing.out(Easing.back(1.7)) — the sector bloom */
  bloom: 'linear(0, .3488, .6181, .8172, .9556, 1.0425, 1.0875, 1.0998, 1.0889, 1.0641, 1.0347, 1.0102, 1)',
  /** Easing.out(Easing.back(2.2)) — the tick drop */
  drop: 'linear(0, .3838, .6759, .8875, 1.0296, 1.1134, 1.15, 1.1505, 1.1259, 1.0875, 1.0463, 1.0134, 1)',
  ios: 'cubic-bezier(0.32, 0.72, 0, 1)',
};

function el(tag, attrs = {}, kids = []) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const kid of [].concat(kids)) node.appendChild(kid);
  return node;
}

/* ==================================================================== theme */

const THEME_KEY = 'rin-theme';

const theme = {
  get mode() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  },
  get palette() {
    return this.mode === 'light' ? LIGHT : DARK;
  },
  listeners: [],
  onChange(fn) {
    this.listeners.push(fn);
  },
  set(mode) {
    if (mode === this.mode) return;
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch (e) {
      /* private mode, or site data blocked — the choice just won't persist */
    }
    this.listeners.forEach((fn) => fn(mode));
  },
};

/**
 * SegmentedControl.tsx: one pill that slides, labels cross-fading underneath.
 * The pill's position is decorative — `aria-pressed` carries the state, so a
 * screen reader never depends on where a transform landed.
 */
function segmented(root, options, value, onChange) {
  root.classList.add('seg');
  root.setAttribute('role', 'group');
  const thumb = document.createElement('div');
  thumb.className = 'seg-thumb';
  root.appendChild(thumb);

  const buttons = options.map((opt) => {
    const b = document.createElement('button');
    b.type = 'button';
    // aria-pressed, not aria-selected: these are toggle buttons, and
    // aria-selected is only valid on options, tabs, rows and grid cells, where
    // every screen reader would silently drop it.
    b.dataset.value = opt.value;
    b.innerHTML = `<span class="off">${opt.label}</span><span class="on" aria-hidden="true">${opt.label}</span>`;
    b.addEventListener('click', () => api.set(opt.value, true));
    root.appendChild(b);
    return b;
  });

  const api = {
    value,
    set(next, fire) {
      api.value = next;
      const i = Math.max(
        0,
        options.findIndex((o) => o.value === next)
      );
      buttons.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
      const cell = (root.clientWidth - 6) / options.length;
      thumb.style.width = `${cell}px`;
      thumb.style.transform = `translateX(${i * cell}px)`;
      if (fire && onChange) onChange(next, i);
    },
    layout() {
      api.set(api.value, false);
    },
  };

  api.set(value, false);
  // the pill needs a measured track; re-run once layout has settled and on resize
  requestAnimationFrame(api.layout);
  window.addEventListener('resize', api.layout);
  return api;
}

function initTheme() {
  const controls = ['#theme-top', '#theme-foot']
    .map((sel) => $(sel))
    .filter(Boolean)
    .map((node) =>
      segmented(
        node,
        [
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ],
        theme.mode,
        (mode) => theme.set(mode)
      )
    );
  // keep the two copies in step, and redraw everything that bakes a palette value
  theme.onChange((mode) => controls.forEach((c) => c.set(mode, false)));
}

/* =================================================================== ground */

/**
 * AuroraBackground.tsx, to the letter. Five blobs; each picks a fresh random
 * direction, distance, scale and duration for every leg, so the motion never
 * settles into a visible loop. Targets are absolute offsets from the blob's
 * resting position, never deltas from where it currently is — so each blob
 * orbits inside a disc of radius `travel` and can never wander off.
 */
const SPECS = [
  { size: 1.35, x: -0.35, y: -0.12, travel: 0.26, opacity: 0.95 },
  { size: 1.05, x: 0.42, y: 0.08, travel: 0.3, opacity: 0.85 },
  { size: 1.5, x: -0.2, y: 0.42, travel: 0.24, opacity: 0.9 },
  { size: 0.9, x: 0.45, y: 0.68, travel: 0.32, opacity: 0.8 },
  { size: 0.8, x: -0.05, y: 0.18, travel: 0.38, opacity: 0.14 },
];

const MIN_LEG_MS = 9000;
const MAX_LEG_MS = 19000;
/** Easing.inOut(Easing.quad) — zero velocity at both ends, so it softly stops */
const LEG_EASE = 'cubic-bezier(0.455,0.03,0.515,0.955)';

function initGround() {
  const ground = $('#ground');
  if (!ground) return;

  const nodes = SPECS.map(() => {
    const d = document.createElement('div');
    d.className = 'blob';
    ground.appendChild(d);
    return d;
  });
  let running = [];

  function paint() {
    const p = theme.palette;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const unit = Math.min(w, h);
    nodes.forEach((node, i) => {
      const s = SPECS[i];
      const c = p.blobs[i];
      const dia = s.size * unit;
      node.style.width = `${dia}px`;
      node.style.height = `${dia}px`;
      node.style.left = `${s.x * w}px`;
      node.style.top = `${s.y * h}px`;
      node.style.opacity = String(s.opacity * p.blobStrength);
      // the 45% half-alpha mid stop is what gives the soft falloff; two stops read visibly harder
      node.style.background = `radial-gradient(circle at 50% 50%, ${rgba(c, 1)} 0%, ${rgba(
        c,
        0.5
      )} 45%, ${rgba(c, 0)} 100%)`;
      node.dataset.travel = String(s.travel * unit);
    });
  }

  function stop() {
    running.forEach((a) => a.cancel());
    running = [];
    nodes.forEach((n) => {
      n.style.transform = 'none';
      // five full-screen layers held on the compositor for nothing is a real
      // cost on a phone, and under reduced motion they never move again
      n.style.willChange = '';
    });
  }

  function drift(node) {
    if (lessMotion()) return;
    const travel = Number(node.dataset.travel) || 0;
    const angle = Math.random() * Math.PI * 2;
    const distance = travel * (0.3 + Math.random() * 0.7);
    const duration = MIN_LEG_MS + Math.random() * (MAX_LEG_MS - MIN_LEG_MS);
    const to = `translate(${Math.cos(angle) * distance}px, ${
      Math.sin(angle) * distance
    }px) scale(${0.85 + Math.random() * 0.45})`;
    const anim = node.animate([{ transform: node.style.transform || 'none' }, { transform: to }], {
      duration,
      easing: LEG_EASE,
      fill: 'forwards',
    });
    running.push(anim);
    anim.finished
      .then(() => {
        node.style.transform = to;
        anim.cancel();
        running = running.filter((a) => a !== anim);
        drift(node);
      })
      .catch(() => {
        /* cancelled by a theme change or a resize; a fresh leg is already queued */
      });
  }

  function start() {
    stop();
    if (lessMotion()) return;
    nodes.forEach((n) => {
      n.style.willChange = 'transform';
      drift(n);
    });
  }

  paint();
  start();

  // Remounting on a theme change swaps the gradients cleanly; the reset in blob
  // position is hidden by the full-screen colour change on the same frame.
  theme.onChange(() => {
    paint();
    start();
  });

  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      paint();
      if (!running.length) start();
    }, 150);
  });

  reduced.addEventListener('change', () => (lessMotion() ? stop() : start()));
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* =================================================================== reveal */

/** The one recipe. Fires once, unobserves immediately, never replays. */
function initReveal() {
  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        obs.unobserve(e.target);
        e.target.classList.add('in');
        const fn = e.target.__onReveal;
        if (fn) {
          delete e.target.__onReveal;
          // let the reveal's own transition own the first frame
          setTimeout(fn, lessMotion() ? 0 : 120);
        }
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -12% 0px' }
  );
  $$('.reveal').forEach((n) => io.observe(n));
  return io;
}

/** Run `fn` the first time `node` is on screen — used for the one-shot moments. */
function onceVisible(node, fn) {
  if (!node) return;
  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        obs.unobserve(e.target);
        obs.disconnect();
        fn();
      }
    },
    { threshold: 0.25 }
  );
  io.observe(node);
}

/* ==================================================================== store */

/**
 * One month, in memory, reset on reload. Deliberately not persisted: a returning
 * visitor finding someone else's old taps would be a bug this page invented for
 * itself.
 */
const NOW = new Date();
const YEAR_N = NOW.getFullYear();
const MONTH_N = NOW.getMonth();
const TODAY = NOW.getDate();
const DAYS = monthLength(YEAR_N, MONTH_N);

const HABITS = ['Wake 6:00', 'Read 20 pages', 'Train', 'No sugar'];

/** Deterministic, so the sample month is the same one for everybody. */
function seeded(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const store = {
  grid: new Map(),
  listeners: [],
  key: (d, r) => `${d}:${r}`,
  get(d, r) {
    return this.grid.get(this.key(d, r)) || 0;
  },
  set(d, r, v) {
    this.grid.set(this.key(d, r), v);
    this.emit();
  },
  cycle(d, r) {
    const next = (this.get(d, r) + 1) % 3;
    this.set(d, r, next);
    return next;
  },
  onChange(fn) {
    this.listeners.push(fn);
  },
  emit() {
    this.listeners.forEach((fn) => fn());
  },
  /** every past day pre-filled; today left blank, because today is the visitor's */
  seed() {
    this.grid.clear();
    for (let d = 1; d < TODAY; d++) {
      for (let r = 0; r < HABITS.length; r++) {
        const v = seeded(d * 7 + r * 31);
        this.grid.set(this.key(d, r), v > 0.82 ? 2 : v > 0.12 ? 1 : 0);
      }
    }
    this.emit();
  },
  stats() {
    let done = 0;
    for (let d = 1; d <= DAYS; d++)
      for (let r = 0; r < HABITS.length; r++) if (this.get(d, r) === 1) done++;
    const total = DAYS * HABITS.length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  },
  /**
   * `computeStreaks` in src/streaks.ts: a day counts when at least one habit was
   * done. A missed mark is not consulted at all — a day where you did three of
   * four things is still a day you turned up. And an unanswered today falls back
   * to yesterday, so an empty today does not read as a break.
   *
   * Unlike the app, this counts within the sample month only; there is no
   * previous month here to run back into.
   */
  streak() {
    const doneOn = (d) => {
      for (let r = 0; r < HABITS.length; r++) if (this.get(d, r) === 1) return true;
      return false;
    };
    let n = 0;
    for (let d = doneOn(TODAY) ? TODAY : TODAY - 1; d >= 1 && doneOn(d); d--) n++;
    return n;
  },
  /** what the year grid reads: { habitCount, tallies: { day: {done, missed} } } */
  tallies() {
    const t = {};
    for (let d = 1; d <= DAYS; d++) {
      let done = 0;
      let missed = 0;
      for (let r = 0; r < HABITS.length; r++) {
        const v = this.get(d, r);
        if (v === 1) done++;
        else if (v === 2) missed++;
      }
      if (done || missed) t[d] = { done, missed };
    }
    return { habitCount: HABITS.length, tallies: t };
  },
};

store.seed();

/* ============================================================ the mark, drawn */

function paintMarks() {
  const p = theme.palette;
  $$('[data-mark]').forEach((node) => {
    node.innerHTML = markSVG({ box: 200, mode: theme.mode, palette: p });
    const svg = node.firstElementChild;
    if (svg) svg.setAttribute('focusable', 'false');
  });
}

/* ========================================================== radial tracker */

const GLYPH_TICK = 'M5 10.5 L8.6 14 L15 6.6';
const GLYPH_CROSS = 'M6.2 6.2 L13.8 13.8 M13.8 6.2 L6.2 13.8';

/**
 * MarkButton.tsx strokes these at 2.8 inside a 24-unit box, which lands at 2.33
 * on a 20px button. Ours is a 20-unit box, so the width has to scale with it or
 * the glyph comes out a fifth heavier than the app's.
 */
function glyph(d, width = 2.33) {
  return `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none"><path d="${d}" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/**
 * The app's radial, live. Only today's column is markable — that is the app's
 * own rule, and demonstrating it by refusal says more than a paragraph would.
 */
function buildRadial(svg, { size, interactive, days = DAYS, habits = HABITS.length, today = TODAY }) {
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.innerHTML = '';
  const g = el('g');
  svg.appendChild(g);

  const cellNodes = new Map();
  const cells = trackerCells(size, days, habits, (d, r) =>
    interactive ? store.get(d, r) : sampleAt(d, r, today)
  );

  for (const c of cells) {
    const path = el('path', { d: c.d, class: 'cell' });
    // the delegated handler needs to tell a past day from a future one and from
    // a placeholder ring, so each cell carries its own position
    path.dataset.day = String(c.day);
    path.dataset.real = c.real ? '1' : '';
    if (interactive && c.real && c.day === today) {
      path.classList.add('live');
      path.setAttribute('role', 'button');
      path.setAttribute('tabindex', c.ring === 0 ? '0' : '-1');
      path.dataset.ring = String(c.ring);
      path.addEventListener('click', () => mark(c.day, c.ring, path));
      path.addEventListener('keydown', (ev) => {
        // a <path role="button"> gets no synthesised click from the browser the
        // way a real <button> would, so Enter and Space have to be wired by hand
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
          ev.preventDefault(); // and stop Space scrolling the page under the focus ring
          mark(c.day, c.ring, path);
          return;
        }
        onCellKey(ev, c.ring);
      });
    }
    g.appendChild(path);
    cellNodes.set(`${c.day}:${c.ring}`, path);
  }

  for (const l of trackerDayLabels(size, days)) {
    const t = el('text', {
      x: l.x.toFixed(2),
      y: l.y.toFixed(2),
      'text-anchor': 'middle',
      // the app's +3.5 is a baseline nudge calibrated to Josefin in React Native;
      // on the web the browser can centre it properly
      'dominant-baseline': 'central',
      class: l.day === today ? 'daylabel today' : 'daylabel',
    });
    t.textContent = String(l.day);
    g.appendChild(t);
  }

  function onCellKey(ev, ring) {
    const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[ev.key];
    if (!dir) return;
    ev.preventDefault();
    const next = Math.min(habits - 1, Math.max(0, ring + dir));
    const target = cellNodes.get(`${today}:${next}`);
    if (!target) return;
    $$('.cell.live', svg).forEach((n) => n.setAttribute('tabindex', '-1'));
    target.setAttribute('tabindex', '0');
    target.focus();
  }

  function mark(day, ring, node) {
    const v = store.cycle(day, ring);
    if (!lessMotion()) {
      node.classList.remove('pop');
      void node.getBBox();
      node.classList.add('pop');
    }
    announce(`${HABITS[ring]}: ${['pending', 'done', 'missed'][v]}`);
  }

  function repaint() {
    const p = theme.palette;
    const fills = [p.cellEmpty, p.done, p.missed];
    for (const c of cells) {
      const node = cellNodes.get(`${c.day}:${c.ring}`);
      if (!node) continue;
      const state = interactive
        ? c.real
          ? store.get(c.day, c.ring)
          : 0
        : c.real
        ? sampleAt(c.day, c.ring, today)
        : 0;
      node.setAttribute('fill', fills[state]);
      node.setAttribute('stroke', c.real ? p.line : p.lineFaint);
      if (c.real && c.day === today && interactive) {
        node.setAttribute(
          'aria-label',
          `${HABITS[c.ring]}, day ${c.day}: ${['pending', 'done', 'missed'][state]}`
        );
      }
    }
  }

  repaint();
  return { repaint, cellNodes, cells };
}

/**
 * The non-interactive diagram's month: deterministic, and full of holes because
 * a real month is. Nothing after the highlighted day is marked — a chart that
 * shows next week as already done is arguing against the app's own rule.
 */
function sampleAt(d, r, today = 12) {
  if (d >= today) return 0;
  const v = seeded(d * 11 + r * 17 + 3);
  return v > 0.86 ? 2 : v > 0.16 ? 1 : 0;
}

let liveEl = null;
function announce(msg) {
  if (!liveEl) return;
  liveEl.textContent = msg;
}

/* ========================================================== the hero build */

/**
 * LaunchIntro.tsx, ported. The unmarked ring fades up first, then each marked
 * day blooms out of the centre with a little overshoot, clockwise from twelve;
 * the today marker drops last. The card is interactive from the first frame —
 * nothing is being constructed during the reveal.
 *
 * Gated behind two rAFs: an animation started during the initial layout stall
 * takes a stale frame timestamp, and its first visible frame then lands most of
 * the way through the run.
 */
function playHeroBuild(radial) {
  if (lessMotion()) return;
  const marked = [];
  for (let d = 1; d < TODAY; d++) {
    const nodes = [];
    for (let r = 0; r < HABITS.length; r++) {
      const n = radial.cellNodes.get(`${d}:${r}`);
      if (n && store.get(d, r)) nodes.push(n);
    }
    if (nodes.length) marked.push(nodes);
  }

  const svg = radial.cellNodes.values().next().value?.ownerSVGElement;
  if (svg) svg.style.setProperty('transform-origin', '50% 50%');

  const bloomed = new Set(marked.flat());
  const pending = [...radial.cellNodes.values()].filter((n) => !bloomed.has(n));
  pending.forEach((n) =>
    n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: EASE.out, fill: 'backwards' })
  );

  const step = Math.min(60, 720 / Math.max(1, marked.length));
  marked.forEach((nodes, i) => {
    const delay = 220 + i * step;
    nodes.forEach((n) => {
      n.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 300,
        delay,
        easing: EASE.out,
        fill: 'backwards',
      });
      // scale about the centre of the whole chart, not the cell's own centroid
      n.animate(
        [
          { transform: 'scale(0.5)', transformOrigin: '50% 50%', transformBox: 'view-box' },
          { transform: 'scale(1)', transformOrigin: '50% 50%', transformBox: 'view-box' },
        ],
        { duration: 300, delay, easing: EASE.bloom, fill: 'backwards' }
      );
    });
  });

  const labels = $$('.daylabel', svg || document);
  // T.tick in LaunchIntro.tsx is [860, 1160] = 220 + (FILLED-1)*60 + 220: a beat
  // after the last sector begins, not immediately after the last one lands
  const settled = 220 + Math.max(0, marked.length - 1) * step + 220;
  labels.forEach((n) => {
    const isToday = n.classList.contains('today');
    n.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 300,
      delay: isToday ? settled : 300,
      easing: EASE.out,
      fill: 'backwards',
    });
    // the accent marker for today drops in last, on the tick's own overshoot
    if (isToday) {
      n.animate(
        [
          { transform: 'scale(0.7)', transformOrigin: '50% 50%', transformBox: 'fill-box' },
          { transform: 'scale(1)', transformOrigin: '50% 50%', transformBox: 'fill-box' },
        ],
        { duration: 300, delay: settled, easing: EASE.drop, fill: 'backwards' }
      );
    }
  });
}

/* ================================================================ the hero */

function initHero() {
  const card = $('#demo');
  if (!card) return;

  liveEl = $('#demo-live');
  const svg = $('#hero-radial');
  const size = 420;
  const radial = buildRadial(svg, { size, interactive: true });

  const list = $('#demo-check');
  HABITS.forEach((name, r) => {
    const row = document.createElement('div');
    row.className = 'checkrow';
    row.innerHTML =
      `<p>${name}</p>` +
      `<button type="button" class="mark done" aria-pressed="false" aria-label="Mark ${name} done">${glyph(GLYPH_TICK)}</button>` +
      `<button type="button" class="mark miss" aria-pressed="false" aria-label="Mark ${name} missed">${glyph(GLYPH_CROSS)}</button>`;
    const [doneBtn, missBtn] = $$('.mark', row);
    doneBtn.addEventListener('click', () => toggle(r, 1));
    missBtn.addEventListener('click', () => toggle(r, 2));
    list.appendChild(row);
  });

  function toggle(ring, want) {
    const v = store.get(TODAY, ring);
    store.set(TODAY, ring, v === want ? 0 : want);
    const node = radial.cellNodes.get(`${TODAY}:${ring}`);
    if (node && !lessMotion()) {
      node.classList.remove('pop');
      void node.getBBox();
      node.classList.add('pop');
    }
  }

  const caption = $('#demo-caption');
  const defaultCaption = caption.textContent;
  /**
   * Tapping a dead cell answers with the app's own rule rather than doing
   * nothing — but there are three different reasons a cell is dead, and telling
   * someone a future day is "locked in the past" is its own small lie.
   */
  svg.addEventListener('click', (ev) => {
    const path = ev.target.closest('.cell');
    if (!path || path.classList.contains('live')) return;
    const day = Number(path.dataset.day);
    caption.textContent = !path.dataset.real
      ? 'That ring has no habit on it yet. The empty ones are drawn so the grid keeps its shape.'
      : day > TODAY
      ? 'That day has not happened yet.'
      : 'Past days are locked. Only today can be marked.';
    clearTimeout(caption.__t);
    caption.__t = setTimeout(() => (caption.textContent = defaultCaption), 3600);
  });

  const bar = $('#demo-bar i');
  const statsLine = $('#demo-stats');
  const streakWrap = $('#demo-streak');

  function refresh() {
    radial.repaint();
    const s = store.stats();
    bar.style.transform = `scaleX(${s.pct / 100})`;
    statsLine.innerHTML = `<b class="num">${s.done}</b> / ${s.total} this month · ${s.pct}%`;
    const days = store.streak();
    streakWrap.innerHTML =
      flameSVG({ size: 19, lit: days > 0, idPrefix: 'heroFlame' }) + `<span>${days}</span>`;
    // StreakBadge.tsx dims the flame and the count to 0.45, not the pill around them
    streakWrap.style.opacity = days > 0 ? '1' : String(FLAME_DIM);
    streakWrap.setAttribute(
      'aria-label',
      days > 0 ? `Streak active, ${days} ${days === 1 ? 'day' : 'days'}` : 'No active streak'
    );
    HABITS.forEach((name, r) => {
      const row = list.children[r];
      const v = store.get(TODAY, r);
      $$('.mark', row).forEach((b, i) =>
        b.setAttribute('aria-pressed', String(v === i + 1))
      );
    });
  }

  store.onChange(refresh);
  theme.onChange(refresh);
  refresh();

  $('#demo-reset').addEventListener('click', () => {
    store.seed();
    announce('Demo month reset.');
  });

  $('#month-label').innerHTML = `<b>${MONTH_NAMES[MONTH_N]}</b><i>${YEAR_N}</i>`;

  requestAnimationFrame(() => requestAnimationFrame(() => playHeroBuild(radial)));
}

/* ================================================================ refusals */

function initRefusals() {
  const list = $('#refusals');
  if (!list) return;
  $$('li', list).forEach((li, i) => li.style.setProperty('--i', String(i)));
  onceVisible(list, () => list.classList.add('struck'));
}

/* ================================================================== ledger */

/**
 * Every request this page has made, as the browser reports it. Not a claim about
 * privacy — an instrument. If a third-party script were ever added, this table
 * would list it without anyone remembering to update the copy.
 */
function initLedger() {
  const body = $('#ledger-body');
  if (!body) return;
  const count = $('#ledger-count');
  const seen = new Set();
  let third = 0;

  function add(entry) {
    const url = entry.name;
    if (seen.has(url)) return;
    seen.add(url);
    let origin;
    let file;
    try {
      const u = new URL(url, location.href);
      origin = u.origin === location.origin ? 'this page' : u.host;
      file = u.pathname.split('/').filter(Boolean).pop() || '/';
    } catch (e) {
      return;
    }
    if (origin !== 'this page') third++;
    const size = entry.transferSize
      ? `${Math.max(1, Math.round(entry.transferSize / 1024))} kB`
      : entry.decodedBodySize
      ? `${Math.max(1, Math.round(entry.decodedBodySize / 1024))} kB*`
      : '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${origin}</td><td>${file}</td><td>${size}</td>`;
    body.appendChild(tr);
    count.textContent = String(third);
    count.style.color = third === 0 ? 'var(--done-ink)' : 'var(--missed-ink)';
  }

  performance.getEntriesByType('navigation').forEach(add);
  performance.getEntriesByType('resource').forEach(add);
  try {
    new PerformanceObserver((l) => l.getEntries().forEach(add)).observe({ type: 'resource', buffered: true });
  } catch (e) {
    /* no PerformanceObserver: the table still holds everything loaded so far */
  }
}

/* ============================================================ fading streak */

function initFadeGrid() {
  const svg = $('#fadegrid');
  if (!svg) return;
  const { width, height, rects } = fadingStreak();
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  // Built once and only recoloured afterwards. Replacing the nodes on a theme
  // change would restart their one-shot reveal animation, so the grid would
  // wipe itself in again every time the toggle was pressed.
  const nodes = rects.map((r) => {
    const rect = el('rect', {
      x: r.x,
      y: r.y,
      width: r.size,
      height: r.size,
      rx: 4,
      style: `--c:${r.col}`,
    });
    svg.appendChild(rect);
    return rect;
  });

  function paint() {
    const p = theme.palette;
    rects.forEach((r, i) =>
      nodes[i].setAttribute('fill', r.level < 0 ? p.cellEmpty : p.ghLevels[r.level])
    );
  }
  paint();
  theme.onChange(paint);
  // the picture is about a fade, so the reveal enacts the argument: dense left
  // columns land first, the thin right ones trail off
  onceVisible(svg, () => svg.classList.add('play'));
}

/* ============================================================ the diagram */

function initDiagram() {
  const svg = $('#diagram-radial');
  if (!svg) return;
  const built = buildRadial(svg, { size: 420, interactive: false, days: 30, habits: 4, today: 12 });
  theme.onChange(built.repaint);

  // one cell demonstrates the cycle exactly once, and stops. A loop would be a
  // screensaver, and this page's argument is that you should do it yourself.
  onceVisible(svg, () => {
    if (lessMotion()) return;
    const node = built.cellNodes.get('12:2');
    if (!node) return;
    // pending, done, missed, and back to whatever this cell actually holds —
    // ending on a literal would leave the diagram disagreeing with its own data
    const seq = ['cellEmpty', 'done', 'missed', ['cellEmpty', 'done', 'missed'][sampleAt(12, 2)]];
    seq.forEach((tone, i) => {
      setTimeout(() => {
        node.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
        node.setAttribute('fill', theme.palette[tone]);
      }, 600 + i * 700);
    });
  });
}

/* ================================================================== views */

function initViews() {
  const host = $('#views');
  if (!host) return;
  const panels = { year: $('#panel-year'), day: $('#panel-day'), history: $('#panel-history') };
  let current = 'year';
  let index = 0;

  const control = segmented(
    $('#views-seg'),
    [
      { value: 'year', label: 'Year' },
      { value: 'day', label: 'Day' },
      { value: 'history', label: 'History' },
    ],
    'year',
    (value, i) => {
      const dir = i > index ? 1 : -1;
      index = i;
      Object.entries(panels).forEach(([k, node]) => {
        node.hidden = k !== value;
        node.classList.remove('enter');
      });
      const node = panels[value];
      node.style.setProperty('--from', `${dir * 34}px`);
      void node.offsetWidth;
      node.classList.add('enter');
      current = value;
      if (value === 'history') renderHistory();
      if (value === 'day') renderDay();
    }
  );
  void control;

  /* ------------------------------------------------------------- year grid */
  const yearSvg = $('#yeargrid');
  const gutter = $('#yeargutter');
  const cal = yearCalendar(YEAR_N);
  // the gutter lives outside the scroller, so the grid's own space starts at 0
  const cells = yearCells(YEAR_N).map((c) => ({ ...c, x: c.x - YEAR.WEEKDAY_COL_W }));
  const width = cal.weekCount * YEAR.STEP;
  const height = YEAR.MONTH_ROW_H + 7 * YEAR.STEP;
  yearSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  yearSvg.setAttribute('width', String(width));
  yearSvg.setAttribute('height', String(height));
  gutter.setAttribute('viewBox', `0 0 ${YEAR.WEEKDAY_COL_W} ${height}`);
  gutter.setAttribute('width', String(YEAR.WEEKDAY_COL_W));
  gutter.setAttribute('height', String(height));
  const rectFor = new Map();

  function buildYear() {
    gutter.innerHTML = '';
    WEEKDAY_SHORT.forEach((w, r) => {
      if (!w) return;
      const t = el('text', {
        x: 0,
        y: YEAR.MONTH_ROW_H + r * YEAR.STEP + YEAR.STEP / 2,
        'dominant-baseline': 'central',
        class: 'wd',
      });
      t.textContent = w;
      gutter.appendChild(t);
    });

    yearSvg.innerHTML = '';
    const g = el('g', { class: 'g' });
    MONTH_ABBR.forEach((name, m) => {
      const t = el('text', { x: cal.monthStartCol[m] * YEAR.STEP, y: 10 });
      t.textContent = name;
      g.appendChild(t);
    });
    for (const c of cells) {
      const rect = el('rect', { x: c.x, y: c.y, width: c.size, height: c.size, rx: 3 });
      g.appendChild(rect);
      rectFor.set(`${c.m}:${c.d}`, rect);
    }
    yearSvg.appendChild(g);
    paintYear();
  }

  function paintYear() {
    const p = theme.palette;
    const months = yearMonths();
    $$('text', yearSvg).forEach((t) => {
      if (t.classList.contains('wd')) return;
      t.setAttribute('fill', MONTH_ABBR.indexOf(t.textContent) === MONTH_N ? p.accent : p.inkSoft);
    });
    let total = 0;
    for (const c of cells) {
      const rect = rectFor.get(`${c.m}:${c.d}`);
      const lv = yearLevel(c.m, c.d, months);
      rect.setAttribute('fill', lv.missed ? p.ghMissed : p.ghLevels[lv.level]);
      const info = months[c.m];
      if (info && info.tallies[c.d]) total += info.tallies[c.d].done;
      const isToday = c.m === MONTH_N && c.d === TODAY;
      if (isToday) {
        rect.setAttribute('stroke', p.accent);
        rect.setAttribute('stroke-width', '1.5');
        rect.setAttribute('x', c.x + 0.75);
        rect.setAttribute('y', c.y + 0.75);
        rect.setAttribute('width', c.size - 1.5);
        rect.setAttribute('height', c.size - 1.5);
      }
    }
    $('#year-total').textContent = String(total);
    $$('#year-ramp i').forEach((i, k) => (i.style.background = p.ghLevels[k]));
  }

  /**
   * The current month is the visitor's own marks; the rest is sample data, with
   * a four-day hole left in March on purpose. A habit site with a perfect grid
   * is selling a fantasy.
   */
  function yearMonths() {
    const months = [];
    for (let m = 0; m < 12; m++) {
      if (m === MONTH_N) {
        months.push(store.tallies());
        continue;
      }
      if (m > MONTH_N) {
        months.push({ habitCount: 0, tallies: {} });
        continue;
      }
      const len = monthLength(YEAR_N, m);
      const tallies = {};
      for (let d = 1; d <= len; d++) {
        if (m === 2 && d >= 11 && d <= 14) continue; // the travel week
        const v = seeded(m * 97 + d * 13);
        const thin = m === 7 ? 0.45 : 0.16;
        if (v < thin) continue;
        const done = Math.max(1, Math.round(v * 4));
        tallies[d] = { done: Math.min(4, done), missed: v > 0.93 ? 1 : 0 };
      }
      months.push({ habitCount: 4, tallies });
    }
    return months;
  }

  buildYear();
  theme.onChange(paintYear);
  store.onChange(() => {
    paintYear();
    if (current === 'day') renderDay();
    if (current === 'history') renderHistory();
  });

  // The sample months only run up to the current one — a year grid showing next
  // August as already done would contradict the app's own rule. So the caption
  // only mentions March once March is behind us.
  const yearNote = $('#year-note');
  if (yearNote) {
    yearNote.textContent =
      MONTH_N > 2
        ? 'Today is yours. The rest of this month, and the months behind it, are sample data, with a travel week in March, because a real month has holes in it.'
        : 'Today is yours. The rest of this month, and the months behind it, are sample data. It has holes in it, because a real month does.';
  }

  const scroller = $('#year-scroll');
  scroller.scrollLeft = Math.max(0, cal.monthStartCol[MONTH_N] * YEAR.STEP - YEAR.STEP);

  // one element, one property, ~365 static rects underneath. Staggering each cell
  // would be 365 animations for a worse result.
  onceVisible(scroller, () => {
    if (!lessMotion()) yearSvg.classList.add('wipe');
  });

  /* --------------------------------------------------------------- the day */
  function renderDay() {
    const host2 = $('#panel-day-list');
    host2.innerHTML = '';
    HABITS.forEach((name, r) => {
      const v = store.get(TODAY, r);
      const row = document.createElement('div');
      row.className = 'checkrow';
      row.innerHTML =
        `<p>${name}</p>` +
        `<span class="hchip ${v === 1 ? 'done' : v === 2 ? 'miss' : ''}" ${
          v ? '' : 'style="border-color:var(--line);background:none;color:var(--ink-soft)"'
        }>${v === 1 ? glyph(GLYPH_TICK, 3) : v === 2 ? glyph(GLYPH_CROSS, 3) : ''}${
          v === 1 ? 'done' : v === 2 ? 'missed' : 'pending'
        }</span>`;
      host2.appendChild(row);
    });
  }

  /* ------------------------------------------------------------- the history */
  function renderHistory() {
    const host2 = $('#panel-history-list');
    host2.innerHTML = '';
    let shown = 0;
    for (let d = TODAY; d >= 1 && shown < 8; d--) {
      const chips = [];
      for (let r = 0; r < HABITS.length; r++) {
        const v = store.get(d, r);
        if (!v) continue;
        chips.push(
          `<span class="hchip ${v === 1 ? 'done' : 'miss'}">${glyph(
            v === 1 ? GLYPH_TICK : GLYPH_CROSS,
            3
          )}${HABITS[r]}</span>`
        );
      }
      if (!chips.length) continue;
      shown++;
      const row = document.createElement('div');
      row.className = 'histrow';
      row.innerHTML = `<b>${MONTH_ABBR[MONTH_N]} ${d}</b><div class="hchips">${chips.join('')}</div>`;
      host2.appendChild(row);
    }
    if (!shown) {
      host2.innerHTML = '<p class="caption">Nothing marked yet. Mark a few cells at the top of this page.</p>';
    }
  }

  renderDay();
  renderHistory();
}

/* =============================================================== deadlines */

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const PRESSURE_WINDOW = 7 * DAY_MS;

/** src/deadlines.ts — coarse duration, largest unit only. */
function coarse(ms) {
  if (ms >= DAY_MS) return `${Math.floor(ms / DAY_MS)}d`;
  if (ms >= HOUR_MS) return `${Math.floor(ms / HOUR_MS)}h`;
  if (ms >= 60000) return `${Math.floor(ms / 60000)}m`;
  return 'moments';
}

function timeLeftLabel(left) {
  if (left <= 0) {
    const over = coarse(-left);
    return over === 'moments' ? 'just overdue' : `${over} overdue`;
  }
  const rem = coarse(left);
  return rem === 'moments' ? 'due any moment' : `${rem} left`;
}

/**
 * The label is 11px bold on the chip, so it takes the ink variants; the bar
 * beside it is a solid block and keeps the raw state colour.
 */
function urgencyTone(left) {
  if (left <= HOUR_MS) return 'var(--missed-ink)';
  if (left <= 3 * DAY_MS) return 'var(--accent-ink)';
  return 'var(--ink-soft)';
}

function urgencyFill(left) {
  if (left <= HOUR_MS) return 'var(--missed)';
  if (left <= 3 * DAY_MS) return 'var(--accent)';
  return 'var(--ink-soft)';
}

const RUNGS = [
  { label: '3 days', at: 3 * DAY_MS },
  { label: '1 day', at: DAY_MS },
  { label: '3 hours', at: 3 * HOUR_MS },
  { label: '1 hour', at: HOUR_MS },
  { label: 'Due', at: 0 },
  { label: 'The morning after', at: -1 },
];

function initDeadlines() {
  const slider = $('#pressure-slider');
  if (!slider) return;
  const label = $('#task-left');
  const fill = $('#task-fill');
  const track = $('#task-track');
  const ladder = $('#ladder');

  // the ticks are placed so the spacing visibly tightens toward the deadline
  const POS = [3, 28, 51, 68, 83, 97];
  RUNGS.forEach((r, i) => {
    const li = document.createElement('li');
    li.style.setProperty('--x', `${POS[i]}%`);
    li.style.setProperty('--d', `${[0, 90, 170, 240, 300, 350][i]}ms`);
    li.innerHTML = `<i></i><span>${r.label}</span>`;
    ladder.appendChild(li);
  });

  /** slider 0 → seven days out, 100 → a day overdue */
  function leftFor(v) {
    return 7 * DAY_MS - (v / 100) * 8 * DAY_MS;
  }

  function render(animate) {
    const left = leftFor(Number(slider.value));
    const pressure = left <= 0 ? 1 : left >= PRESSURE_WINDOW ? 0 : 1 - left / PRESSURE_WINDOW;
    label.textContent = timeLeftLabel(left);
    label.style.color = urgencyTone(left);
    fill.style.background = urgencyFill(left);
    track.classList.toggle('ease', !!animate);
    fill.style.transform = `scaleX(${pressure})`;
    $$('li', ladder).forEach((li, i) => {
      const r = RUNGS[i];
      const passed = r.at === -1 ? left <= -0.5 * DAY_MS : left <= r.at;
      li.classList.toggle('lit', passed);
    });
    slider.setAttribute('aria-valuetext', timeLeftLabel(left));
  }

  // direct manipulation: 1:1, unsmoothed, no transition — exactly as the app
  // scrubs a swipe-back
  slider.addEventListener('input', () => render(false));

  // Ticking one off files it away: Deadlines.tsx lists only what is outstanding.
  // Here it just settles, because there is nothing else in the list to fall to.
  const check = $('#task-check');
  const task = check.closest('.task');
  check.addEventListener('click', () => {
    const done = check.getAttribute('aria-pressed') !== 'true';
    check.setAttribute('aria-pressed', String(done));
    check.innerHTML = done ? glyph(GLYPH_TICK, 3) : '';
    task.classList.toggle('done', done);
    label.style.color = done ? 'var(--ink-soft)' : urgencyTone(leftFor(Number(slider.value)));
    if (done) label.textContent = 'done';
    else render(false);
  });

  onceVisible(ladder, () => {
    if (!lessMotion()) {
      ladder.classList.add('play');
      $('#notif').classList.add('arrive');
    }
    render(!lessMotion());
  });
  render(false);
}

/* ================================================================== backup */

/** Crockford base32, as src/backup.ts generates it: 24 characters, six groups of four. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newCode() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => ALPHABET[b % 32]);
  return chars.join('').replace(/(.{4})(?=.)/g, '$1-');
}

function initBackup() {
  const box = $('#backup-code');
  if (!box) return;
  const regen = () => (box.textContent = newCode());
  regen();
  $('#backup-new').addEventListener('click', (e) => {
    regen();
    flash(e.currentTarget, 'New code');
  });
  $('#backup-copy').addEventListener('click', (e) => copy(box.textContent, e.currentTarget));
}

function flash(btn, text) {
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.textContent = text;
  clearTimeout(btn.__t);
  btn.__t = setTimeout(() => (btn.textContent = original), 1400);
}

function copy(text, btn) {
  navigator.clipboard
    ?.writeText(text)
    .then(() => flash(btn, 'Copied'))
    .catch(() => flash(btn, 'Press ⌘C'));
}

function initCopyButtons() {
  $$('[data-copy]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const target = $(btn.dataset.copy);
      if (target) copy(target.innerText.trim(), btn);
    })
  );
}

/* ================================================================ colophon */

function initColophon() {
  const q = $('#quote');
  if (q) q.textContent = `“${quoteForDate(NOW)}”`;

  const proof = $('#proof');
  if (!proof) return;

  // The claim in this section is checkable, so check it rather than assert it:
  // regenerate all 48 paths at the shipped asset's own radius and compare the
  // first one, character for character, with what is committed in assets/logo.
  const generated = markCells(512, 512, 440)[0].d;
  const committed =
    'M528.24 285.54A227.04 227.04 0 0 1 611.17 307.76L595.41 340.22A190.96 190.96 0 0 0 525.66 321.53Z';
  $('#proof-generated').textContent = generated;
  $('#proof-committed').textContent = committed;
  const same = generated === committed;
  $('#proof-verdict').textContent = same
    ? 'Identical, character for character.'
    : 'These have drifted apart. The site is wrong, not the app.';
  $('#proof-verdict').style.color = same ? 'var(--done-ink)' : 'var(--missed-ink)';

  proof.addEventListener('toggle', () => {
    if (!proof.open) return;
    const svg = $('#proof-mark svg');
    if (!svg || lessMotion() || proof.dataset.played) return;
    proof.dataset.played = '1';
    // The only place the launch animation ever repeats. markSVG appends the tick
    // after the 48 cells, so it has to be sliced off before the day-major index
    // mapping — left in, it reads as day 12 and drops in first instead of last.
    const paths = $$('path', svg);
    const CELLS = MARK.SECTORS * MARK.RINGS;
    const bloom = [
      { transform: 'scale(0.5)', transformOrigin: '50% 50%', transformBox: 'view-box' },
      { transform: 'scale(1)', transformOrigin: '50% 50%', transformBox: 'view-box' },
    ];

    paths.slice(0, CELLS).forEach((p, i) => {
      const day = Math.floor(i / MARK.RINGS);
      const isMarked = day < MARK.FILLED;
      const delay = isMarked ? 220 + day * 60 : 0;
      p.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 300,
        delay,
        easing: EASE.out,
        fill: 'backwards',
      });
      if (isMarked) {
        p.animate(bloom, { duration: 300, delay, easing: EASE.bloom, fill: 'backwards' });
      }
    });

    // T.tick: a beat after the last sector begins, on the heavier overshoot
    const tickPath = paths[CELLS];
    if (tickPath) {
      const tickAt = 220 + (MARK.FILLED - 1) * 60 + 220;
      tickPath.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 300,
        delay: tickAt,
        easing: EASE.out,
        fill: 'backwards',
      });
      tickPath.animate(
        [
          { transform: 'scale(0.7)', transformOrigin: '50% 50%', transformBox: 'view-box' },
          { transform: 'scale(1)', transformOrigin: '50% 50%', transformBox: 'view-box' },
        ],
        { duration: 300, delay: tickAt, easing: EASE.drop, fill: 'backwards' }
      );
    }
  });
}

/* ==================================================================== boot */

/* ================================================================ showcase */

/**
 * The screenshot rail, driven by the page's own scroll.
 *
 * The rail pins under the masthead and each stretch of scrolling carries the
 * next capture into the middle, where it holds for a moment before the next one
 * takes over. The choreography is a set of keyframes, not per-frame arithmetic:
 * where the browser has scroll-driven animations the compositor runs them from
 * the same scroll sample that places the sticky pin, so nothing here runs on the
 * main thread while scrolling and the captures cannot trail the pin by a frame;
 * elsewhere the same keyframes are scrubbed from a scroll listener that reads
 * one number and lays out nothing. Transform and opacity only, like everything
 * else here. Under reduced motion, or with no JS at all, the rail stays the
 * plain swipeable strip it is in the markup, so nothing depends on this running.
 */
function initShowcase() {
  const rail = $('#widgets .rail');
  if (!rail) return;
  const figures = $$('figure', rail);
  const n = figures.length;
  if (n < 2) return;

  /** px the masthead covers: 56 tall plus its hairline */
  const PIN_TOP = 57;
  /** each capture sits still for this share of its step at either end; the glide is the middle half */
  const HOLD = 0.25;
  /**
   * Smoothstep, as a bezier: control points at a third and two thirds make it
   * t²(3 − 2t) exactly, which is the app's inOut(ease) to within half a percent
   * and leaves and arrives at rest, so a hold hands over to a glide with no
   * kick. The sampled --rn-inout table does not: its first segment sets off at
   * a slope of 0.27, which reads as a nudge at the start of every step.
   */
  const GLIDE = 'cubic-bezier(0.33, 0, 0.67, 1)';
  /**
   * By distance from the held capture. Scale never passes 1, because a composited
   * layer is rastered at the largest scale it will ever show and the held capture
   * would blur. Two away is already gone, so nothing reaches the column edge with
   * any weight behind it; the pin's mask takes the rest.
   */
  const DEPTH = [
    { s: 1, o: 1 },
    { s: 0.88, o: 0.5 },
    { s: 0.82, o: 0 },
  ];
  const depth = (d) => DEPTH[Math.min(d, DEPTH.length - 1)];
  /** the caption's landing move: the reveal recipe's rise, at two thirds its distance */
  const CAPTION_RISE = 8;
  /** scroll-driven animations: Chrome 115+, Safari 26+; Firefox stable still keeps them behind a flag */
  const canCompose = typeof ViewTimeline === 'function' && CSS.supports('animation-timeline: view()');
  let mounted = null;

  /** `el` builds SVG nodes; this rail needs ordinary HTML ones. */
  const html = (tag, attrs = {}) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };

  /**
   * One property track across the whole pinned stretch: at every whole step the
   * value for that capture, the same value a quarter of the way in, then a
   * smoothstep glide to the next capture's value that lands three quarters in.
   * Every hand-over starts and ends at rest, and holds for half of every step.
   */
  function track(valueAt) {
    const kf = [];
    for (let j = 0; j < n; j++) {
      kf.push({ offset: j / (n - 1), ...valueAt(j), easing: 'linear' });
      if (j === n - 1) break;
      kf.push({ offset: (j + HOLD) / (n - 1), ...valueAt(j), easing: GLIDE });
      kf.push({ offset: (j + 1 - HOLD) / (n - 1), ...valueAt(j + 1), easing: 'linear' });
    }
    return kf;
  }
  /** capture 0 sits in the middle at rest (the rail's padding puts it there), so position j is j steps left */
  const figureTrack = (i, step) =>
    track((j) => ({ translate: `${-j * step}px 0px`, scale: String(depth(Math.abs(i - j)).s) }));
  const frameTrack = (i) => track((j) => ({ opacity: String(depth(Math.abs(i - j)).o) }));
  /** only the held capture is named, and its name lands the way a reveal does */
  const captionTrack = (i) =>
    track((j) =>
      i === j ? { opacity: '1', translate: '0px 0px' } : { opacity: '0', translate: `0px ${CAPTION_RISE}px` }
    );

  function mount() {
    const showcase = html('div', { class: 'showcase' });
    const pin = html('div', { class: 'showcase-pin' });
    const dots = html('div', { class: 'showcase-dots', role: 'group', 'aria-label': 'Choose a screenshot' });
    rail.before(showcase);
    pin.append(rail, dots);
    showcase.append(pin);
    showcase.style.setProperty('--slides', String(n));
    rail.classList.add('scrolly');
    const label = rail.getAttribute('aria-label');
    rail.setAttribute('aria-label', 'App screenshots');

    const buttons = figures.map((fig, i) => {
      const name = fig.querySelector('figcaption')?.textContent.split('·')[0].trim() || `Screenshot ${i + 1}`;
      const b = html('button', { type: 'button', 'aria-label': `Show screenshot ${i + 1} of ${n}: ${name}` });
      b.addEventListener('click', () => go(i));
      dots.append(b);
      return b;
    });

    /** measured on resize only, never per frame */
    const geo = { top: 0, range: 1, step: 0 };
    /** three per capture, in order: figure (translate, scale), frame (opacity), caption (opacity, rise) */
    let anims = [];
    let composed = false;
    let ro = null;
    let near = null;
    let frame = 0;
    /** where the scroll was at the last paint, in captures; NaN forces the next paint through */
    let lastPos = NaN;
    let active = -1;
    /** the capture a dot or key is carrying the page to, or -1 */
    let target = -1;

    // Defined before anything that can throw, so a browser with the API in a
    // shape this does not expect gets the plain strip back rather than a rail
    // stranded in a pin that never moves.
    mounted = () => {
      window.removeEventListener('scroll', request);
      rail.removeEventListener('keydown', onKey);
      ro?.disconnect();
      near?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      // nothing was ever written inline, so cancelling is the whole clean-up
      anims.forEach((a) => a.cancel());
      rail.classList.remove('scrolly', 'live');
      if (label) rail.setAttribute('aria-label', label);
      showcase.before(rail);
      showcase.remove();
      mounted = null;
    };

    /**
     * The same keyframes either way; only the clock differs. Composed, the
     * subject is .showcase (static in flow, never the sticky pin) seen through a
     * scrollport shortened by the masthead, so 'contain 0%' is the pin engaging
     * and 'contain 100%' is it letting go — the stretch the height formula in
     * site.css lays out. Scrubbed, it is a paused second that paint() winds.
     */
    function build(compose) {
      const timing = compose
        ? {
            timeline: new ViewTimeline({ subject: showcase, axis: 'block', inset: [CSS.px(PIN_TOP), CSS.px(0)] }),
            rangeStart: 'contain 0%',
            rangeEnd: 'contain 100%',
            fill: 'both',
          }
        : { duration: 1000, fill: 'both' };
      figures.forEach((fig, i) => {
        anims.push(
          fig.animate(figureTrack(i, geo.step), timing),
          $('.frame', fig).animate(frameTrack(i), timing),
          $('figcaption', fig).animate(captionTrack(i), timing)
        );
      });
      if (!compose) anims.forEach((a) => a.pause());
    }

    /**
     * Runs inside the ResizeObserver, after layout, so these reads force nothing;
     * and once at mount, so the first frame is already right. offsetLeft ignores
     * transforms, so the step is the laid-out one however far the rail has moved.
     */
    function measure() {
      const r = showcase.getBoundingClientRect();
      geo.top = window.scrollY + r.top - PIN_TOP;
      geo.range = Math.max(1, r.height - pin.offsetHeight);
      const step = figures[1].offsetLeft - figures[0].offsetLeft;
      if (step !== geo.step) {
        geo.step = step;
        for (let i = 0; i < n; i++) anims[i * 3]?.effect.setKeyframes(figureTrack(i, step));
      }
      lastPos = NaN;
    }

    function paint() {
      // the one read per frame; scrollY flushes no layout
      const t = Math.min(1, Math.max(0, (window.scrollY - geo.top) / geo.range));
      const pos = t * (n - 1);
      if (pos === lastPos) return;
      if (!composed) for (const a of anims) a.currentTime = t * 1000;
      const now = Math.round(pos);
      // a jump is in flight until it lands, or until the scroll turns away from it
      if (target >= 0 && (now === target || Math.abs(pos - target) > Math.abs(lastPos - target))) target = -1;
      lastPos = pos;
      if (now !== active) {
        if (active >= 0) buttons[active].removeAttribute('aria-current');
        buttons[now].setAttribute('aria-current', 'true');
        active = now;
      }
    }

    function request() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint();
      });
    }

    /** Scroll the window to where capture `i` sits dead centre. */
    function go(i) {
      const k = Math.min(n - 1, Math.max(0, i));
      target = k;
      window.scrollTo({ top: geo.top + (geo.range * k) / (n - 1), behavior: lessMotion() ? 'auto' : 'smooth' });
    }

    function onKey(e) {
      const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      // step from where a jump in flight will land, not from the dot, so a second press mid-glide is one more
      const from = target >= 0 ? target : active;
      if (e.key in moves) go(from + moves[e.key]);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(n - 1);
      else return;
      e.preventDefault();
    }

    measure();
    if (canCompose) {
      try {
        build(true);
        composed = true;
      } catch (err) {
        // the API is there but not in the shape expected: scrub the same keyframes instead
        anims.forEach((a) => a.cancel());
        anims = [];
      }
    }
    if (!composed) build(false);
    paint();
    rail.addEventListener('keydown', onKey);

    // documentElement too: anything above the section changing height (the
    // proof panel opening, a late font) moves the stage's document offset
    ro = new ResizeObserver(() => {
      measure();
      paint();
    });
    ro.observe(showcase);
    ro.observe(figures[0]);
    ro.observe(document.documentElement);

    // The scroll listener and the promoted layers exist only while the stage is
    // within a screen, as the blobs are only promoted while they drift. The first
    // time it comes near, every capture is fetched and decoded, so none pops in
    // half-way through a glide.
    let primed = false;
    near = new IntersectionObserver(
      (entries) => {
        const close = entries[entries.length - 1].isIntersecting;
        rail.classList.toggle('live', close);
        window.removeEventListener('scroll', request);
        if (close) window.addEventListener('scroll', request, { passive: true });
        if (close && !primed) {
          primed = true;
          $$('img', rail).forEach((img) => {
            img.loading = 'eager';
            img.decode?.().catch(() => {
              /* not decodable yet, or never; it still paints when it arrives */
            });
          });
        }
        request();
      },
      { rootMargin: '100% 0px' }
    );
    near.observe(showcase);
  }

  const sync = () => {
    if (lessMotion()) {
      mounted?.();
      return;
    }
    if (mounted) return;
    try {
      mount();
    } catch (err) {
      // the rail has already been moved into the pin; put the plain strip back
      mounted?.();
      throw err;
    }
  };
  sync();
  reduced.addEventListener('change', sync);
}

/**
 * Each piece is enhancement, so each one fails alone. The reveal styles only
 * apply once `.js` is set, and `.js` is only set once the observer is armed —
 * so a browser that never gets here, or a section that throws, shows the page
 * plain rather than showing nothing at all.
 */
function attempt(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`[rin] ${name} failed`, err);
  }
}

function boot() {
  // the head script armed a fallback that un-hides everything if we never got here
  clearTimeout(window.__rinFallback);
  attempt('reveal', initReveal);
  attempt('marks', () => {
    paintMarks();
    theme.onChange(paintMarks);
  });
  attempt('theme', initTheme);
  attempt('ground', initGround);
  attempt('hero', initHero);
  attempt('refusals', initRefusals);
  attempt('ledger', initLedger);
  attempt('fade grid', initFadeGrid);
  attempt('diagram', initDiagram);
  attempt('views', initViews);
  attempt('deadlines', initDeadlines);
  attempt('showcase', initShowcase);
  attempt('backup', initBackup);
  attempt('copy buttons', initCopyButtons);
  attempt('colophon', initColophon);
  // present on the landing page only; the policy page shares this module
  const yearLabel = $('#year-now');
  if (yearLabel) yearLabel.textContent = String(YEAR_N);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
