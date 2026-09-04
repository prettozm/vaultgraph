// Shared "living constellation" helpers for both graph canvases (v0.3, Lot R).
//
// Design rule: **every visual effect maps to a meaning.** Brightness and size
// encode degree, halo encodes selection/focus/hover, dashed encodes candidate /
// unresolved, dimming encodes "outside the current focus", depth separation
// encodes the projection layer. Motion is ambient only — it never carries
// information, so turning it off (`animation: false`, or the OS
// `prefers-reduced-motion` setting) loses nothing analytic.
//
// Everything above the "canvas helpers" divider is pure: no DOM, no canvas, no
// globals — that half is what test/starfield.test.mjs exercises.
import { hashString, mulberry32 } from '../lib/layout.js';

const TAU = Math.PI * 2;

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Deterministic per-node noise
// ---------------------------------------------------------------------------

/** Stable pseudo-random number in [0, 1) for any string. Same id → same value. */
export function hash01(id) {
  return hashString(String(id)) / 4294967296;
}

/**
 * Ambient drift for one star: the sum of two incommensurate sines with a
 * per-node phase, so no two nodes breathe in step and the field never pulses.
 * Periods land in 9–17 s — slow enough to read as "alive", never as motion the
 * eye has to track.
 *
 * @param {string} id node id (fixes the phase and the two periods)
 * @param {number} tSeconds elapsed seconds
 * @param {number} [amplitude=2.5] maximum excursion, in the caller's units
 * @param {boolean} [enabled=true] false ⇒ identity (0, 0): a still layout
 * @returns {{dx:number, dy:number}} |dx| ≤ amplitude, |dy| ≤ amplitude
 */
export function driftOffset(id, tSeconds, amplitude = 2.5, enabled = true) {
  const a = finite(amplitude, 2.5);
  const t = finite(tSeconds, 0);
  if (!enabled || a === 0) return { dx: 0, dy: 0 };
  const h1 = hash01(id);
  const h2 = hash01(`${id}~drift`);
  const p1 = 9 + h1 * 8; // 9 … 17 s
  const p2 = 11 + h2 * 6; // 11 … 17 s
  const ph1 = h1 * TAU;
  const ph2 = h2 * TAU;
  // weights sum to 1 ⇒ the result is bounded by `amplitude` on both axes.
  const dx = a * (0.62 * Math.sin((TAU * t) / p1 + ph1) + 0.38 * Math.sin((TAU * t) / p2 + ph2 * 1.7));
  const dy = a * (0.62 * Math.cos((TAU * t) / p2 + ph2) + 0.38 * Math.sin((TAU * t * 1.31) / p1 + ph1));
  return { dx, dy };
}

/**
 * Gentle intensity factor for one star, period 3–6 s.
 * @returns {number} in [0.92, 1.08]; exactly 1 when `enabled` is false.
 */
export function twinkle(id, tSeconds, enabled = true) {
  if (!enabled) return 1;
  const t = finite(tSeconds, 0);
  const h = hash01(id);
  const period = 3 + h * 3; // 3 … 6 s
  return 1 + 0.08 * Math.sin((TAU * t) / period + h * TAU);
}

// ---------------------------------------------------------------------------
// Star classes: size ↔ degree
// ---------------------------------------------------------------------------

/**
 * Four star classes by connectivity. The degree is normalised against the
 * graph's maximum on a sqrt scale (so a single mega-hub does not flatten
 * everyone else) and cut into quarters:
 *
 *   bucket 0  √(d/max) < 0.25   leaf / near-leaf
 *   bucket 1  < 0.50            connected
 *   bucket 2  < 0.75            well connected
 *   bucket 3  ≥ 0.75            hub
 *
 * Monotonic: a higher degree never yields a smaller bucket.
 */
export function sizeBucket(degree, maxDegree) {
  const m = Math.max(1, finite(maxDegree, 1));
  const d = clamp(finite(degree, 0), 0, m);
  const t = Math.sqrt(d / m);
  if (t < 0.25) return 0;
  if (t < 0.5) return 1;
  if (t < 0.75) return 2;
  return 3;
}

/** Core radius multipliers per star class (bucket 0 → 3). */
export const BUCKET_SCALE = Object.freeze([0.85, 1.2, 1.6, 2.15]);

/** Core radius for a star class, in whatever unit `base` is expressed. */
export function radiusFor(bucket, base = 5) {
  const b = clamp(Math.round(finite(bucket, 0)), 0, 3);
  return finite(base, 5) * BUCKET_SCALE[b];
}

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

