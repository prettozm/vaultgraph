// Unit tests for the pure half of ui/starfield.js — no DOM, no canvas.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANCHOR_COUNT,
  BAND_ALPHA,
  BUCKET_SCALE,
  CORE_PX,
  DEPTH_JITTER,
  GLOW_ALPHA,
  GLOW_SPREAD,
  LAYER_SPREAD,
  MAX_LABELS,
  createParticles,
  defaultVisualOptions,
  driftOffset,
  easeToward,
  hash01,
  lerp,
  mergeVisualOptions,
  coreRadiusPx,
  depthJitter,
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

test('twinkle stays in [0.90, 1.10] and is exactly 1 when animation is off', () => {
  for (const id of ['a', 'b', 'c']) {
    for (let t = 0; t < 30; t += 0.13) {
      const v = twinkle(id, t);
      assert.ok(v >= 0.9 - 1e-9 && v <= 1.1 + 1e-9, `${v} in range`);
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

test('particleCountFor follows the quality ladder and keeps the sky dense', () => {
  // v0.3.1: the low tier keeps a thin field — a night ground with no stars in
  // it reads as a dark panel, which is exactly the regression this guards.
  assert.ok(particleCountFor('low') >= 100 && particleCountFor('low') <= 160);
  assert.ok(particleCountFor('medium') >= 300 && particleCountFor('medium') <= 400);
  assert.ok(particleCountFor('high') >= 700 && particleCountFor('high') <= 900);
  assert.ok(particleCountFor('high') > particleCountFor('medium'));
  assert.ok(particleCountFor('medium') > particleCountFor('low'));
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
    assert.ok(p.r >= 0.4 && p.r <= 1.6, `radius ${p.r}`);
    assert.ok(p.r >= 0.4 - 1e-9, `radius floor ${p.r}`);
    assert.ok(p.alpha > 0 && p.alpha <= 0.7, `alpha ${p.alpha}`);
    assert.ok(p.band >= 0 && p.band < BAND_ALPHA.length);
    assert.ok(p.bucket >= 0 && p.bucket <= 2, 'legacy three-bucket alias survives');
    assert.ok(p.depth >= 0 && p.depth <= 2, 'three parallax depth bands');
    assert.equal(typeof p.glow, 'boolean');
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

// --------------------------------------------------------------------------
// v0.3.1 "constellation pass"
// --------------------------------------------------------------------------

test('background brightness follows a log-ish law: many faint, few bright', () => {
  const field = createParticles(800, 1280, 800, 'sky');
  const counts = BAND_ALPHA.map(() => 0);
  for (const p of field) counts[p.band] += 1;
  // Strictly decreasing population per band is what a real sky looks like; a
  // uniform field is exactly what makes a generated sky look generated.
  for (let i = 1; i < counts.length; i += 1) {
    assert.ok(counts[i] < counts[i - 1], `band ${i} (${counts[i]}) must be rarer than band ${i - 1} (${counts[i - 1]})`);
  }
  assert.ok(counts[0] > field.length * 0.4, 'the faintest band carries most of the sky');
  assert.ok(counts[counts.length - 1] < field.length * 0.1, 'bright stars stay rare');
  const glowing = field.filter((p) => p.glow).length / field.length;
  assert.ok(glowing > 0.02 && glowing < 0.11, `~6 % get a soft glow (got ${(glowing * 100).toFixed(1)} %)`);
  // All three parallax depth bands are populated, or there is no depth to see.
  for (const d of [0, 1, 2]) assert.ok(field.some((p) => p.depth === d), `depth band ${d} used`);
});

test('BAND_ALPHA rises with the band and stays below the node blooms', () => {
  for (let i = 1; i < BAND_ALPHA.length; i += 1) assert.ok(BAND_ALPHA[i] > BAND_ALPHA[i - 1]);
  // The sky must never out-shout the graph: even the brightest background band
  // is dimmer than the dimmest node bloom.
  assert.ok(BAND_ALPHA[BAND_ALPHA.length - 1] < GLOW_ALPHA.low, 'sky stays behind the stars');
});

test('coreRadiusPx spans 3–8 px by degree class and is monotonic', () => {
  const radii = [0, 1, 2, 3].map((b) => coreRadiusPx(b, 1));
  for (let i = 1; i < radii.length; i += 1) assert.ok(radii[i] > radii[i - 1], `class ${i} is bigger`);
  assert.ok(radii[0] >= 2.5 && radii[0] <= 3.5, `leaf core ${radii[0]} px`);
  assert.ok(radii[3] >= 7 && radii[3] <= 9, `hub core ${radii[3]} px`);
  // A hub must be unmistakably bigger than a leaf — that contrast is the whole
  // point of the pass; the previous ratio (~2.5×) read as "all dots the same".
  assert.ok(radii[3] / radii[0] >= 2.6, `hub/leaf ratio ${(radii[3] / radii[0]).toFixed(2)}`);
  assert.equal(coreRadiusPx(9, 1), coreRadiusPx(3, 1), 'out-of-range classes clamp');
  assert.ok(coreRadiusPx(2, 4) > coreRadiusPx(2, 1), 'zoom still grows the core');
  assert.ok(coreRadiusPx(2, 100) < CORE_PX[2] * 3, 'but never without bound');
  assert.ok(coreRadiusPx(0, 0.0001) > 0, 'and never collapses to nothing');
});

test('glow levels grow monotonically and reach a real bloom radius', () => {
  for (const level of ['low', 'medium', 'high']) {
    assert.ok(GLOW_SPREAD[level] >= 5 && GLOW_SPREAD[level] <= 7, `${level} bloom is 5–7× the core`);
  }
  assert.ok(GLOW_ALPHA.low < GLOW_ALPHA.medium && GLOW_ALPHA.medium < GLOW_ALPHA.high);
  assert.equal(GLOW_ALPHA.off, 0);
  assert.equal(GLOW_SPREAD.off, 0);
  // The anchor bloom is the widest and the faintest: presence, not a spotlight.
  assert.ok(GLOW_SPREAD.anchor > GLOW_SPREAD.high, 'anchors bloom widest');
  assert.ok(GLOW_ALPHA.anchor < GLOW_ALPHA.low, 'anchors bloom faintest');
  assert.ok(ANCHOR_COUNT >= 3 && ANCHOR_COUNT <= 4, 'three or four fixed points');
});

test('depthJitter is deterministic, centred and bounded', () => {
  const ids = Array.from({ length: 400 }, (_, i) => `node-${i}`);
  let sum = 0;
  for (const id of ids) {
    const v = depthJitter(id);
    assert.equal(v, depthJitter(id), 'same id → same offset (a layout never reshuffles)');
    assert.ok(Math.abs(v) <= DEPTH_JITTER + 1e-9, `${v} within ±${DEPTH_JITTER}`);
    sum += v;
  }
  assert.ok(Math.abs(sum / ids.length) < 0.02, 'no systematic drift of a whole layer');
  assert.notEqual(depthJitter('a'), depthJitter('b'));
  assert.equal(depthJitter('a', 0), 0, 'zero spread ⇒ the flat sheet, exactly');
});
