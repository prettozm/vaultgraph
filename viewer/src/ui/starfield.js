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

/** Peak twinkle excursion, as a fraction of the star's nominal brightness. */
export const TWINKLE_AMPLITUDE = 0.1;

/** Default per-node depth jitter, as a fraction of the layer spacing (3D). */
export const DEPTH_JITTER = 0.12;

/**
 * Gentle intensity factor for one star, period 4–9 s.
 * @returns {number} in [0.90, 1.10]; exactly 1 when `enabled` is false.
 */
export function twinkle(id, tSeconds, enabled = true) {
  if (!enabled) return 1;
  const t = finite(tSeconds, 0);
  const h = hash01(id);
  const period = 4 + h * 5; // 4 … 9 s
  return 1 + TWINKLE_AMPLITUDE * Math.sin((TAU * t) / period + h * TAU);
}

/**
 * Deterministic depth jitter inside a projection layer (3D). A layer becomes a
 * thin *cloud* of stars instead of a flat sheet — most of what makes the render
 * read as space rather than as a stacked chart. Purely presentational: which
 * layer a node belongs to never changes, only where inside it the star sits.
 *
 * @param {string} id node id
 * @param {number} [spread=DEPTH_JITTER] max excursion, in layer-spacing units
 * @returns {number} in [-spread, +spread]
 */
export function depthJitter(id, spread = DEPTH_JITTER) {
  const s = finite(spread, DEPTH_JITTER);
  return (hash01(`${id}~depth`) * 2 - 1) * s;
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
export const BUCKET_SCALE = Object.freeze([0.62, 1, 1.5, 2.1]);

/** Core radius for a star class, in whatever unit `base` is expressed. */
export function radiusFor(bucket, base = 5) {
  const b = clamp(Math.round(finite(bucket, 0)), 0, 3);
  return finite(base, 5) * BUCKET_SCALE[b];
}

/**
 * Nominal on-screen core radius per star class, in CSS pixels, at zoom 1.
 * The spread between a leaf and a hub is deliberately wide: on a night ground
 * size is the first thing the eye reads, so it has to carry the degree class
 * before brightness or colour do.
 */
export const CORE_PX = Object.freeze([2.9, 4.3, 6.4, 9]);

/**
 * Screen core radius for a star class. Zoom (or perspective scale) is applied
 * on a square root, so zooming in never turns hubs into blobs and zooming out
 * never collapses the whole sky into identical specks.
 */
export function coreRadiusPx(bucket, zoom = 1) {
  const b = clamp(Math.round(finite(bucket, 0)), 0, 3);
  const z = clamp(Math.sqrt(Math.max(finite(zoom, 1), 0)), 0.72, 2.6);
  return CORE_PX[b] * z;
}

/** How many of the highest-degree stars get the extra wide anchor bloom. */
export const ANCHOR_COUNT = 4;

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

/**
 * Background star count for a resolved quality. These are *sky*, not data:
 * a real cloud of points is what separates "deep space" from "dark chart", so
 * even the low tier keeps a thin field (it is one batched path per brightness
 * band — a few hundred sub-pixel arcs, not a few hundred draw calls).
 */
export function particleCountFor(quality) {
  if (quality === 'low') return 120;
  if (quality === 'medium') return 350;
  return 800;
}

/** Bloom alpha per glow level; 'off' means no bloom at all. */
export const GLOW_ALPHA = Object.freeze({
  off: 0,
  low: 0.35,
  medium: 0.55,
  high: 0.75,
  select: 0.5, // warm selection bloom (not user-selectable)
  anchor: 0.24, // the wide faint halo of the few brightest stars
});

/** Bloom radius as a multiple of the core radius, per glow level. */
export const GLOW_SPREAD = Object.freeze({
  off: 0,
  low: 5,
  medium: 6,
  high: 7,
  select: 8,
  anchor: 11,
});

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

/** Number of brightness bands the background sky is batched into. */
export const STAR_BANDS = 4;

/** Alpha drawn for each brightness band (band 0 = faintest). */
export const BAND_ALPHA = Object.freeze([0.08, 0.15, 0.24, 0.34]);

/** Fraction of background stars that get a tiny soft glow. */
export const GLOW_STAR_RATIO = 0.06;

/** Parallax speed of the three depth bands, slowest (far) first. */
export const PARALLAX_BANDS = Object.freeze([0.28, 0.6, 1]);

/**
 * Deterministic star field. Same (count, w, h, seed) → same sky, so a resize or
 * a redraw never reshuffles it.
 *
 * Brightness follows a log-ish law (`rand()^2.4`): a great many faint pinpricks,
 * a handful of bright ones. A uniform distribution is exactly what makes a
 * generated sky look generated — every point the same weight, no structure for
 * the eye to latch onto.
 *
 * `band` (0…3) batches the draw by brightness; `depth` (0…2) is the parallax
 * layer; `glow` marks the ~6 % that earn a soft bloom.
 *
 * @returns {Array<{x:number,y:number,r:number,alpha:number,band:number,bucket:number,
 *                  phase:number,speed:number,depth:number,parallax:number,glow:boolean}>}
 */
export function createParticles(count, width, height, seed = 'starfield') {
  const n = Math.max(0, Math.round(finite(count, 0)));
  const w = Math.max(1, finite(width, 1));
  const h = Math.max(1, finite(height, 1));
  const rand = mulberry32(hashString(`${seed}:${n}`));
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const x = rand() * w;
    const y = rand() * h;
    // ^3 ⇒ ~63 % of the sky in the faintest band, ~9 % in the brightest.
    const mag = rand() ** 3;
    const band = Math.min(STAR_BANDS - 1, Math.floor(mag * STAR_BANDS));
    const depth = Math.min(2, Math.floor(rand() * 3));
    out.push({
      x,
      y,
      r: 0.4 + mag * 1.2, // 0.4 … 1.6 px — bright stars are also the bigger ones
      alpha: BAND_ALPHA[band],
      band,
      bucket: Math.min(2, band), // legacy alias: three-bucket callers still work
      phase: rand() * TAU,
      speed: 0.006 + rand() * 0.016, // rad/s — one lazy oscillation per ~5 min
      depth,
      parallax: PARALLAX_BANDS[depth],
      glow: rand() < GLOW_STAR_RATIO,
    });
  }
  return out;
}

