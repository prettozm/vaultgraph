// Screen-space picking geometry, shared by both canvases (v0.3.2).
//
// v0.3.1 picked an edge within ~8 px of its *midpoint*, on a 1 px pale line:
// on a phone that is not a target, it is a lottery. Picking now runs along the
// whole segment, in CSS pixels, with a tolerance that follows the pointer:
// a fingertip is ~9 mm wide, a mouse cursor is one pixel.
//
// Pure geometry: no DOM, no canvas — test/hit-test.test.mjs covers all of it.

/** Pick tolerance for a finger (or any coarse pointer), in CSS pixels. */
export const TOUCH_TOLERANCE_PX = 22;

/** Pick tolerance for a mouse / pen, in CSS pixels. */
export const MOUSE_TOLERANCE_PX = 10;

/**
 * Slop added to a node's *core* radius before it wins over an edge.
 * Deliberately small: a node only steals the tap when the tap is genuinely on
 * the star, otherwise the edge under the finger is what the user meant.
 */
export const NODE_SLOP_PX = 6;

/**
 * Distance from point `p` to the segment `a`–`b` (all `{x, y}`), in the same
 * units as the inputs. A zero-length segment degrades to the point distance.
 */
export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 0)) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True when the OS reports the primary pointer as coarse (touch, most TVs). */
export function coarsePointerMedia(matchMedia = globalThis.matchMedia) {
  try {
    return matchMedia?.('(pointer: coarse)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Is this event a coarse-pointer event? The event's own `pointerType` wins
 * (a mouse plugged into a tablet must stay precise); the media query is the
 * fallback for synthetic events and for `matchMedia`-only contexts.
 */
export function isCoarsePointer(event, matchMedia = globalThis.matchMedia) {
  const type = event?.pointerType;
  if (type === 'touch' || type === 'pen') return true;
  if (type === 'mouse') return false;
  return coarsePointerMedia(matchMedia);
}

/**
 * Edge pick tolerance in CSS pixels for one pointer event.
 * @returns {number} `TOUCH_TOLERANCE_PX` for a finger, `MOUSE_TOLERANCE_PX` otherwise.
 */
export function pickTolerance(event, matchMedia = globalThis.matchMedia) {
  return isCoarsePointer(event, matchMedia) ? TOUCH_TOLERANCE_PX : MOUSE_TOLERANCE_PX;
}

/**
 * Nearest segment to `point` within `tolerance`, in screen pixels.
 *
 * @param {{x:number,y:number}} point
 * @param {Iterable<{id:*, a:{x:number,y:number}, b:{x:number,y:number}}>} segments
 *   Callers drop segments they cannot project (an endpoint behind the camera).
 * @param {number} tolerance
 * @returns {?{id:*, distance:number}}
 */
export function nearestSegment(point, segments, tolerance) {
  let best = null;
  let bestDist = tolerance;
  for (const s of segments) {
    if (!s?.a || !s?.b) continue;
    const d = distanceToSegment(point, s.a, s.b);
    if (d <= bestDist) {
      best = { id: s.id, distance: d };
      bestDist = d;
    }
  }
  return best;
}
