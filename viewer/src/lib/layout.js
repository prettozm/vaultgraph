// A small deterministic force-directed layout.
//
// Zero dependencies by design (CDC §42). Repulsion uses a Barnes-Hut quadtree
// so the layout stays O(n log n) and remains usable at ~500 nodes / ~1000 edges.
// Initial positions are seeded from the node ids, so the same graph always
// settles into the same picture.

/** FNV-1a, returns an unsigned 32-bit integer. */
export function hashString(value) {
  let h = 0x811c9dc5;
  const s = String(value);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small, fast, deterministic PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_OPTIONS = {
  width: 1200,
  height: 800,
  repulsion: 2600,     // charge strength (per unit mass)
  springStrength: 0.06,
  springLength: 90,
  gravity: 0.035,      // pull toward the centre, keeps components on screen
  velocityDecay: 0.72,
  alphaDecay: 0.022,
  alphaMin: 0.002,
  theta: 0.9,          // Barnes-Hut opening angle
  seed: 'vault-graph',
};

/**
 * Deterministic initial positions: a phyllotaxis-like spiral jittered by a
 * per-id hash, which spreads nodes evenly and avoids exact coincidences.
 * @returns {Map<string, {x:number, y:number}>}
 */
export function seedPositions(nodes, options = {}) {
  const { width, height, seed } = { ...DEFAULT_OPTIONS, ...options };
  const rand = mulberry32(hashString(seed));
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.42;
  const positions = new Map();
  const n = Math.max(nodes.length, 1);
  nodes.forEach((node, i) => {
    const t = (i + 0.5) / n;
    const angle = i * 2.399963229728653 + (hashString(node.id) % 360) * (Math.PI / 180) * 0.05;
    const r = radius * Math.sqrt(t);
    positions.set(node.id, {
      x: cx + Math.cos(angle) * r + (rand() - 0.5) * 4,
      y: cy + Math.sin(angle) * r + (rand() - 0.5) * 4,
    });
  });
  return positions;
}

// --- Barnes-Hut quadtree -------------------------------------------------

function makeCell(x0, y0, x1, y1) {
  return { x0, y0, x1, y1, mass: 0, cx: 0, cy: 0, body: null, children: null };
}

function quadrantOf(cell, x, y) {
  const mx = (cell.x0 + cell.x1) / 2;
  const my = (cell.y0 + cell.y1) / 2;
  return (x >= mx ? 1 : 0) + (y >= my ? 2 : 0);
}

function subdivide(cell) {
  const mx = (cell.x0 + cell.x1) / 2;
  const my = (cell.y0 + cell.y1) / 2;
  cell.children = [
    makeCell(cell.x0, cell.y0, mx, my),
    makeCell(mx, cell.y0, cell.x1, my),
    makeCell(cell.x0, my, mx, cell.y1),
    makeCell(mx, my, cell.x1, cell.y1),
  ];
}

function insert(cell, body, depth) {
  if (cell.body === null && cell.children === null) {
    cell.body = body;
    return;
  }
  if (cell.children === null) {
    // Depth guard protects against (near-)coincident points.
    if (depth > 24) {
      cell.extra = cell.extra ? cell.extra.concat([body]) : [body];
      return;
    }
    const existing = cell.body;
    cell.body = null;
    subdivide(cell);
    insert(cell.children[quadrantOf(cell, existing.x, existing.y)], existing, depth + 1);
  }
  insert(cell.children[quadrantOf(cell, body.x, body.y)], body, depth + 1);
}

function accumulate(cell) {
  let mass = 0;
  let sx = 0;
  let sy = 0;
  if (cell.body) {
    mass += cell.body.mass;
    sx += cell.body.x * cell.body.mass;
    sy += cell.body.y * cell.body.mass;
  }
  if (cell.extra) {
    for (const b of cell.extra) {
      mass += b.mass;
      sx += b.x * b.mass;
      sy += b.y * b.mass;
    }
  }
  if (cell.children) {
    for (const child of cell.children) {
      accumulate(child);
      if (child.mass > 0) {
        mass += child.mass;
        sx += child.cx * child.mass;
        sy += child.cy * child.mass;
      }
    }
  }
  cell.mass = mass;
  cell.cx = mass > 0 ? sx / mass : 0;
  cell.cy = mass > 0 ? sy / mass : 0;
  return cell;
}

export function buildQuadtree(bodies) {
  if (!bodies.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of bodies) {
    if (b.x < x0) x0 = b.x;
    if (b.y < y0) y0 = b.y;
    if (b.x > x1) x1 = b.x;
    if (b.y > y1) y1 = b.y;
  }
  const size = Math.max(x1 - x0, y1 - y0, 1) * 1.05;
  const root = makeCell(x0 - 1, y0 - 1, x0 - 1 + size + 2, y0 - 1 + size + 2);
  for (const b of bodies) insert(root, b, 0);
  return accumulate(root);
}

function applyRepulsionFrom(cell, body, opts, jitter) {
  if (!cell || cell.mass === 0) return;
  let dx = cell.cx - body.x;
  let dy = cell.cy - body.y;
  let dist2 = dx * dx + dy * dy;
  const width = cell.x1 - cell.x0;

  const isLeafLike = cell.children === null;
  if (!isLeafLike && width * width < opts.theta * opts.theta * dist2) {
    // Far enough: treat the whole cell as one body.
    if (dist2 < 1e-6) return;
    const dist = Math.sqrt(dist2);
    const f = (opts.repulsion * cell.mass) / (dist2 * dist);
    body.vx -= dx * f;
    body.vy -= dy * f;
    return;
  }

  if (isLeafLike) {
    const bodies = cell.body ? [cell.body] : [];
    if (cell.extra) bodies.push(...cell.extra);
    for (const other of bodies) {
      if (other === body) continue;
      dx = other.x - body.x;
      dy = other.y - body.y;
      dist2 = dx * dx + dy * dy;
      if (dist2 < 1e-4) {
        // Coincident: nudge deterministically so the pair can separate.
        dx = (jitter() - 0.5) * 0.1 || 0.05;
        dy = (jitter() - 0.5) * 0.1 || 0.05;
        dist2 = dx * dx + dy * dy;
      }
      const dist = Math.sqrt(dist2);
      const f = (opts.repulsion * other.mass) / (dist2 * dist);
      body.vx -= dx * f;
      body.vy -= dy * f;
    }
    return;
  }

  for (const child of cell.children) applyRepulsionFrom(child, body, opts, jitter);
}

/**
 * Create a simulation over the given nodes/edges.
 * `nodes` need only expose `id`; `edges` need `from`/`to`.
 * @returns {{bodies:object[], byId:Map, options:object, alpha:number,
 *            tick:Function, settle:Function, positions:Function,
 *            reheat:Function, bounds:Function}}
 */
export function createSimulation(nodes = [], edges = [], options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const seeded = seedPositions(nodes, opts);
  const jitter = mulberry32(hashString(`${opts.seed}:jitter`));

  const degree = new Map();
  for (const node of nodes) degree.set(node.id, 0);
  const links = [];
  for (const edge of edges) {
    if (!degree.has(edge.from) || !degree.has(edge.to)) continue;
    if (edge.from === edge.to) continue;
    degree.set(edge.from, degree.get(edge.from) + 1);
    degree.set(edge.to, degree.get(edge.to) + 1);
    links.push(edge);
  }

  const bodies = nodes.map((node) => {
    const p = seeded.get(node.id);
    const d = degree.get(node.id) ?? 0;
    return {
      id: node.id,
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      fixed: false,
      degree: d,
      mass: 1 + Math.sqrt(d) * 0.5,
    };
  });
  const byId = new Map(bodies.map((b) => [b.id, b]));

  const state = {
    bodies,
    byId,
    options: opts,
    alpha: 1,
    links,
  };

  state.tick = function tick(steps = 1) {
    for (let s = 0; s < steps; s += 1) {
      if (state.alpha <= opts.alphaMin) {
        state.alpha = 0;
        break;
      }
      const tree = buildQuadtree(bodies);
      const a = state.alpha;

      for (const body of bodies) {
        applyRepulsionFrom(tree, body, opts, jitter);
      }

      for (const link of links) {
        const source = byId.get(link.from);
        const target = byId.get(link.to);
        if (!source || !target) continue;
        let dx = target.x - source.x;
        let dy = target.y - source.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1e-6) {
          dx = (jitter() - 0.5) * 0.1 || 0.05;
          dy = (jitter() - 0.5) * 0.1 || 0.05;
          dist = Math.sqrt(dx * dx + dy * dy);
        }
        const delta = (dist - opts.springLength) / dist;
        const f = opts.springStrength * delta * a;
        // Heavier (higher-degree) endpoints move less.
        const total = source.mass + target.mass;
        source.vx += dx * f * (target.mass / total) * 2;
        source.vy += dy * f * (target.mass / total) * 2;
        target.vx -= dx * f * (source.mass / total) * 2;
        target.vy -= dy * f * (source.mass / total) * 2;
      }

      const cx = opts.width / 2;
      const cy = opts.height / 2;
      for (const body of bodies) {
        body.vx += (cx - body.x) * opts.gravity * a;
        body.vy += (cy - body.y) * opts.gravity * a;
      }

      for (const body of bodies) {
        if (body.fixed) {
          body.vx = 0;
          body.vy = 0;
          continue;
        }
        body.vx *= opts.velocityDecay;
        body.vy *= opts.velocityDecay;
        // Guard against numerical blow-up on pathological inputs.
        if (!Number.isFinite(body.vx)) body.vx = 0;
        if (!Number.isFinite(body.vy)) body.vy = 0;
        const speed = Math.hypot(body.vx, body.vy);
        const maxSpeed = 60;
        if (speed > maxSpeed) {
          body.vx = (body.vx / speed) * maxSpeed;
          body.vy = (body.vy / speed) * maxSpeed;
        }
        body.x += body.vx;
        body.y += body.vy;
      }

      state.alpha += (0 - state.alpha) * opts.alphaDecay;
    }
    return state;
  };

  /** Run until settled (or `maxIterations` reached). */
  state.settle = function settle(maxIterations = 300) {
    for (let i = 0; i < maxIterations && state.alpha > opts.alphaMin; i += 1) state.tick(1);
    return state;
  };

  state.reheat = function reheat(alpha = 0.6) {
    state.alpha = Math.max(state.alpha, alpha);
    return state;
  };

  state.positions = function positions() {
    const out = new Map();
    for (const body of bodies) out.set(body.id, { x: body.x, y: body.y });
    return out;
  };

  state.bounds = function bounds() {
    return boundsOf(bodies);
  };

  return state;
}

/** Axis-aligned bounding box of a list of {x,y} points. */
export function boundsOf(points) {
  if (!points || points.length === 0) return { x0: 0, y0: 0, x1: 1, y1: 1, width: 1, height: 1 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1, width: Math.max(x1 - x0, 1), height: Math.max(y1 - y0, 1) };
}
