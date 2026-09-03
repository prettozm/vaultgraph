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