/**
 * Resolve the `quality` option. 'auto' degrades on big graphs and narrow
 * canvases so a phone or a 500-node view never pays for the full effect.
 * @returns {'low'|'medium'|'high'}
 */
export function qualityFor(options = {}, context = {}) {
  const asked = options?.quality ?? 'auto';
  if (asked === 'low' || asked === 'high') return asked;
  const nodeCount = finite(context?.nodeCount, 0);
  const width = finite(context?.width, 1024);
  if (nodeCount > 450 || width < 480) return 'low';
  if (width < 900) return 'medium';
  return 'high';
}

/** Background particle count for a resolved quality. */
export function particleCountFor(quality) {
  if (quality === 'low') return 0;
  if (quality === 'medium') return 75;
  return 140;
}

/** Halo alpha per glow level; 'off' means no halo at all. */
export const GLOW_ALPHA = Object.freeze({ off: 0, low: 0.25, medium: 0.45, high: 0.65 });

/** Halo radius as a multiple of the core radius, per glow level. */
export const GLOW_SPREAD = Object.freeze({ off: 0, low: 2.2, medium: 2.6, high: 3 });

// ---------------------------------------------------------------------------
// Visual options
// ---------------------------------------------------------------------------

/** Z-spread multiplier per `layers` mode (3D only). */
export const LAYER_SPREAD = Object.freeze({ flat: 0.08, layered: 1, expanded: 1.9 });

/** Hard ceiling on drawn labels, even in `labels: 'all'`. */
export const MAX_LABELS = 300;

const LABEL_MODES = new Set(['auto', 'hover', 'all', 'off']);
const GLOW_LEVELS = new Set(['off', 'low', 'medium', 'high']);
const LAYER_MODES = new Set(['flat', 'layered', 'expanded']);
const QUALITY_MODES = new Set(['auto', 'low', 'high']);
const THEMES = new Set(['light', 'dark']);