// ===========================================================================
// Canvas helpers (need a 2D context; not covered by the unit tests)
// ===========================================================================

const TOKENS = {
  dark: {
    bgTop: '#0a1020',
    bgBottom: '#04060c',
    vignette: 'rgba(0,0,0,0.65)',
    particle: '205, 220, 255',
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

// --- nebula haze -----------------------------------------------------------

/** The three haze blobs, as fractions of the canvas: x, y, radius, alpha. */
export const NEBULA_BLOBS = Object.freeze([
  Object.freeze({ x: 0.22, y: 0.28, r: 0.85, alpha: 0.07, rgb: '70, 110, 205' }),
  Object.freeze({ x: 0.8, y: 0.64, r: 0.75, alpha: 0.055, rgb: '95, 80, 195' }),
  Object.freeze({ x: 0.5, y: 0.92, r: 0.68, alpha: 0.045, rgb: '50, 135, 195' }),
]);

/**
 * Three very large, very soft radial blobs baked once into an offscreen canvas.
 * They are what gives the ground *volume* — a flat gradient reads as a panel,
 * a hazy one reads as depth — and re-baking only on resize keeps them free:
 * per frame this costs exactly one `drawImage`.
 */
export function makeNebulaCache() {
  let cached = null; // { canvas, width, height, key }
  return {
    clear() {
      cached = null;
    },
    /** @returns {?{canvas:*, width:number, height:number}} */
    get(width, height, key = 'dark') {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      if (cached && cached.width === w && cached.height === h && cached.key === key) return cached;
      const canvas = makeOffscreen(1);
      if (!canvas) return null;
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d');
      if (!g) return null;
      const span = Math.max(w, h);
      for (const blob of NEBULA_BLOBS) {
        const cx = blob.x * w;
        const cy = blob.y * h;
        const r = blob.r * span;
        const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `rgba(${blob.rgb}, ${blob.alpha})`);
        grad.addColorStop(0.55, `rgba(${blob.rgb}, ${(blob.alpha * 0.38).toFixed(4)})`);
        grad.addColorStop(1, `rgba(${blob.rgb}, 0)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
      }
      cached = { canvas, width: w, height: h, key };
      return cached;
    },
  };
}

/**
 * Deep-space ground: vertical gradient, cached nebula haze, a strong vignette
 * and the parallaxed star field. Fills the whole canvas, so it also replaces
 * the old `clearRect`.
 *
 * @param {object} options
 *   `particles` the field from `createParticles`; `parallax` {x,y} in px at
 *   depth band 1 (each band scales it by `PARALLAX_BANDS`); `nebula` a cache
 *   from `makeNebulaCache` (night theme only).
 */
export function paintBackground(ctx, width, height, tokens, options = {}) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const {
    particles = null,
    tSeconds = 0,
    quality = 'high',
    parallax = null,
    animation = true,
    nebula = null,
  } = options;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, tokens.bgTop);
  grad.addColorStop(1, tokens.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  if (tokens.dark && nebula) {
    const baked = nebula.get(w, h, 'dark');
    if (baked) ctx.drawImage(baked.canvas, 0, 0, w, h);
  }

  const vignette = ctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.1, w / 2, h * 0.5, Math.max(w, h) * 0.74);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.55, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, tokens.vignette);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  if (!particles || !particles.length) return;
  const t = animation ? tSeconds : 0;
  const px = parallax?.x ?? 0;
  const py = parallax?.y ?? 0;
  // Screen position of one star: its own extremely slow oscillation plus the
  // parallax of its depth band. Computed inline so the batching below stays
  // one path per brightness band — no per-star state, no per-star fillStyle.
  const at = (p) => {
    const wobble = animation ? 6 * p.parallax : 0;
    const dx = Math.sin(t * p.speed + p.phase) * wobble + px * p.parallax;
    const dy = Math.cos(t * p.speed * 0.83 + p.phase) * wobble * 0.7 + py * p.parallax;
    let x = (p.x + dx) % w;
    if (x < 0) x += w;
    let y = (p.y + dy) % h;
    if (y < 0) y += h;
    return { x, y };
  };

  const additive = tokens.dark;
  if (additive) ctx.globalCompositeOperation = 'lighter';
  for (let band = 0; band < STAR_BANDS; band += 1) {
    let any = false;
    ctx.beginPath();
    for (const p of particles) {
      if (p.band !== band) continue;
      const { x, y } = at(p);
      ctx.moveTo(x + p.r, y);
      ctx.arc(x, y, p.r, 0, TAU);
      any = true;
    }
    if (!any) continue;
    ctx.fillStyle = tokens.particleColor(BAND_ALPHA[band] ?? 0.2);
    ctx.fill();
  }
  // The ~6 % with a bloom: one extra path, drawn as slightly larger soft discs.
  if (quality !== 'low') {
    let any = false;
    ctx.beginPath();
    for (const p of particles) {
      if (!p.glow) continue;
      const { x, y } = at(p);
      ctx.moveTo(x + p.r * 3.2, y);
      ctx.arc(x, y, p.r * 3.2, 0, TAU);
      any = true;
    }
    if (any) {
      ctx.fillStyle = tokens.particleColor(0.07);
      ctx.fill();
    }
  }
  if (additive) ctx.globalCompositeOperation = 'source-over';
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
      // A wide bloom needs a *fast* falloff or it reads as a flat translucent
      // disc. Four stops approximate an inverse-square glow: bright pinpoint,
      // steep shoulder, long faint tail that dissolves into the ground.
      const grad = g.createRadialGradient(c, c, Math.max(r * 0.12 * SPRITE_SS, 0.5), c, c, halo * SPRITE_SS);
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(0.12, `rgba(255,255,255,${(alpha * 0.7).toFixed(3)})`);
      grad.addColorStop(0.3, `rgba(255,255,255,${(alpha * 0.26).toFixed(3)})`);
      grad.addColorStop(0.62, `rgba(255,255,255,${(alpha * 0.06).toFixed(3)})`);
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
    ctx.globalAlpha = alpha * 0.45;
    ctx.beginPath();
    ctx.arc(x, y, radiusPx * spread * 0.42, 0, TAU);
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

/** White-hot core: colour and radius ratio of the pinpoint inside a star. */
export const CORE_WHITE = 'rgba(255, 255, 255, 0.85)';
export const CORE_WHITE_RATIO = 0.46;

/**
 * The white-hot centre that turns a coloured dot into a star: the shape is
 * already filled with the type tint, this lays a small white pinpoint over it
 * so the rim keeps the hue and the middle burns out. Skipped below ~2.4 px,
 * where it would simply erase the tint.
 */
export function drawCoreLight(ctx, x, y, radiusPx, intensity = 1) {
  if (!(radiusPx >= 2.4)) return;
  const a = clamp(0.85 * clamp(intensity, 0, 1.2), 0, 1);
  if (a <= 0.02) return;
  ctx.beginPath();
  ctx.arc(x, y, radiusPx * CORE_WHITE_RATIO, 0, TAU);
  ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
  ctx.fill();
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
      const r = { x0: x - padding, y0: y - padding, x1: x + w + padding, y1: y + h + padding, forced: force };
      for (const o of rects) {
        // A forced label ignores ordinary labels but never overlaps another forced one.
        if (force && !o.forced) continue;
        if (r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) return false;
      }
      rects.push(r);
      return true;
    },
    get count() { return rects.length; },
  };
}
