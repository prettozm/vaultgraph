// Unit tests for the pure half of ui/starfield.js — no DOM, no canvas.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUCKET_SCALE,
  LAYER_SPREAD,
  MAX_LABELS,
  createParticles,
  defaultVisualOptions,
  driftOffset,
  easeToward,
  hash01,
  lerp,
  mergeVisualOptions,
  particleCountFor,
  qualityFor,
  radiusFor,
  sizeBucket,
  twinkle,
  makeLabelPlacer,
} from '../src/ui/starfield.js';

test('hash01 is deterministic and lands in [0, 1)', () => {
  for (const id of ['node-a', 'node-b', 'résistance', '', 'x'.repeat(200)]) {
    const v = hash01(id);
    assert.equal(v, hash01(id), `stable for ${JSON.stringify(id)}`);
    assert.ok(v >= 0 && v < 1, `${v} in range for ${JSON.stringify(id)}`);
  }
  assert.notEqual(hash01('node-a'), hash01('node-b'));
});

test('driftOffset stays inside the amplitude and is deterministic', () => {
  const ids = ['a', 'b', 'concept:résistance', 'long-node-id-0042'];
  for (const id of ids) {
    for (let t = 0; t < 60; t += 0.37) {
      const { dx, dy } = driftOffset(id, t, 2.5);
      assert.ok(Math.abs(dx) <= 2.5 + 1e-9, `dx ${dx} bounded`);
      assert.ok(Math.abs(dy) <= 2.5 + 1e-9, `dy ${dy} bounded`);
    }
    assert.deepEqual(driftOffset(id, 3.5, 2.5), driftOffset(id, 3.5, 2.5));
  }
  const scaled = driftOffset('a', 7, 10);
  assert.ok(Math.abs(scaled.dx) <= 10 + 1e-9 && Math.abs(scaled.dy) <= 10 + 1e-9);
});

test('driftOffset is the identity when animation is off', () => {
  for (const t of [0, 1.5, 42]) {
    assert.deepEqual(driftOffset('a', t, 2.5, false), { dx: 0, dy: 0 });
  }
});

test('driftOffset actually moves and gives different nodes different phases', () => {
  const a0 = driftOffset('a', 0, 2.5);
  const a1 = driftOffset('a', 4.5, 2.5);
  assert.notDeepEqual(a0, a1);
  assert.notDeepEqual(driftOffset('a', 2, 2.5), driftOffset('b', 2, 2.5));
});

test('twinkle stays in [0.92, 1.08] and is exactly 1 when animation is off', () => {
  for (const id of ['a', 'b', 'c']) {
    for (let t = 0; t < 30; t += 0.13) {
      const v = twinkle(id, t);
      assert.ok(v >= 0.92 - 1e-9 && v <= 1.08 + 1e-9, `${v} in range`);
    }
    assert.equal(twinkle(id, 12.3, false), 1);
  }
});

