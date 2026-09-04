import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOUSE_TOLERANCE_PX,
  NODE_SLOP_PX,
  TOUCH_TOLERANCE_PX,
  coarsePointerMedia,
  distanceToSegment,
  isCoarsePointer,
  nearestSegment,
  pickTolerance,
} from '../src/lib/hit-test.js';

const P = (x, y) => ({ x, y });

test('distanceToSegment measures the whole segment, not its midpoint', () => {
  const a = P(0, 0);
  const b = P(100, 0);
  // On the line: zero everywhere between the endpoints.
  for (const x of [0, 1, 25, 50, 99, 100]) assert.equal(distanceToSegment(P(x, 0), a, b), 0);
  // Perpendicular offset, anywhere along the span — this is the v0.3.1 bug:
  // a point 4 px off the line near an endpoint used to be unreachable.
  assert.equal(distanceToSegment(P(4, 4), a, b), 4);
  assert.equal(distanceToSegment(P(96, 4), a, b), 4);
  assert.equal(distanceToSegment(P(50, 9), a, b), 9);
});

test('distanceToSegment clamps beyond the endpoints (a segment, not a line)', () => {
  const a = P(0, 0);
  const b = P(10, 0);
  assert.equal(distanceToSegment(P(-5, 0), a, b), 5);
  assert.equal(distanceToSegment(P(15, 0), a, b), 5);
  assert.equal(distanceToSegment(P(-3, 4), a, b), 5);
});

test('distanceToSegment survives a zero-length segment', () => {
  assert.equal(distanceToSegment(P(3, 4), P(0, 0), P(0, 0)), 5);
});

test('distanceToSegment is orientation-independent', () => {
  const p = P(30, 12);
  const a = P(0, 0);
  const b = P(100, 40);
  assert.equal(distanceToSegment(p, a, b).toFixed(9), distanceToSegment(p, b, a).toFixed(9));
});

test('tolerance follows the pointer: a finger is not a cursor', () => {
  assert.equal(pickTolerance({ pointerType: 'touch' }), TOUCH_TOLERANCE_PX);
  assert.equal(pickTolerance({ pointerType: 'pen' }), TOUCH_TOLERANCE_PX);
  assert.equal(pickTolerance({ pointerType: 'mouse' }), MOUSE_TOLERANCE_PX);
  assert.ok(TOUCH_TOLERANCE_PX > MOUSE_TOLERANCE_PX);
  assert.equal(TOUCH_TOLERANCE_PX, 22);
  assert.equal(MOUSE_TOLERANCE_PX, 10);
});

test('a coarse-pointer device widens the target even without pointerType', () => {
  const coarse = () => ({ matches: true });
  const fine = () => ({ matches: false });
  assert.equal(pickTolerance({}, coarse), TOUCH_TOLERANCE_PX);
  assert.equal(pickTolerance({}, fine), MOUSE_TOLERANCE_PX);
  assert.equal(pickTolerance(undefined, coarse), TOUCH_TOLERANCE_PX);
  // An explicit mouse on a touch screen stays precise.
  assert.equal(pickTolerance({ pointerType: 'mouse' }, coarse), MOUSE_TOLERANCE_PX);
  assert.equal(isCoarsePointer({ pointerType: 'touch' }, fine), true);
  assert.equal(coarsePointerMedia(coarse), true);
  // A throwing / missing matchMedia must never break picking.
  assert.equal(coarsePointerMedia(undefined), false);
  assert.equal(coarsePointerMedia(() => { throw new Error('no'); }), false);
});

test('nearestSegment returns the closest segment inside the tolerance', () => {
  const segments = [
    { id: 'far', a: P(0, 100), b: P(100, 100) },
    { id: 'near', a: P(0, 0), b: P(100, 0) },
  ];
  assert.equal(nearestSegment(P(50, 6), segments, TOUCH_TOLERANCE_PX)?.id, 'near');
  assert.equal(nearestSegment(P(50, 94), segments, TOUCH_TOLERANCE_PX)?.id, 'far');
  assert.equal(nearestSegment(P(50, 50), segments, TOUCH_TOLERANCE_PX), null);
  // Exactly on the tolerance still counts; one pixel past it does not.
  assert.equal(nearestSegment(P(50, 22), segments, TOUCH_TOLERANCE_PX)?.id, 'near');
  assert.equal(nearestSegment(P(50, 23), segments, TOUCH_TOLERANCE_PX), null);
  // The same tap with a mouse tolerance finds nothing: 12 px is out of reach.
  assert.equal(nearestSegment(P(50, 12), segments, MOUSE_TOLERANCE_PX), null);
  assert.equal(nearestSegment(P(50, 12), segments, TOUCH_TOLERANCE_PX)?.id, 'near');
});

test('nearestSegment skips segments the caller could not project', () => {
  const segments = [{ id: 'behind', a: null, b: P(10, 10) }, { id: 'ok', a: P(0, 0), b: P(10, 0) }];
  assert.equal(nearestSegment(P(5, 1), segments, MOUSE_TOLERANCE_PX)?.id, 'ok');
  assert.equal(nearestSegment(P(5, 1), [segments[0]], MOUSE_TOLERANCE_PX), null);
});

test('the node slop is small enough that an edge can still win a tap', () => {
  // A node only steals the tap when the finger is on the star itself.
  assert.equal(NODE_SLOP_PX, 6);
  assert.ok(NODE_SLOP_PX < MOUSE_TOLERANCE_PX);
});
