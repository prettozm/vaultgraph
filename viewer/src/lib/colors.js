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