test('sizeBucket is monotonic in degree and spans the four classes', () => {
  const max = 40;
  let previous = -1;
  const seen = new Set();
  for (let d = 0; d <= max; d += 1) {
    const b = sizeBucket(d, max);
    assert.ok(b >= 0 && b <= 3, `${b} in 0..3`);
    assert.ok(b >= previous, `bucket never shrinks (degree ${d})`);
    previous = b;
    seen.add(b);
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
  assert.equal(sizeBucket(0, 0), 0);
  assert.equal(sizeBucket(999, 10), 3, 'degree above the max still clamps to the top class');
  assert.equal(sizeBucket(NaN, 10), 0);
});

test('radiusFor grows with the bucket and scales with the base', () => {
  const radii = [0, 1, 2, 3].map((b) => radiusFor(b, 5));
  for (let i = 1; i < radii.length; i += 1) assert.ok(radii[i] > radii[i - 1]);
  assert.equal(radiusFor(0, 5), 5 * BUCKET_SCALE[0]);
  assert.equal(radiusFor(9, 5), radiusFor(3, 5), 'out-of-range buckets clamp');
  assert.equal(radiusFor(2, 10), radiusFor(2, 5) * 2);
});

test('qualityFor resolves auto against node count and width', () => {
  assert.equal(qualityFor({ quality: 'low' }, { nodeCount: 1, width: 4000 }), 'low');
  assert.equal(qualityFor({ quality: 'high' }, { nodeCount: 5000, width: 320 }), 'high');
  assert.equal(qualityFor({}, { nodeCount: 451, width: 1600 }), 'low', 'big graph degrades');
  assert.equal(qualityFor({}, { nodeCount: 450, width: 1600 }), 'high');
  assert.equal(qualityFor({}, { nodeCount: 10, width: 479 }), 'low', 'narrow canvas degrades');
  assert.equal(qualityFor({}, { nodeCount: 10, width: 480 }), 'medium');
  assert.equal(qualityFor({}, { nodeCount: 10, width: 899 }), 'medium');
  assert.equal(qualityFor({}, { nodeCount: 10, width: 900 }), 'high');
});

test('particleCountFor follows the quality ladder', () => {
  assert.equal(particleCountFor('low'), 0);
  assert.ok(particleCountFor('medium') >= 60 && particleCountFor('medium') <= 90);
  assert.equal(particleCountFor('high'), 140);
});

test('createParticles is deterministic and inside the canvas', () => {
  const a = createParticles(50, 800, 600, 'seed');
  const b = createParticles(50, 800, 600, 'seed');
  assert.deepEqual(a, b);
  assert.equal(a.length, 50);
  assert.notDeepEqual(a, createParticles(50, 800, 600, 'other'));
  for (const p of a) {
    assert.ok(p.x >= 0 && p.x < 800);
    assert.ok(p.y >= 0 && p.y < 600);
    assert.ok(p.r >= 0.6 && p.r <= 1.6, `radius ${p.r}`);
    assert.ok(p.alpha > 0 && p.alpha <= 0.35, `alpha ${p.alpha}`);
    assert.ok(p.bucket >= 0 && p.bucket <= 2);
  }
  assert.deepEqual(createParticles(0, 800, 600, 'seed'), []);
});

test('visual options merge only known values', () => {
  const base = {
    animation: true,
    labels: 'auto',
    edges: true,
    glow: 'medium',
    layers: 'layered',
    quality: 'auto',
    theme: 'light',
  };
  assert.deepEqual(mergeVisualOptions(base, {}), base);
  assert.equal(mergeVisualOptions(base, { labels: 'all' }).labels, 'all');
  assert.equal(mergeVisualOptions(base, { labels: 'nope' }).labels, 'auto');
  assert.equal(mergeVisualOptions(base, { glow: 'off' }).glow, 'off');
  assert.equal(mergeVisualOptions(base, { edges: false }).edges, false);
  assert.equal(mergeVisualOptions(base, { edges: 'false' }).edges, true, 'non-boolean ignored');
  assert.equal(mergeVisualOptions(base, { layers: 'expanded' }).layers, 'expanded');
  assert.equal(mergeVisualOptions(base, { quality: 'medium' }).quality, 'auto', 'medium is not a user option');
  assert.equal(mergeVisualOptions(base, { theme: 'dark' }).theme, 'dark');
  assert.notEqual(mergeVisualOptions(base, { theme: 'dark' }), base, 'returns a new object');
});

test('defaults are the documented ones', () => {
  const d = defaultVisualOptions();
  assert.equal(d.labels, 'auto');
  assert.equal(d.edges, true);
  assert.equal(d.glow, 'medium');
  assert.equal(d.layers, 'layered');
  assert.equal(d.quality, 'auto');
  assert.equal(typeof d.animation, 'boolean');
  assert.ok(d.theme === 'light' || d.theme === 'dark');
});

test('layer spread multipliers and the label ceiling are the agreed constants', () => {
  assert.deepEqual({ ...LAYER_SPREAD }, { flat: 0.08, layered: 1, expanded: 1.9 });
  assert.equal(MAX_LABELS, 300);
});

test('lerp and easeToward converge without overshooting', () => {
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(0, 10, 5), 10, 't is clamped');
  let v = 0;
  for (let i = 0; i < 100; i += 1) v = easeToward(v, 1, 1 / 60, 250);
  assert.equal(v, 1);
  assert.ok(easeToward(0, 1, 1 / 60, 250) > 0 && easeToward(0, 1, 1 / 60, 250) < 1);
});


test('label placer refuses overlapping boxes, accepts disjoint ones, forces important ones', () => {
  const placer = makeLabelPlacer(2);
  assert.equal(placer.tryPlace(0, 0, 50, 12), true);
  assert.equal(placer.tryPlace(20, 4, 50, 12), false, 'overlaps the first box');
  assert.equal(placer.tryPlace(0, 30, 50, 12), true, 'disjoint');
  assert.equal(placer.tryPlace(20, 4, 50, 12, true), true, 'forced ignores ordinary labels');
  assert.equal(placer.tryPlace(25, 6, 50, 12, true), false, 'a forced label never overlaps another forced one');
  assert.equal(placer.count, 3);
});