export function prefersReducedMotion() {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/** Current theme: an explicit `data-theme` wins, else the OS preference. */
export function detectTheme(root = globalThis.document?.documentElement) {
  const explicit = root?.dataset?.theme;
  if (explicit === 'dark' || explicit === 'light') return explicit;
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** The defaults both views boot with. */
export function defaultVisualOptions(root) {
  return {
    animation: !prefersReducedMotion(),
    labels: 'auto',
    edges: true,
    glow: 'medium',
    layers: 'layered',
    quality: 'auto',
    theme: detectTheme(root),
  };
}

/** Merge a partial update, silently ignoring values outside the vocabulary. */
export function mergeVisualOptions(current, partial = {}) {
  const next = { ...current };
  if (typeof partial.animation === 'boolean') next.animation = partial.animation;
  if (typeof partial.edges === 'boolean') next.edges = partial.edges;
  if (LABEL_MODES.has(partial.labels)) next.labels = partial.labels;
  if (GLOW_LEVELS.has(partial.glow)) next.glow = partial.glow;
  if (LAYER_MODES.has(partial.layers)) next.layers = partial.layers;
  if (QUALITY_MODES.has(partial.quality)) next.quality = partial.quality;
  if (THEMES.has(partial.theme)) next.theme = partial.theme;
  return next;
}

// ---------------------------------------------------------------------------
// Background particles
// ---------------------------------------------------------------------------

/**
 * Deterministic sparse dust field. Same (count, w, h, seed) → same layout, so
 * a resize or a redraw never reshuffles the sky.
 * @returns {Array<{x:number,y:number,r:number,alpha:number,bucket:number,phase:number,speed:number,depth:number}>}
 */
export function createParticles(count, width, height, seed = 'starfield') {
  const n = Math.max(0, Math.round(finite(count, 0)));
  const w = Math.max(1, finite(width, 1));
  const h = Math.max(1, finite(height, 1));
  const rand = mulberry32(hashString(`${seed}:${n}`));
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const alpha = 0.08 + rand() * 0.27; // ≤ 0.35 — dust, never a second graph
    out.push({
      x: rand() * w,
      y: rand() * h,
      r: 0.6 + rand() * 1.0, // 0.6 … 1.6 px
      alpha,
      bucket: alpha < 0.17 ? 0 : alpha < 0.26 ? 1 : 2,
      phase: rand() * TAU,
      speed: 0.012 + rand() * 0.03, // rad/s — one lazy oscillation per ~3 min
      depth: 0.25 + rand() * 0.75, // parallax weight
    });
  }
  return out;
}

// ===========================================================================
// Canvas helpers (need a 2D context; not covered by the unit tests)
// ===========================================================================

const TOKENS = {
  dark: {
    bgTop: '#0b1020',
    bgBottom: '#04060c',
    vignette: 'rgba(0,0,0,0.55)',
    particle: '170, 190, 230',
    edge: '120, 130, 145',
    edgeFocus: '210, 225, 255',
    label: '#e6ecf7',
    labelSoft: '#93a1bb',
    halo: 'rgba(6,10,20,0.78)',
    glow: '255, 196, 120',
    plane: '140, 160, 210',
    accent: '#7fb2e5',
  },
  light: {
    bgTop: '#fbfbf9',
    bgBottom: '#e9edf4',
    vignette: 'rgba(20,30,50,0.10)',
    particle: '90, 110, 150',
    edge: '120, 130, 145',
    edgeFocus: '40, 70, 120',
    label: '#14243a',
    labelSoft: '#5c6675',
    halo: 'rgba(252,252,250,0.92)',
    glow: '201, 138, 0',
    plane: '120, 132, 150',
    accent: '#2f6f9f',
  },
};

function cssVar(styles, name, fallback) {
  try {
    const value = styles.getPropertyValue(name);
    return value && value.trim() ? value.trim() : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read the canvas palette from CSS custom properties (Lot U defines them in
 * styles.css); every token has a themed fallback so the canvas is correct even
 * before the stylesheet lands.
 */
export function readCanvasTokens(theme, root = globalThis.document?.documentElement) {
  const dark = theme === 'dark';
  const fb = dark ? TOKENS.dark : TOKENS.light;
  let styles;
  try {
    styles = globalThis.getComputedStyle(root);
  } catch {
    styles = { getPropertyValue: () => '' };
  }
  const edge = cssVar(styles, '--canvas-edge', fb.edge);
  const edgeFocus = cssVar(styles, '--canvas-edge-focus', fb.edgeFocus);
  const glow = cssVar(styles, '--canvas-glow', fb.glow);
  const particle = cssVar(styles, '--canvas-particle', fb.particle);
  const plane = cssVar(styles, '--canvas-plane', fb.plane);
  return {
    dark,
    bgTop: cssVar(styles, '--canvas-bg-top', fb.bgTop),
    bgBottom: cssVar(styles, '--canvas-bg-bottom', fb.bgBottom),
    vignette: cssVar(styles, '--canvas-vignette', fb.vignette),
    particleRgb: particle,
    edgeRgb: edge,
    edgeFocusRgb: edgeFocus,
    glowRgb: glow,
    planeRgb: plane,
    label: cssVar(styles, '--canvas-label', fb.label),
    labelSoft: cssVar(styles, '--canvas-label-soft', fb.labelSoft),
    halo: cssVar(styles, '--canvas-halo', fb.halo),
    accent: cssVar(styles, '--focus', fb.accent),
    edge: (alpha) => `rgba(${edge}, ${alpha})`,
    edgeFocusColor: (alpha) => `rgba(${edgeFocus}, ${alpha})`,
    glowColor: (alpha) => `rgba(${glow}, ${alpha})`,
    planeColor: (alpha) => `rgba(${plane}, ${alpha})`,
    particleColor: (alpha) => `rgba(${particle}, ${alpha})`,
  };
}

/**
 * Deep-space ground: vertical gradient, soft vignette, sparse drifting dust.
 * Fills the whole canvas, so it also replaces the old `clearRect`.
 */
export function paintBackground(ctx, width, height, tokens, options = {}) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const { particles = null, tSeconds = 0, quality = 'high', parallax = null, animation = true } = options;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, tokens.bgTop);
  grad.addColorStop(1, tokens.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const vignette = ctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.12, w / 2, h * 0.5, Math.max(w, h) * 0.78);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, tokens.vignette);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  if (quality === 'low' || !particles || !particles.length) return;
  const t = animation ? tSeconds : 0;
  const px = parallax?.x ?? 0;
  const py = parallax?.y ?? 0;
  // Batched by alpha bucket: three paths, three fills — no per-particle state.
  for (let bucket = 0; bucket < 3; bucket += 1) {
    let any = false;
    ctx.beginPath();
    for (const p of particles) {
      if (p.bucket !== bucket) continue;
      const dx = Math.sin(t * p.speed + p.phase) * 9 + px * p.depth;
      const dy = Math.cos(t * p.speed * 0.83 + p.phase) * 6 + py * p.depth;
      let x = (p.x + dx) % w;
      if (x < 0) x += w;
      let y = (p.y + dy) % h;
      if (y < 0) y += h;
      ctx.moveTo(x + p.r, y);
      ctx.arc(x, y, p.r, 0, TAU);
      any = true;
    }
    if (!any) continue;
    ctx.fillStyle = tokens.particleColor(bucket === 0 ? 0.13 : bucket === 1 ? 0.22 : 0.33);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Halo sprites
// ---------------------------------------------------------------------------

const SPRITE_SS = 2; // supersample factor: crisp halos on HiDPI screens

function makeOffscreen(size) {
  try {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(size, size);
  } catch {
    /* fall through to a DOM canvas */
  }
  const doc = globalThis.document;
  if (!doc?.createElement) return null;
  const c = doc.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/**
 * Pre-rendered soft radial halos, keyed by colour × radius (rounded to 0.5 px)
 * × glow level. Drawing a halo then costs exactly one `drawImage` — never a
 * per-node radial gradient. LRU-ish: ~300 entries, oldest evicted first.
 */
export function makeSpriteCache(limit = 300) {
  const map = new Map();
  return {
    get size() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    get(colorCss, radiusPx, glowLevel = 'medium') {
      const alpha = GLOW_ALPHA[glowLevel] ?? GLOW_ALPHA.medium;
      if (!alpha) return null;
      const r = Math.max(1, Math.round(radiusPx * 2) / 2);
      const key = `${colorCss}|${r}|${glowLevel}`;
      const hit = map.get(key);
      if (hit) {
        map.delete(key); // move to the most-recent end
        map.set(key, hit);
        return hit;
      }
      const spread = GLOW_SPREAD[glowLevel] ?? GLOW_SPREAD.medium;
      const halo = r * spread;
      const size = Math.max(4, Math.ceil(halo * 2) + 2);
      const canvas = makeOffscreen(size * SPRITE_SS);
      if (!canvas) return null;
      const g = canvas.getContext('2d');
      if (!g) return null;
      const c = (size * SPRITE_SS) / 2;
      const grad = g.createRadialGradient(c, c, Math.max(r * 0.2 * SPRITE_SS, 0.5), c, c, halo * SPRITE_SS);
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(0.42, `rgba(255,255,255,${(alpha * 0.4).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, size * SPRITE_SS, size * SPRITE_SS);
      // Tint the alpha profile with the star's own hue.
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = colorCss;
      g.fillRect(0, 0, size * SPRITE_SS, size * SPRITE_SS);
      const sprite = { canvas, size, half: size / 2 };
      map.set(key, sprite);
      if (map.size > limit) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      return sprite;
    },
  };
}

/**
 * Draw one star's halo at screen (x, y). `intensity` folds twinkle and the
 * focus dimming together. On 'low' quality a single flat circle stands in.
 */
export function drawHalo(ctx, cache, colorCss, x, y, radiusPx, glowLevel, intensity = 1, quality = 'high') {
  if (glowLevel === 'off') return;
  const alpha = clamp((GLOW_ALPHA[glowLevel] ?? 0) * clamp(intensity, 0, 2), 0, 1);
  if (alpha <= 0.01) return;
  const spread = GLOW_SPREAD[glowLevel] ?? GLOW_SPREAD.medium;
  if (quality === 'low' || !cache) {
    ctx.globalAlpha = alpha * 0.6;
    ctx.beginPath();
    ctx.arc(x, y, radiusPx * spread * 0.7, 0, TAU);
    ctx.fillStyle = colorCss;
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  const sprite = cache.get(colorCss, radiusPx, glowLevel);
  if (!sprite) return;
  ctx.globalAlpha = clamp(intensity, 0, 1.6) > 1 ? 1 : clamp(intensity, 0, 1);
  ctx.drawImage(sprite.canvas, x - sprite.half, y - sprite.half, sprite.size, sprite.size);
  ctx.globalAlpha = 1;
}

/** Linear interpolation used by the dim / layer easings. */
export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

/** Frame-rate independent easing step toward a target (≈ `ms` to converge). */
export function easeToward(current, target, dtSeconds, ms = 250) {
  if (!(ms > 0)) return target;
  const k = 1 - Math.exp((-dtSeconds * 4000) / ms);
  const next = current + (target - current) * clamp(k, 0, 1);
  return Math.abs(target - next) < 0.001 ? target : next;
}


/**
 * Greedy label placer: a label is drawn only if its box does not overlap one already placed
 * this frame (important labels are forced and still reserve their box). Readability first (§16).
 */
export function makeLabelPlacer(padding = 3) {
  const rects = [];
  return {
    tryPlace(x, y, w, h, force = false) {
      const r = { x0: x - padding, y0: y - padding, x1: x + w + padding, y1: y + h + padding };
      if (!force) {
        for (const o of rects) {
          if (r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) return false;
        }
      }
      rects.push(r);
      return true;
    },
    get count() { return rects.length; },
  };
}
