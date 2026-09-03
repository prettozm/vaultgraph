// Canvas renderer + gestures for the 3D projection of the graph (v0.2 §3, §15).
//
// Zero dependencies: no WebGL, no three.js — a painter's-algorithm renderer on
// the same 2D canvas context the flat view uses. X/Y are the force-layout body
// positions, Z is the semantic projection (lib/projections.js) multiplied by
// Z_SPREAD so the layers separate.
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

/** World units between the extreme projection layers (z ∈ [-1, 1]). */
export const Z_SPREAD = 520;

const NODE_PICK_PX = 12;
const EDGE_PICK_PX = 8;
const MAX_PLANES = 12;
const DOUBLE_TAP_MS = 320;

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

  function zOf(id) {
    const raw = projection?.z?.get(id);
    return (Number.isFinite(raw) ? raw : 0) * Z_SPREAD;
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

  function radiusOf(body) {
    return 4.5 + Math.sqrt(body.degree || 0) * 2.4;
  }

  /** Project every visible body once per frame. */
  function projectBodies(viewport) {
    const out = [];
    for (const body of visibleBodies()) {
      const p = project(worldOf(body), cam, viewport);
      if (p.behind) continue;
      out.push({ body, ...p });
    }
    return out;
  }

  function recomputeProjection() {
    projection = data.graph
      ? computeProjection(data.graph, projectionId)
      : { id: projectionId, available: false, layers: [], z: new Map(), encoding: { colorBy: 'type' } };
  }

  // --- colours -----------------------------------------------------------

  function statusColor(status) {
    if (typeof palette.statusColor === 'function') return palette.statusColor(status);
    const key = normalizeName(status);
    return STATUS_COLORS[key] ?? colorFor(status ?? '(unset)');
  }

  function fillFor(node) {
    return projection?.encoding?.colorBy === 'status'
      ? statusColor(node.status)
      : colorFor(node.type);
  }

  function strokeFor(node) {
    return projection?.encoding?.colorBy === 'status' ? '#2a2f38' : inkFor(node.type);
  }

  function alphaFor(id, depthAlpha) {
    if (emphasis && !emphasis.has(id)) return 0.2 * depthAlpha;
    return depthAlpha;
  }

  // --- drawing -----------------------------------------------------------

  function drawPlanes(viewport, bodies) {
    const layers = projection?.layers ?? [];
    if (!layers.length || layers.length > MAX_PLANES || !bodies.length) return;
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

    const ordered = [...layers].sort((a, b) => {
      const da = project({ x: 0, y: a.z * Z_SPREAD, z: 0 }, cam, viewport).depth;
      const db = project({ x: 0, y: b.z * Z_SPREAD, z: 0 }, cam, viewport).depth;
      return db - da; // furthest first
    });

    ctx.save();
    for (const layer of ordered) {
      const y = layer.z * Z_SPREAD;
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
      ctx.fillStyle = 'rgba(120,132,150,0.05)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,132,150,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();

      const anchor = corners.reduce((best, c) => (c.sx < best.sx ? c : best), corners[0]);
      ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const text = `${layer.label} (${layer.count})`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(252,252,250,0.85)';
      ctx.strokeText(text, anchor.sx - 6, anchor.sy);
      ctx.fillStyle = 'rgba(70,79,94,0.95)';
      ctx.fillText(text, anchor.sx - 6, anchor.sy);
    }
    ctx.restore();
  }

  function nodePath(p, r, shape) {
    ctx.beginPath();
    if (shape === 'square') {
      ctx.rect(p.sx - r, p.sy - r, r * 2, r * 2);
    } else if (shape === 'diamond') {
      ctx.moveTo(p.sx, p.sy - r * 1.25);
      ctx.lineTo(p.sx + r * 1.25, p.sy);
      ctx.lineTo(p.sx, p.sy + r * 1.25);
      ctx.lineTo(p.sx - r * 1.25, p.sy);
      ctx.closePath();
    } else if (shape === 'triangle') {
      ctx.moveTo(p.sx, p.sy - r * 1.35);
      ctx.lineTo(p.sx + r * 1.2, p.sy + r);
      ctx.lineTo(p.sx - r * 1.2, p.sy + r);
      ctx.closePath();
    } else {
      ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
    }
  }

  function draw() {
    const { width, height, dpr } = resize();
    const viewport = { width, height };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!data.graph || !data.sim) return;
    if (!projection) recomputeProjection();

    const bodies = visibleBodies();
    if (needsFit && bodies.length) {
      cam = fitToPoints(cam, worldPoints(), viewport);
      needsFit = false;
    }

    drawPlanes(viewport, bodies);

    const projected = projectBodies(viewport);
    const byId = new Map(projected.map((p) => [p.body.id, p]));
    const depths = projected.map((p) => p.depth);
    const near = depths.length ? Math.min(...depths) : 1;
    const far = depths.length ? Math.max(...depths) : 2;
    const span = Math.max(far - near, 1);
    const cue = (depth) => 1 - 0.65 * Math.min(Math.max((depth - near) / span, 0), 1); // 1 near → 0.35 far

    const selectedNodeId = selection?.kind === 'node' ? selection.id : null;
    const selectedEdgeId = selection?.kind === 'edge' ? selection.id : null;

    // --- edges, furthest first
    const edgeDraws = [];
    for (const edge of data.graph.edges) {
      if (!data.visibleEdges.has(edge.id)) continue;
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) continue;
      edgeDraws.push({ edge, a, b, depth: (a.depth + b.depth) / 2 });
    }
    edgeDraws.sort((p, q) => q.depth - p.depth);

    ctx.lineCap = 'round';
    for (const { edge, a, b, depth } of edgeDraws) {
      const soft = isSoftStatus(edge.status);
      const isSelected = edge.id === selectedEdgeId;
      const touches =
        selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId);
      let alpha = cue(depth) * (soft ? 0.5 : 0.75);
      if (emphasis && !(emphasis.has(edge.from) && emphasis.has(edge.to))) alpha *= 0.2;
      if (selectedNodeId && !touches) alpha *= 0.45;

      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.strokeStyle = isSelected
        ? 'rgba(180,86,15,0.95)'
        : `rgba(108,120,138,${alpha.toFixed(3)})`;
      ctx.lineWidth = isSelected ? 2.4 : soft ? 0.9 : 1.2;
      if (soft) ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // --- nodes, furthest first
    const nodeDraws = projected.slice().sort((p, q) => q.depth - p.depth);
    for (const p of nodeDraws) {
      const node = data.graph.nodeById?.get(p.body.id);
      if (!node) continue;
      const depthAlpha = cue(p.depth);
      const alpha = alphaFor(p.body.id, depthAlpha);
      const r = Math.max(2.2, radiusOf(p.body) * p.scale * 0.9);
      const isSelected = p.body.id === selectedNodeId;
      const isMatch = data.matches.has(p.body.id);

      ctx.globalAlpha = Math.min(1, Math.max(0.05, alpha));
      nodePath(p, r, shapeFor(node.type));
      ctx.fillStyle = fillFor(node);
      ctx.fill();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = strokeFor(node);
      ctx.stroke();

      if (isSoftStatus(node.status)) {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r + 3.2, 0, Math.PI * 2);
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = strokeFor(node);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;

      if (isMatch) {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#c98a00';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r + 7.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#11304f';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }
    }

    // --- labels: never all of them at once
    const budget = Math.min(30, Math.round(4 + 22 / Math.max(1, cam.distance / 900)));
    const ranked = projected
      .slice()
      .sort((p, q) => (q.body.degree || 0) - (p.body.degree || 0) || p.body.id.localeCompare(q.body.id));
    const labelled = new Set();
    for (const p of ranked) {
      if (labelled.size >= budget) break;
      labelled.add(p.body.id);
    }
    if (selectedNodeId) labelled.add(selectedNodeId);
    if (hover?.kind === 'node') labelled.add(hover.id);
    for (const id of data.matches) labelled.add(id);
    if (emphasis) for (const id of emphasis) labelled.add(id);

    ctx.font = '12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const p of nodeDraws) {
      if (!labelled.has(p.body.id)) continue;
      const node = data.graph.nodeById?.get(p.body.id);
      if (!node) continue;
      if (emphasis && !emphasis.has(p.body.id) && p.body.id !== selectedNodeId) continue;
      const text = node.label.length > 34 ? `${node.label.slice(0, 33)}…` : node.label;
      const r = Math.max(2.2, radiusOf(p.body) * p.scale * 0.9);
      const y = p.sy + r + 3;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(252,252,250,0.9)';
      ctx.strokeText(text, p.sx, y);
      ctx.fillStyle = p.body.id === selectedNodeId ? '#14243a' : '#49515f';
      ctx.fillText(text, p.sx, y);
    }

    // --- an ordinal time projection is not a calendar; say so.
    if (projection?.ordinal) {
      ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(70,79,94,0.9)';
      ctx.fillText('relation order, not calendar', 10, 10);
    }
  }

  // --- animation ---------------------------------------------------------

  function settling() {
    return Boolean(data.sim && data.sim.alpha > data.sim.options.alphaMin);
  }

  function frame() {
    if (!running) return;
    if (settling()) data.sim.tick(1);
    draw();
    if (!settling() && !interacting) {
      running = false;
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /** Redraw now; keep the loop alive only while there is something to animate. */
  function invalidate() {
    if (settling() || interacting) start();
    else draw();
  }

  // --- picking -----------------------------------------------------------

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pick(point) {
    const viewport = cssSize();
    const projected = projectBodies(viewport);
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

  const onResize = () => invalidate();
  globalThis.addEventListener('resize', onResize);

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
      invalidate();
    },
    setMatches(matches) {
      data.matches = matches ?? new Set();
      invalidate();
    },
    setVisible(visibleNodeIds, visibleEdgeIds) {
      data.visibleNodes = visibleNodeIds ?? new Set();
      data.visibleEdges = visibleEdgeIds ?? new Set();
      invalidate();
    },
    setEmphasis(idSet) {
      emphasis = idSet && idSet.size ? idSet : null;
      invalidate();
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
      invalidate();
    },
    destroy() {
      stop();
      globalThis.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endPointer);
      canvas.removeEventListener('pointercancel', endPointer);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
