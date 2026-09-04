// Deterministic palette. Categories are discovered from the data, so colours
// are derived from the value itself rather than from a fixed vocabulary.
import { hashString } from './layout.js';

const GOLDEN_ANGLE = 137.508;

/** Stable hue in [0,360) for any string. */
export function hueFor(value) {
  return (hashString(String(value)) * GOLDEN_ANGLE) % 360;
}

/** Fill colour for a category (node type). */
export function colorFor(value, { saturation = 62, lightness = 55, alpha = 1 } = {}) {
  const h = hueFor(value).toFixed(1);
  return alpha >= 1
    ? `hsl(${h} ${saturation}% ${lightness}%)`
    : `hsl(${h} ${saturation}% ${lightness}% / ${alpha})`;
}

/** Darker variant, used for node outlines and legend text. */
export function inkFor(value) {
  return colorFor(value, { saturation: 55, lightness: 32 });
}

// --------------------------------------------------------------------------
// Epistemic status palette (CDC §4 "Couleur", brief §19: never colour alone)
// --------------------------------------------------------------------------

// Known epistemic states get a stable, meaningful hue; anything else falls
// back to the deterministic hash so unknown vocabularies still separate.
const STATUS_HUES = {
  confirmed: 152,
  explicit: 212,
  inferred: 268,
  candidate: 38,
  unresolved: 318,
  rejected: 6,
  deprecated: 20,
};

/** Canonical status bucket, or null when the value is outside the known set. */
export function statusKind(status) {
  const key = String(status ?? '').trim().toLowerCase();
  return key in STATUS_HUES ? key : null;
}

/** True for the states the UI must make visually prominent (§27, §28). */
export function isTentative(status) {
  const key = String(status ?? '').trim().toLowerCase();
  return key === 'candidate' || key === 'unresolved';
}

/**
 * Colour for an epistemic status, readable on both themes.
 * @param {string} status
 * @param {{dark?:boolean, alpha?:number}} [options]
 */
export function statusColor(status, { dark = false, alpha = 1 } = {}) {
  const key = statusKind(status);
  const h = (key ? STATUS_HUES[key] : hueFor(status)).toFixed(1);
  const saturation = key ? 58 : 50;
  const lightness = dark ? 62 : 44;
  return alpha >= 1
    ? `hsl(${h} ${saturation}% ${lightness}%)`
    : `hsl(${h} ${saturation}% ${lightness}% / ${alpha})`;
}

/**
 * Node shape for a type (§4 "Forme"): shape carries the type so colour is
 * never the only channel.
 * @returns {'circle'|'square'|'diamond'|'triangle'}
 */
export function shapeForType(type) {
  const key = String(type ?? '').trim().toLowerCase();
  if (key === 'source') return 'square';
  if (key === 'decision') return 'diamond';
  if (key === 'hypothese' || key === 'hypothesis' || key === 'hypothèse') return 'triangle';
  return 'circle';
}

// --------------------------------------------------------------------------
// Star tints (v0.3.1 "constellation pass")
// --------------------------------------------------------------------------
//
// On the night ground a fully saturated hue reads as a coloured chart dot, not
// as a star. Real stars are near-white with a *bias*: the hue survives, the
// chroma does not. `starTint` therefore blends the category hue toward a cool
// white so the sky reads as one luminous family, while the pairwise distance
// between tints stays large enough to keep the type channel legible
// (test/colors.test.mjs asserts both the family and the separation).
//
// v0.3.2: the day theme is the *same* language with the luminance inverted —
// a dark star on a pale sky. The blend target flips from a cool white to a deep
// navy, everything else (family, depth cue, pairwise separation) is unchanged.

/** Cool white the night tints converge toward (#dfe8ff). */
export const STAR_WHITE = Object.freeze([223, 232, 255]);

/** Deep navy the day tints converge toward (#1e2a44). */
export const STAR_INK = Object.freeze([30, 42, 68]);

/** How far a night tint travels toward `STAR_WHITE` (0 = raw hue, 1 = white). */
export const STAR_TINT_MIX = 0.55;

/** How far a day tint travels toward `STAR_INK` (0 = raw hue, 1 = navy). */
export const STAR_INK_MIX = 0.4;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** h in [0,360), s/l in [0,1] → [r,g,b] each in [0,255]. */
export function hslToRgb(h, s, l) {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * clamp01(s);
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (hh < 60) rgb = [c, x, 0];
  else if (hh < 120) rgb = [x, c, 0];
  else if (hh < 180) rgb = [0, c, x];
  else if (hh < 240) rgb = [0, x, c];
  else if (hh < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => Math.round((v + m) * 255));
}

/** Blend an [r,g,b] toward the cool star white by `mix` ∈ [0,1]. */
export function coolBlend(rgb, mix = STAR_TINT_MIX) {
  const m = clamp01(mix);
  return rgb.map((v, i) => Math.round(v + (STAR_WHITE[i] - v) * m));
}

/** Blend an [r,g,b] toward the deep navy ink by `mix` ∈ [0,1] (day theme). */
export function inkBlend(rgb, mix = STAR_INK_MIX) {
  const m = clamp01(mix);
  return rgb.map((v, i) => Math.round(v + (STAR_INK[i] - v) * m));
}

function rgbCss([r, g, b], alpha = 1) {
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Star colour for a category, in the current theme's luminance direction.
 *
 * Night: the hue, pushed toward cool white and cooled further with depth — a
 * pale star on a black ground. Day: the same hue, pushed toward a deep navy
 * and *deepened* further with depth — a dark star on a pale sky. Both keep the
 * pairwise separation the type channel needs (see test/colors.test.mjs).
 *
 * @param {string} value node type (or any category)
 * @param {{dark?:boolean, hue?:number, alpha?:number, mix?:number, cool?:number}} [options]
 *   `cool` 0…1 is the depth cue: it drains chroma and pushes the tint further
 *   toward the theme's blend target (white-blue at night, navy by day).
 */
export function starTint(value, { dark = false, hue = null, alpha = 1, mix = null, cool = 0 } = {}) {
  const h = Number.isFinite(hue) ? hue : hueFor(value);
  const c = clamp01(cool);
  if (!dark) {
    // Day: a deep, legible core tint. Lightness sits well below the pale sky
    // so the star reads as ink, and depth pushes it further into the navy.
    const base = hslToRgb(h, 0.66 - c * 0.16, 0.44);
    return rgbCss(inkBlend(base, clamp01((mix ?? STAR_INK_MIX) + c * 0.18)), alpha);
  }
  // Night: distant stars get a touch less chroma and a touch more blue-white.
  const base = hslToRgb(h, 0.88 - c * 0.2, 0.62);
  return rgbCss(coolBlend(base, clamp01((mix ?? STAR_TINT_MIX) + c * 0.18)), alpha);
}

/** Same treatment for an epistemic status, so the status projection matches. */
export function statusTint(status, { dark = false, alpha = 1, cool = 0 } = {}) {
  const key = statusKind(status);
  const h = key ? STATUS_HUES[key] : hueFor(status);
  return starTint(String(status ?? ''), { dark, hue: h, alpha, cool });
}
