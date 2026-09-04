// Canvas renderer + gestures for the 3D projection of the graph (v0.2 §3, §15).
//
// Zero dependencies: no WebGL, no three.js — a painter's-algorithm renderer on
// the same 2D canvas context the flat view uses. X/Y are the force-layout body
// positions, Z is the semantic projection (lib/projections.js) multiplied by
// Z_SPREAD so the layers separate.
//
// v0.3 "living constellation" (Lot R): deep-space ground with parallaxed dust,
// stars with soft halos, an ultra-slow idle orbit, and an animated layer
// spread (flat / layered / expanded). Every effect maps to a meaning — see
// ui/starfield.js for the contract.
//
// The surface mirrors ui/graph-view.js so the app can swap views without
// caring which one is mounted.
import * as palette from '../lib/colors.js';
import { colorFor, inkFor } from '../lib/colors.js';
import {
  createCamera,
  fitToPoints,
  orbit,
  pan,
  project,
  resetView as resetCamera,
  zoom,
} from '../lib/camera3d.js';
import { computeProjection } from '../lib/projections.js';
import {
  LAYER_SPREAD,
  MAX_LABELS,
  createParticles,
  defaultVisualOptions,
  detectTheme,
  drawHalo,
  driftOffset,
  easeToward,
  lerp,
  makeSpriteCache,
  mergeVisualOptions,
  paintBackground,
  particleCountFor,
  qualityFor,
  radiusFor,
  readCanvasTokens,
  sizeBucket,
  twinkle,
  makeLabelPlacer,
} from './starfield.js';

/** World units between the extreme projection layers (z ∈ [-1, 1]). */
export const Z_SPREAD = 520;

const NODE_PICK_PX = 12;
const EDGE_PICK_PX = 8;
const MAX_PLANES = 24;
const DOUBLE_TAP_MS = 320;
const BASE_RADIUS = 5.6;    // world units for star class 1
const DRIFT_PX = 2.2;       // ambient excursion, screen pixels
const DIM_NODE = 0.28;
const DIM_EDGE = 0.06;
const SHAPE_MIN_PX = 3;
const IDLE_YAW = 0.015;     // rad/s — one turn in ~7 minutes
const IDLE_AFTER_MS = 4000;

// colors.js owns the shared vocabularies when it exposes them (Lot H added
// statusColor / isTentative / shapeForType); these locals are the fallback so
// this module never depends on an export that may not be there yet.
const STATUS_COLORS = {
  confirmed: '#2f7d5b',
  explicit: '#2f6ba8',
  candidate: '#c08a12',
  unresolved: '#7a5bb5',
  rejected: '#a8453c',
};

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function shapeFor(type) {
  if (typeof palette.shapeForType === 'function') return palette.shapeForType(type);
  const t = normalizeName(type);
  if (t === 'source' || t.startsWith('source_')) return 'square';
  if (t === 'decision' || t.startsWith('decision_')) return 'diamond';
  if (t === 'hypothese' || t.startsWith('hypothese_')) return 'triangle';
  return 'circle';
}

function isSoftStatus(status) {
  if (typeof palette.isTentative === 'function') return palette.isTentative(status);
  const s = normalizeName(status);
  return s === 'candidate' || s === 'unresolved';
}

