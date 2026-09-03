import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashString,
  mulberry32,
  seedPositions,
  createSimulation,
  buildQuadtree,
  boundsOf,
  DEFAULT_OPTIONS,
} from '../src/lib/layout.js';

function chain(n) {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ id: `e${i}`, from: `n${i}`, to: `n${i + 1}` }));
  return { nodes, edges };
}

test('hashString and mulberry32 are deterministic', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 5; i += 1) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});

test('seeded initial positions are deterministic and distinct', () => {
  const nodes = chain(20).nodes;
  const first = seedPositions(nodes);
  const second = seedPositions(nodes);
  assert.deepEqual([...first.entries()], [...second.entries()]);
  const unique = new Set([...first.values()].map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`));
  assert.equal(unique.size, nodes.length, 'no two nodes start at the same point');
  for (const p of first.values()) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
});

test('the same graph always settles into the same layout', () => {
  const { nodes, edges } = chain(40);
  const a = createSimulation(nodes, edges).settle(120).positions();
  const b = createSimulation(nodes, edges).settle(120).positions();
  for (const [id, p] of a) {
    assert.equal(p.x, b.get(id).x, `x drifted for ${id}`);
    assert.equal(p.y, b.get(id).y, `y drifted for ${id}`);
  }
});

test('a settled layout contains only finite coordinates', () => {
  const { nodes, edges } = chain(60);
  const sim = createSimulation(nodes, edges).settle(200);
  for (const body of sim.bodies) {
    assert.ok(Number.isFinite(body.x) && Number.isFinite(body.y), `${body.id} is not finite`);
  }
});

test('coincident and self-referencing input cannot break the simulation', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const edges = [
    { id: 'self', from: 'a', to: 'a' },
    { id: 'dangling', from: 'a', to: 'ghost' },
    { id: 'ok', from: 'a', to: 'b' },
  ];
  const sim = createSimulation(nodes, edges);
  for (const body of sim.bodies) {
    body.x = 10;
    body.y = 10;
  }
  sim.settle(60);
  for (const body of sim.bodies) {
    assert.ok(Number.isFinite(body.x) && Number.isFinite(body.y));
  }
});

test('springs pull connected nodes together relative to unconnected ones', () => {
  // Two triangles with no link between them.
  const nodes = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((id) => ({ id }));
  const edges = [
    { id: '1', from: 'a1', to: 'a2' },
    { id: '2', from: 'a2', to: 'a3' },
    { id: '3', from: 'a3', to: 'a1' },
    { id: '4', from: 'b1', to: 'b2' },
    { id: '5', from: 'b2', to: 'b3' },
    { id: '6', from: 'b3', to: 'b1' },
  ];
  const sim = createSimulation(nodes, edges).settle(400);
  const p = sim.positions();
  const dist = (x, y) => Math.hypot(p.get(x).x - p.get(y).x, p.get(x).y - p.get(y).y);
  const within = (dist('a1', 'a2') + dist('a2', 'a3') + dist('a3', 'a1')) / 3;
  const across = (dist('a1', 'b1') + dist('a2', 'b2') + dist('a3', 'b3')) / 3;
  assert.ok(within < across, `connected mean ${within.toFixed(1)} should be below unconnected mean ${across.toFixed(1)}`);
});

test('alpha decays to rest, so the layout stops moving', () => {
  const { nodes, edges } = chain(30);
  const sim = createSimulation(nodes, edges);
  assert.equal(sim.alpha, 1);
  sim.settle(1000);
  assert.ok(sim.alpha <= DEFAULT_OPTIONS.alphaMin, `alpha=${sim.alpha}`);
  sim.reheat(0.5);
  assert.equal(sim.alpha, 0.5);
});

test('the quadtree conserves mass and centres it', () => {
  const bodies = [
    { x: 0, y: 0, mass: 1 },
    { x: 10, y: 0, mass: 1 },
    { x: 0, y: 10, mass: 1 },
    { x: 10, y: 10, mass: 1 },
  ];
  const root = buildQuadtree(bodies);
  assert.equal(root.mass, 4);
  assert.ok(Math.abs(root.cx - 5) < 1e-9);
  assert.ok(Math.abs(root.cy - 5) < 1e-9);
  assert.equal(buildQuadtree([]), null);
});

test('boundsOf describes the extent of a point cloud', () => {
  const b = boundsOf([{ x: -3, y: 2 }, { x: 7, y: 12 }]);
  assert.deepEqual([b.x0, b.y0, b.x1, b.y1], [-3, 2, 7, 12]);
  assert.equal(b.width, 10);
  assert.equal(b.height, 10);
  const empty = boundsOf([]);
  assert.ok(empty.width >= 1 && empty.height >= 1);
});

test('500 nodes / 1000 edges settle in reasonable time', () => {
  const n = 500;
  const rand = mulberry32(7);
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
  const edges = Array.from({ length: 1000 }, (_, i) => ({
    id: `e${i}`,
    from: `n${Math.floor(rand() * n)}`,
    to: `n${Math.floor(rand() * n)}`,
  }));
  const started = Date.now();
  const sim = createSimulation(nodes, edges).settle(150);
  const elapsed = Date.now() - started;
  for (const body of sim.bodies) {
    assert.ok(Number.isFinite(body.x) && Number.isFinite(body.y));
  }
  assert.ok(elapsed < 15000, `settling 500 nodes took ${elapsed}ms`);
});