export function createGraphView3D(canvas, handlers = {}) {
  const ctx = canvas.getContext('2d');

  let data = {
    graph: null,
    sim: null,
    visibleNodes: new Set(),
    visibleEdges: new Set(),
    matches: new Set(),
  };
  let projectionId = 'context';
  let projection = null;
  let emphasis = null;
  let selection = null;
  let hover = null;
  let cam = createCamera();
  let running = false;
  let rafId = 0;
  let interacting = false;
  let needsFit = true;

  // --- constellation state ------------------------------------------------
  let opts = defaultVisualOptions();
  let tokens = readCanvasTokens(opts.theme);
  const sprites = makeSpriteCache(300);
  let quality = 'high';
  let particles = [];
  let particleSize = { width: 0, height: 0, count: -1 };
  let maxDegree = 1;
  let clock = 0;
  let lastTs = 0;
  let dimMix = 0;
  let zScale = LAYER_SPREAD[opts.layers] ?? 1;
  let paused = false;
  let lastInteractionAt = 0;

  // pointer bookkeeping
  const pointers = new Map();
  let gesture = null;
  let movedPx = 0;
  let lastTap = { time: 0, id: null };

  if (canvas.style) canvas.style.touchAction = 'none';

  // --- geometry ----------------------------------------------------------

  function cssSize() {
    const rect = canvas.getBoundingClientRect();
    return { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
  }

  function resize() {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const { width, height } = cssSize();
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { width, height, dpr };
  }

  function refreshQuality(width, height, dpr) {
    quality = qualityFor(opts, { nodeCount: data.visibleNodes?.size ?? 0, width, height, dpr });
    const count = particleCountFor(quality);
    if (
      particleSize.count !== count ||
      particleSize.width !== Math.round(width) ||
      particleSize.height !== Math.round(height)
    ) {
      particles = createParticles(count, width, height, 'vault-graph-3d');
      particleSize = { width: Math.round(width), height: Math.round(height), count };
    }
  }

  function zOf(id) {
    const raw = projection?.z?.get(id);
    return (Number.isFinite(raw) ? raw : 0) * Z_SPREAD * zScale;
  }

  /** World point for a body: the 2D layout spans X and depth (Z); the semantic layer value
   *  becomes the vertical axis (Y), so layers read as stacked shelves seen from the side. */
  function worldOf(body) {
    return { x: body.x, y: zOf(body.id), z: -body.y };
  }

  function visibleBodies() {
    if (!data.sim) return [];
    return data.sim.bodies.filter((b) => data.visibleNodes.has(b.id));
  }

  function worldPoints() {
    return visibleBodies().map(worldOf);
  }

  function computeMaxDegree() {
    let m = 1;
    if (data.sim) {
      for (const b of data.sim.bodies) {
        if (!data.visibleNodes.has(b.id)) continue;
        if ((b.degree || 0) > m) m = b.degree || 0;
      }
    }
    maxDegree = Math.max(1, m);
  }

  function radiusOf(body) {
    return radiusFor(sizeBucket(body.degree || 0, maxDegree), BASE_RADIUS);
  }

  /** Project every visible body once per frame (with the ambient drift). */
  function projectBodies(viewport, animate = false) {
    const out = [];
    for (const body of visibleBodies()) {
      const p = project(worldOf(body), cam, viewport);
      if (p.behind) continue;
      const d = driftOffset(body.id, clock, DRIFT_PX, animate);
      out.push({ body, ...p, sx: p.sx + d.dx, sy: p.sy + d.dy });
    }
    return out;
  }

  function recomputeProjection() {
    projection = data.graph
      ? computeProjection(data.graph, projectionId)
      : { id: projectionId, available: false, layers: [], z: new Map(), encoding: { colorBy: 'type' } };
  }

  // --- colours -----------------------------------------------------------

  function statusColor(status, options) {
    if (typeof palette.statusColor === 'function') return palette.statusColor(status, options);
    const key = normalizeName(status);
    return STATUS_COLORS[key] ?? colorFor(status ?? '(unset)');
  }

  /**
   * Star core colour. `cool` (0 near, 2 far) is the depth cue: distant stars
   * lose saturation and lightness, so depth reads even before the size does.
   */
  function starColor(node, cool = 0) {
    if (projection?.encoding?.colorBy === 'status') {
      return statusColor(node.status, { dark: tokens.dark });
    }
    return colorFor(node.type, {
      saturation: Math.max(28, 62 - cool * 13),
      lightness: (tokens.dark ? 70 : 52) - cool * 7,
    });
  }

  function strokeFor(node) {
    return projection?.encoding?.colorBy === 'status'
      ? (tokens.dark ? 'rgba(10,14,24,0.85)' : '#2a2f38')
      : inkFor(node.type);
  }

  function isDimmed(id, selectedNodeId) {
    if (emphasis && !emphasis.has(id)) return true;
    return Boolean(selectedNodeId) && id !== selectedNodeId && !neighboursOf(selectedNodeId).has(id);
  }

  let neighbourCache = { id: null, set: new Set() };
  function neighboursOf(selectedNodeId) {
    if (!selectedNodeId || !data.graph) return new Set();
    if (neighbourCache.id === selectedNodeId) return neighbourCache.set;
    const set = new Set();
    const adj = data.graph.adjacency?.get(selectedNodeId);
    if (adj) {
      for (const id of [...adj.in, ...adj.out]) {
        const e = data.graph.edgeById.get(id);
        if (!e || !data.visibleEdges.has(e.id)) continue;
        set.add(e.from);
        set.add(e.to);
      }
    }
    neighbourCache = { id: selectedNodeId, set };
    return set;
  }

  function dimTarget() {
    return emphasis || selection?.kind === 'node' ? 1 : 0;
  }

  // --- drawing -----------------------------------------------------------

  /** Layer shelves. In 'flat' mode a single plane plus a stacked legend keeps
   *  the layer semantics readable even though the Z spread is collapsed. */
  function drawPlanes(viewport, bodies) {
    const layers = projection?.layers ?? [];
    if (!layers.length || layers.length > MAX_PLANES || !bodies.length) return;
    const flat = opts.layers === 'flat';

    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const b of bodies) {
      const w = worldOf(b);
      if (w.x < x0) x0 = w.x;
      if (w.x > x1) x1 = w.x;
      if (w.z < z0) z0 = w.z;
      if (w.z > z1) z1 = w.z;
    }
    const padX = Math.max((x1 - x0) * 0.08, 30);
    const padZ = Math.max((z1 - z0) * 0.08, 30);
    x0 -= padX;
    x1 += padX;
    z0 -= padZ;
    z1 += padZ;

    const fillAlpha = tokens.dark ? 0.05 : 0.06;
    const strokeAlpha = tokens.dark ? 0.18 : 0.22;

    const shelves = flat
      ? [{ label: null, z: 0, count: 0 }]
      : [...layers].sort((a, b) => {
          const da = project({ x: 0, y: a.z * Z_SPREAD * zScale, z: 0 }, cam, viewport).depth;
          const db = project({ x: 0, y: b.z * Z_SPREAD * zScale, z: 0 }, cam, viewport).depth;
          return db - da; // furthest first
        });

    ctx.save();
    ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    for (const layer of shelves) {
      const y = flat ? 0 : layer.z * Z_SPREAD * zScale;
      const corners = [
        project({ x: x0, y, z: z0 }, cam, viewport),
        project({ x: x1, y, z: z0 }, cam, viewport),
        project({ x: x1, y, z: z1 }, cam, viewport),
        project({ x: x0, y, z: z1 }, cam, viewport),
      ];
      if (corners.some((c) => c.behind)) continue;
      ctx.beginPath();
      ctx.moveTo(corners[0].sx, corners[0].sy);
      for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].sx, corners[i].sy);
      ctx.closePath();
      ctx.fillStyle = tokens.planeColor(fillAlpha);
      ctx.fill();
      ctx.strokeStyle = tokens.planeColor(strokeAlpha);
      ctx.lineWidth = 1;
      ctx.stroke();
      if (!layer.label) continue;

      const anchor = corners.reduce((best, c) => (c.sx < best.sx ? c : best), corners[0]);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const text = `${layer.label} (${layer.count})`;
      // keep the label inside the canvas even when the plane's corner is off-screen
      const tw = ctx.measureText(text).width;
      const lx = Math.min(Math.max(anchor.sx - 6, tw + 8), viewport.width - 8);
      const ly = Math.min(Math.max(anchor.sy, 10), viewport.height - 10);
      ctx.lineWidth = 3;
      ctx.strokeStyle = tokens.halo;
      ctx.strokeText(text, lx, ly);
      ctx.fillStyle = tokens.labelSoft;
      ctx.fillText(text, lx, ly);
    }

    if (flat) {
      // Collapsed spread: the shelves are gone, the semantics are not.
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      let y = 26;
      for (const layer of layers) {
        const text = `${layer.label} (${layer.count})`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = tokens.halo;
        ctx.strokeText(text, 12, y);
        ctx.fillStyle = tokens.labelSoft;
        ctx.fillText(text, 12, y);
        y += 15;
        if (y > viewport.height - 14) break;
      }
    }
    ctx.restore();
  }

  function nodePath(x, y, r, shape) {
    ctx.beginPath();
    if (shape === 'square') {
      ctx.rect(x - r, y - r, r * 2, r * 2);
    } else if (shape === 'diamond') {
      ctx.moveTo(x, y - r * 1.25);
      ctx.lineTo(x + r * 1.25, y);
      ctx.lineTo(x, y + r * 1.25);
      ctx.lineTo(x - r * 1.25, y);
      ctx.closePath();
    } else if (shape === 'triangle') {
      ctx.moveTo(x, y - r * 1.35);
      ctx.lineTo(x + r * 1.2, y + r);
      ctx.lineTo(x - r * 1.2, y + r);
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }

  function draw() {
    const { width, height, dpr } = resize();
    const viewport = { width, height };
    refreshQuality(width, height, dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Dust parallaxes against the camera so orbiting reads as real depth.
    paintBackground(ctx, width, height, tokens, {
      particles,
      tSeconds: clock,
      quality,
      animation: opts.animation,
      parallax: { x: -cam.yaw * 26, y: cam.pitch * 26 },
    });
    if (!data.graph || !data.sim) return;
    if (!projection) recomputeProjection();

    const animate = opts.animation && !paused;
    const bodies = visibleBodies();
    if (needsFit && bodies.length) {
      cam = fitToPoints(cam, worldPoints(), viewport);
      needsFit = false;
    }

    drawPlanes(viewport, bodies);

    const projected = projectBodies(viewport, animate);
    const byId = new Map(projected.map((p) => [p.body.id, p]));
    let near = Infinity;
    let far = -Infinity;
    for (const p of projected) {
      if (p.depth < near) near = p.depth;
      if (p.depth > far) far = p.depth;
    }
    if (!Number.isFinite(near)) {
      near = 1;
      far = 2;
    }
    const span = Math.max(far - near, 1);
    const cue = (depth) => 1 - 0.65 * Math.min(Math.max((depth - near) / span, 0), 1); // 1 near → 0.35 far
    const coolness = (depth) => Math.round(2 * Math.min(Math.max((depth - near) / span, 0), 1));

    const selectedNodeId = selection?.kind === 'node' ? selection.id : null;
    const selectedEdgeId = selection?.kind === 'edge' ? selection.id : null;
    const neighbours = neighboursOf(selectedNodeId);

    // --- edges, batched by style ------------------------------------------
    const plain = { normal: [], dim: [] };
    const dashed = { normal: new Map(), dim: [] };
    const focused = [];
    let selectedEdge = null;

    for (const edge of data.graph.edges) {
      if (!data.visibleEdges.has(edge.id)) continue;
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) continue;
      const soft = isSoftStatus(edge.status);
      const isSelected = edge.id === selectedEdgeId;
      const touches = Boolean(
        (selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId)) ||
        (emphasis && emphasis.has(edge.from) && emphasis.has(edge.to)) ||
        (hover?.kind === 'node' && (edge.from === hover.id || edge.to === hover.id))
      );
      if (!opts.edges && !touches && !isSelected) continue;
      const dim = (emphasis && !touches) || (Boolean(selectedNodeId) && !touches);
      const depthAlpha = cue((a.depth + b.depth) / 2);
      const segment = { a, b, soft, depthAlpha };

      if (isSelected) selectedEdge = segment;
      else if (touches && !dim) focused.push(segment);
      else if (soft && dim) dashed.dim.push(segment);
      else if (soft) {
        const key = String(edge.status ?? '');
        const bucket = dashed.normal.get(key);
        if (bucket) bucket.push(segment);
        else dashed.normal.set(key, [segment]);
      } else plain[dim ? 'dim' : 'normal'].push(segment);
    }

    ctx.lineCap = 'round';
    const strokeBatch = (list, style, widthPx, dash) => {
      if (!list.length) return;
      ctx.beginPath();
      for (const s of list) {
        ctx.moveTo(s.a.sx, s.a.sy);
        ctx.lineTo(s.b.sx, s.b.sy);
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = widthPx;
      if (dash) ctx.setLineDash(dash);
      ctx.stroke();
      if (dash) ctx.setLineDash([]);
    };

    const additive = tokens.dark && quality !== 'low';
    if (additive) ctx.globalCompositeOperation = 'lighter';
    strokeBatch(plain.normal, tokens.edge(0.18), 0.8);
    strokeBatch(plain.dim, tokens.edge(lerp(0.18, DIM_EDGE, dimMix)), 0.8);
    if (additive) ctx.globalCompositeOperation = 'source-over';
    for (const [status, list] of dashed.normal) {
      strokeBatch(list, statusColor(status, { dark: tokens.dark, alpha: 0.5 }), 0.9, [5, 4]);
    }
    strokeBatch(dashed.dim, tokens.edge(lerp(0.18, DIM_EDGE, dimMix)), 0.9, [5, 4]);
    if (focused.length) {
      if (quality === 'high') strokeBatch(focused, tokens.edgeFocusColor(0.15), 4);
      strokeBatch(focused.filter((s) => !s.soft), tokens.edgeFocusColor(0.85), 1.4);
      strokeBatch(focused.filter((s) => s.soft), tokens.edgeFocusColor(0.7), 1.2, [5, 4]);
    }
    if (selectedEdge) {
      if (quality === 'high') strokeBatch([selectedEdge], tokens.glowColor(0.18), 5);
      strokeBatch([selectedEdge], tokens.glowColor(0.95), 2.4, selectedEdge.soft ? [5, 4] : null);
    }

    // --- nodes, furthest first --------------------------------------------
    const nodeDraws = projected.slice().sort((p, q) => q.depth - p.depth);
    const radiusPx = (p) => Math.max(2.2, radiusOf(p.body) * p.scale * 0.9);

    if (opts.glow !== 'off') {
      if (additive) ctx.globalCompositeOperation = 'lighter';
      for (const p of nodeDraws) {
        const node = data.graph.nodeById?.get(p.body.id);
        if (!node) continue;
        const depthAlpha = cue(p.depth);
        const dim = isDimmed(p.body.id, selectedNodeId);
        const isSelected = p.body.id === selectedNodeId;
        const emphasised = isSelected || hover?.id === p.body.id;
        const tw = quality === 'low' ? 1 : twinkle(p.body.id, clock, animate);
        const intensity =
          depthAlpha * (dim ? lerp(1, DIM_NODE, dimMix) : 1) * tw * (emphasised ? 1.35 : 1);
        drawHalo(ctx, sprites, starColor(node, coolness(p.depth)), p.sx, p.sy, radiusPx(p), opts.glow, intensity, quality);
        if (isSelected) {
          drawHalo(ctx, sprites, tokens.glowColor(1), p.sx, p.sy, radiusPx(p) * 1.5, 'high', 0.9 * tw, quality);
        }
      }
      if (additive) ctx.globalCompositeOperation = 'source-over';
    }

    for (const p of nodeDraws) {
      const node = data.graph.nodeById?.get(p.body.id);
      if (!node) continue;
      const depthAlpha = cue(p.depth);
      const dim = isDimmed(p.body.id, selectedNodeId);
      const alpha = depthAlpha * (dim ? lerp(1, DIM_NODE, dimMix) : 1);
      const r = radiusPx(p);
      const isSelected = p.body.id === selectedNodeId;
      const isMatch = data.matches.has(p.body.id);
      const emphasised = isSelected || isMatch || hover?.id === p.body.id;
      const drawShape = r >= SHAPE_MIN_PX || emphasised;

      // Floor: a far *and* dimmed star is still on the map, never erased.
      ctx.globalAlpha = Math.min(1, Math.max(0.12, alpha));
      nodePath(p.sx, p.sy, r, drawShape ? shapeFor(node.type) : 'circle');
      ctx.fillStyle = starColor(node, coolness(p.depth));
      ctx.fill();
      if (r >= 2.6) {
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = strokeFor(node);
        ctx.stroke();
      }

      if (isSoftStatus(node.status)) {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r + 3.6, 0, Math.PI * 2);
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = statusColor(node.status, { dark: tokens.dark, alpha: 0.95 });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;

      // Thin warm ring = search match; thick ring + echo = selection.
      if (isMatch) {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r + 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = tokens.glowColor(0.85);
        ctx.lineWidth = 1.7;
        ctx.stroke();
      }
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r + 8, 0, Math.PI * 2);
        ctx.strokeStyle = tokens.glowColor(1);
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r + 12, 0, Math.PI * 2);
        ctx.strokeStyle = tokens.glowColor(0.35);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (hover?.kind === 'node' && hover.id === p.body.id) {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = tokens.edgeFocusColor(0.7);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    // --- labels: per the `labels` option, never all of them by accident -----
    const mode = opts.labels;
    const budget = Math.min(30, Math.round(4 + 22 / Math.max(1, cam.distance / 900)));
    const labelled = new Set();
    if (mode === 'all') {
      const ranked = projected
        .slice()
        .sort((p, q) => (q.body.degree || 0) - (p.body.degree || 0) || p.body.id.localeCompare(q.body.id));
      for (const p of ranked) {
        if (labelled.size >= MAX_LABELS) break;
        labelled.add(p.body.id);
      }
    } else if (mode === 'auto') {
      const ranked = projected
        .slice()
        .sort((p, q) => (q.body.degree || 0) - (p.body.degree || 0) || p.body.id.localeCompare(q.body.id));
      for (const p of ranked) {
        if (labelled.size >= budget) break;
        labelled.add(p.body.id);
      }
    }
    if (mode !== 'off') {
      if (hover?.kind === 'node') labelled.add(hover.id);
      for (const id of data.matches) labelled.add(id);
      if (emphasis) for (const id of emphasis) labelled.add(id);
    }
    if (selectedNodeId) labelled.add(selectedNodeId);

    ctx.font = '12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const important = (id) =>
      id === selectedNodeId || hover?.id === id || data.matches.has(id) || (emphasis ? emphasis.has(id) : false);
    const labelDraws = nodeDraws
      .filter((p) => labelled.has(p.body.id) && data.graph.nodeById?.get(p.body.id))
      .filter((p) => !(emphasis && !emphasis.has(p.body.id) && p.body.id !== selectedNodeId))
      // Important first, then nearest/most connected: collisions resolve in favour of meaning.
      .sort((a, b) => {
        const tier = (id) => (id === selectedNodeId ? 0 : hover?.id === id ? 1 : important(id) ? 2 : 3);
        return tier(a.body.id) - tier(b.body.id) || (b.body.degree || 0) - (a.body.degree || 0);
      });
    const placer = makeLabelPlacer(3);
    let drawn = 0;
    for (const p of labelDraws) {
      if (drawn >= MAX_LABELS) break;
      const node = data.graph.nodeById.get(p.body.id);
      const text = node.label.length > 34 ? `${node.label.slice(0, 33)}…` : node.label;
      const y = p.sy + radiusPx(p) + 3;
      const w = ctx.measureText(text).width;
      const forced = p.body.id === selectedNodeId || hover?.id === p.body.id;
      if (!placer.tryPlace(p.sx - w / 2, y, w, 14, forced)) continue;
      ctx.lineWidth = 3;
      ctx.strokeStyle = tokens.halo;
      ctx.strokeText(text, p.sx, y);
      ctx.fillStyle = p.body.id === selectedNodeId ? tokens.label : tokens.labelSoft;
      ctx.fillText(text, p.sx, y);
      drawn += 1;
    }

    // --- an ordinal time projection is not a calendar; say so.
    if (projection?.ordinal) {
      ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = tokens.labelSoft;
      ctx.fillText('relation order, not calendar', 10, 10);
    }
  }

  // --- animation ---------------------------------------------------------

  function settling() {
    return Boolean(data.sim && data.sim.alpha > data.sim.options.alphaMin);
  }

  function zTarget() {
    return LAYER_SPREAD[opts.layers] ?? 1;
  }

  function keepAnimating() {
    if (paused) return false;
    if (opts.animation) return true;
    return settling() || interacting || dimMix !== dimTarget() || zScale !== zTarget();
  }

  function frame(ts) {
    if (!running) return;
    const now = (typeof ts === 'number' ? ts : 0) / 1000;
    const dt = lastTs ? Math.min(Math.max(now - lastTs, 0), 0.1) : 1 / 60;
    lastTs = now;
    if (opts.animation && !paused) clock += dt;
    if (settling()) data.sim.tick(1);
    if (opts.animation) {
      dimMix = easeToward(dimMix, dimTarget(), dt, 250);
      zScale = easeToward(zScale, zTarget(), dt, 500);
      // Idle orbit: ambient life only — it yields instantly to the pointer and
      // never runs while a node is selected (the reader is reading, not touring).
      const idleFor = Date.now() - lastInteractionAt;
      if (!interacting && !selection && idleFor > IDLE_AFTER_MS) {
        cam = orbit(cam, IDLE_YAW * dt, 0);
      }
    } else {
      dimMix = dimTarget();
      zScale = zTarget();
    }
    draw();
    if (keepAnimating()) {
      rafId = requestAnimationFrame(frame);
    } else {
      running = false;
      rafId = 0;
    }
  }

  function start() {
    if (running || paused) return;
    running = true;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /** Redraw now; keep the loop alive only while there is something to animate. */
  function invalidate() {
    if (!opts.animation) {
      dimMix = dimTarget();
      zScale = zTarget();
    }
    if (keepAnimating()) start();
    else draw();
  }

  function touched() {
    lastInteractionAt = Date.now();
  }

  // --- picking -----------------------------------------------------------

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pick(point) {
    const viewport = cssSize();
    const projected = projectBodies(viewport, opts.animation && !paused);
    let best = null;
    let bestDist = NODE_PICK_PX;
    for (const p of projected) {
      const r = Math.max(2.2, radiusOf(p.body) * p.scale * 0.9);
      const d = Math.hypot(p.sx - point.x, p.sy - point.y);
      if (d <= Math.max(r, NODE_PICK_PX) && d < bestDist + r) {
        best = { kind: 'node', id: p.body.id };
        bestDist = d;
      }
    }
    if (best) return best;

    const byId = new Map(projected.map((p) => [p.body.id, p]));
    let bestEdge = null;
    let bestEdgeDist = EDGE_PICK_PX;
    for (const edge of data.graph?.edges ?? []) {
      if (!data.visibleEdges.has(edge.id)) continue;
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) continue;
      const mx = (a.sx + b.sx) / 2;
      const my = (a.sy + b.sy) / 2;
      const d = Math.hypot(mx - point.x, my - point.y);
      if (d < bestEdgeDist) {
        bestEdge = { kind: 'edge', id: edge.id };
        bestEdgeDist = d;
      }
    }
    return bestEdge;
  }

  // --- camera helpers ----------------------------------------------------

  function fitAll() {
    const points = worldPoints();
    if (points.length) cam = fitToPoints(cam, points, cssSize());
    needsFit = false;
    handlers.onViewChange?.();
  }

  function focusNode(id) {
    const body = data.sim?.byId.get(id);
    if (!body) return;
    const w = worldOf(body);
    cam = { ...cam, target: { x: w.x, y: w.y, z: w.z } };
    handlers.onViewChange?.();
    invalidate();
  }

  // --- gestures ----------------------------------------------------------

  function pointerList() {
    return [...pointers.values()];
  }

  function onPointerDown(event) {
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    movedPx = 0;
    interacting = true;
    touched();
    const list = pointerList();
    if (list.length >= 2) {
      const [a, b] = list;
      gesture = {
        kind: 'pinch',
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
    } else {
      gesture = { kind: event.shiftKey ? 'pan' : 'orbit', x: event.clientX, y: event.clientY };
    }
  }

  function onPointerMove(event) {
    touched();
    if (!pointers.has(event.pointerId)) {
      if (event.pointerType === 'mouse') {
        const hit = pick(localPoint(event));
        const changed = (hit?.id ?? null) !== (hover?.id ?? null);
        hover = hit;
        if (canvas.style) canvas.style.cursor = hit ? 'pointer' : 'grab';
        if (changed) {
          handlers.onHover?.(hit);
          invalidate();
        }
      }
      return;
    }

    const prev = pointers.get(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    if (event.cancelable) event.preventDefault();
    const dx = event.clientX - prev.x;
    const dy = event.clientY - prev.y;
    movedPx += Math.abs(dx) + Math.abs(dy);

    const list = pointerList();
    if (list.length >= 2 && gesture?.kind === 'pinch') {
      const [a, b] = list;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (gesture.distance > 0 && distance > 0) cam = zoom(cam, distance / gesture.distance);
      cam = pan(cam, cx - gesture.cx, cy - gesture.cy, cssSize());
      gesture = { kind: 'pinch', distance, cx, cy };
    } else if (gesture?.kind === 'pan' || event.shiftKey) {
      cam = pan(cam, dx, dy, cssSize());
    } else {
      cam = orbit(cam, -dx * 0.006, dy * 0.006);
    }
    handlers.onViewChange?.();
    invalidate();
  }

  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    touched();
    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch {
      /* already released */
    }
    if (pointers.size === 0) {
      interacting = false;
      const wasGesture = gesture;
      gesture = null;
      if (event.type === 'pointerup' && movedPx < 6 && wasGesture?.kind !== 'pinch') {
        const hit = pick(localPoint(event));
        const now = Date.now();
        if (hit?.kind === 'node' && lastTap.id === hit.id && now - lastTap.time < DOUBLE_TAP_MS) {
          lastTap = { time: 0, id: null };
          focusNode(hit.id);
          return;
        }
        lastTap = { time: now, id: hit?.kind === 'node' ? hit.id : null };
        handlers.onSelect?.(hit ?? null);
      }
      invalidate();
    } else if (pointers.size === 1) {
      const [only] = pointerList();
      gesture = { kind: 'orbit', x: only.x, y: only.y };
    }
  }

  function onWheel(event) {
    event.preventDefault();
    touched();
    cam = zoom(cam, Math.exp(-event.deltaY * 0.0016));
    handlers.onViewChange?.();
    invalidate();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove, { passive: false });
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (event) => {
    if (!pointers.has(event.pointerId) && hover) {
      hover = null;
      handlers.onHover?.(null);
      invalidate();
    }
  });
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const onResize = () => {
    particleSize = { width: 0, height: 0, count: -1 };
    invalidate();
  };
  globalThis.addEventListener('resize', onResize);

  const onVisibility = () => {
    const doc = globalThis.document;
    paused = doc ? doc.visibilityState === 'hidden' : false;
    if (paused) stop();
    else invalidate();
  };
  globalThis.document?.addEventListener?.('visibilitychange', onVisibility);

  // --- public surface ----------------------------------------------------

  return {
    get camera() {
      return cam;
    },
    setData(next = {}) {
      data = { ...data, ...next };
      if (next.graph) {
        if (!next.visibleNodes) data.visibleNodes = new Set(next.graph.nodes.map((n) => n.id));
        if (!next.visibleEdges) data.visibleEdges = new Set(next.graph.edges.map((e) => e.id));
        recomputeProjection();
        needsFit = true;
      }
      neighbourCache = { id: null, set: new Set() };
      computeMaxDegree();
      invalidate();
    },
    setProjection(id) {
      projectionId = id;
      recomputeProjection();
      needsFit = true;
      invalidate();
      return projection;
    },
    /** The computed projection (id, availability, layers, encoding). */
    getProjection() {
      if (!projection) recomputeProjection();
      return projection;
    },
    setSelection(next) {
      selection = next ?? null;
      neighbourCache = { id: null, set: new Set() };
      invalidate();
    },
    setMatches(matches) {
      data.matches = matches ?? new Set();
      invalidate();
    },
    setVisible(visibleNodeIds, visibleEdgeIds) {
      data.visibleNodes = visibleNodeIds ?? new Set();
      data.visibleEdges = visibleEdgeIds ?? new Set();
      neighbourCache = { id: null, set: new Set() };
      computeMaxDegree();
      invalidate();
    },
    setEmphasis(idSet) {
      emphasis = idSet && idSet.size ? idSet : null;
      invalidate();
    },
    /** Re-read the CSS palette after a theme change (§18). */
    setTheme() {
      opts = mergeVisualOptions(opts, { theme: detectTheme() });
      tokens = readCanvasTokens(opts.theme);
      sprites.clear();
      invalidate();
    },
    /** Merge constellation options (Lot U owns the controls); re-renders. */
    setVisualOptions(partial = {}) {
      const before = opts;
      opts = mergeVisualOptions(opts, partial);
      if (before.theme !== opts.theme) {
        tokens = readCanvasTokens(opts.theme);
        sprites.clear();
      }
      if (before.glow !== opts.glow || before.quality !== opts.quality) sprites.clear();
      if (before.quality !== opts.quality) particleSize = { width: 0, height: 0, count: -1 };
      if (!opts.animation) {
        dimMix = dimTarget();
        zScale = zTarget();
      }
      if (!opts.animation && running && !settling() && !interacting) stop();
      invalidate();
      return opts;
    },
    getVisualOptions() {
      return { ...opts };
    },
    recenter() {
      fitAll();
      invalidate();
    },
    fitAll,
    focusNode,
    resetView() {
      cam = resetCamera(cam);
      fitAll();
      invalidate();
    },
    zoomBy(factor) {
      cam = zoom(cam, factor);
      handlers.onViewChange?.();
      invalidate();
    },
    draw,
    start,
    stop,
    resize() {
      resize();
      particleSize = { width: 0, height: 0, count: -1 };
      invalidate();
    },
    destroy() {
      stop();
      globalThis.removeEventListener('resize', onResize);
      globalThis.document?.removeEventListener?.('visibilitychange', onVisibility);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endPointer);
      canvas.removeEventListener('pointercancel', endPointer);
      canvas.removeEventListener('wheel', onWheel);
      sprites.clear();
    },
  };
}
