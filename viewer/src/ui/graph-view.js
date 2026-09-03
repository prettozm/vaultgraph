// Canvas renderer + interaction for the 2D graph (CDC §22).
// Pan (drag background), zoom (wheel), node drag, click-to-select node or edge,
// recenter, and search highlighting.
import { colorFor, inkFor } from '../lib/colors.js';
import { boundsOf } from '../lib/layout.js';

const MIN_SCALE = 0.08;
const MAX_SCALE = 8;

export function createGraphView(canvas, handlers = {}) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, tx: 0, ty: 0 };
  let data = { graph: null, sim: null, visibleNodes: new Set(), visibleEdges: new Set(), matches: new Set() };
  let selection = null;
  let hover = null;
  let running = false;
  let rafId = 0;
  let dragging = null;
  let pointerMoved = false;

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

  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    };
  }

  function radiusOf(body) {
    return 4.5 + Math.sqrt(body.degree || 0) * 2.4;
  }

  function visibleBodies() {
    if (!data.sim) return [];
    return data.sim.bodies.filter((b) => data.visibleNodes.has(b.id));
  }

  function pickNode(world) {
    const bodies = visibleBodies();
    let best = null;
    let bestDist = Infinity;
    for (const body of bodies) {
      const r = radiusOf(body) + 6 / view.scale;
      const d = Math.hypot(body.x - world.x, body.y - world.y);
      if (d <= r && d < bestDist) {
        best = body;
        bestDist = d;
      }
    }
    return best;
  }

  function distanceToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function pickEdge(world) {
    if (!data.graph || !data.sim) return null;
    const tolerance = 6 / view.scale;
    let best = null;
    let bestDist = tolerance;
    for (const edge of data.graph.edges) {
      if (!data.visibleEdges.has(edge.id)) continue;
      const a = data.sim.byId.get(edge.from);
      const b = data.sim.byId.get(edge.to);
      if (!a || !b) continue;
      const d = distanceToSegment(world, a, b);
      if (d < bestDist) {
        best = edge;
        bestDist = d;
      }
    }
    return best;
  }

  function draw() {
    const { width, height, dpr } = resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!data.graph || !data.sim) return;

    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty);

    const selectedNodeId = selection?.kind === 'node' ? selection.id : null;
    const selectedEdgeId = selection?.kind === 'edge' ? selection.id : null;
    const neighbours = new Set();
    if (selectedNodeId) {
      const adj = data.graph.adjacency.get(selectedNodeId);
      if (adj) {
        for (const id of [...adj.in, ...adj.out]) {
          const e = data.graph.edgeById.get(id);
          if (!e || !data.visibleEdges.has(e.id)) continue;
          neighbours.add(e.from);
          neighbours.add(e.to);
        }
      }
    }

    // --- edges
    ctx.lineCap = 'round';
    for (const edge of data.graph.edges) {
      if (!data.visibleEdges.has(edge.id)) continue;
      const a = data.sim.byId.get(edge.from);
      const b = data.sim.byId.get(edge.to);
      if (!a || !b) continue;
      const isSelected = edge.id === selectedEdgeId;
      const touchesSelection =
        selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId);
      const dim = Boolean(selectedNodeId) && !touchesSelection;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = isSelected
        ? '#b4560f'
        : touchesSelection
          ? 'rgba(60,70,90,0.75)'
          : dim
            ? 'rgba(120,130,145,0.14)'
            : 'rgba(120,130,145,0.42)';
      ctx.lineWidth = (isSelected ? 2.6 : touchesSelection ? 1.7 : 1.1) / view.scale;
      if (edge.sources.length === 0) ctx.setLineDash([5 / view.scale, 4 / view.scale]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrow head, only when large enough to read.
      if (view.scale > 0.45) {
        const rb = radiusOf(b);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const tipX = b.x - Math.cos(angle) * rb;
        const tipY = b.y - Math.sin(angle) * rb;
        const size = (isSelected ? 9 : 6.5) / view.scale;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - Math.cos(angle - 0.4) * size, tipY - Math.sin(angle - 0.4) * size);
        ctx.lineTo(tipX - Math.cos(angle + 0.4) * size, tipY - Math.sin(angle + 0.4) * size);
        ctx.closePath();
        ctx.fillStyle = isSelected
          ? '#b4560f'
          : dim
            ? 'rgba(120,130,145,0.18)'
            : 'rgba(90,100,115,0.55)';
        ctx.fill();
      }
    }

    // --- nodes
    const bodies = visibleBodies();
    for (const body of bodies) {
      const node = data.graph.nodeById.get(body.id);
      if (!node) continue;
      const r = radiusOf(body);
      const isSelected = body.id === selectedNodeId;
      const isNeighbour = neighbours.has(body.id) && !isSelected;
      const isMatch = data.matches.has(body.id);
      const dim = Boolean(selectedNodeId) && !isSelected && !isNeighbour;

      ctx.beginPath();
      ctx.arc(body.x, body.y, r, 0, Math.PI * 2);
      ctx.fillStyle = dim ? colorFor(node.type, { alpha: 0.22 }) : colorFor(node.type);
      ctx.fill();

      // A dashed ring means "no provenance" — structural, not vocabulary-based.
      ctx.beginPath();
      ctx.arc(body.x, body.y, r + 0.8, 0, Math.PI * 2);
      if (node.sources.length === 0) ctx.setLineDash([3 / view.scale, 3 / view.scale]);
      ctx.strokeStyle = dim ? 'rgba(40,44,52,0.18)' : inkFor(node.type);
      ctx.lineWidth = 1.2 / view.scale;
      ctx.stroke();
      ctx.setLineDash([]);

      if (isMatch) {
        ctx.beginPath();
        ctx.arc(body.x, body.y, r + 5 / view.scale, 0, Math.PI * 2);
        ctx.strokeStyle = '#c98a00';
        ctx.lineWidth = 2.2 / view.scale;
        ctx.stroke();
      }
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(body.x, body.y, r + 7 / view.scale, 0, Math.PI * 2);
        ctx.strokeStyle = '#11304f';
        ctx.lineWidth = 2.4 / view.scale;
        ctx.stroke();
      }
    }

    // --- labels (only when readable, or when they matter)
    const showAll = view.scale > 0.75 && bodies.length <= 320;
    if (showAll || selectedNodeId || data.matches.size || hover) {
      ctx.font = `${12 / view.scale}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const body of bodies) {
        const node = data.graph.nodeById.get(body.id);
        if (!node) continue;
        const important =
          body.id === selectedNodeId ||
          data.matches.has(body.id) ||
          neighbours.has(body.id) ||
          hover === body.id;
        if (!showAll && !important) continue;
        const dim = Boolean(selectedNodeId) && !important;
        if (dim) continue;
        const text = node.label.length > 34 ? `${node.label.slice(0, 33)}…` : node.label;
        const y = body.y + radiusOf(body) + 3 / view.scale;
        ctx.lineWidth = 3 / view.scale;
        ctx.strokeStyle = 'rgba(252,252,250,0.9)';
        ctx.strokeText(text, body.x, y);
        ctx.fillStyle = important ? '#14243a' : '#4a5261';
        ctx.fillText(text, body.x, y);
      }
    }
  }

  function frame() {
    if (!running) return;
    if (data.sim && data.sim.alpha > data.sim.options.alphaMin) data.sim.tick(1);
    draw();
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

  function fitTo(points, padding = 60) {
    const { width, height } = cssSize();
    if (!points.length) {
      view.scale = 1;
      view.tx = width / 2;
      view.ty = height / 2;
      return;
    }
    const b = boundsOf(points);
    const scale = Math.min(
      (width - padding * 2) / b.width,
      (height - padding * 2) / b.height,
      2.2
    );
    view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    view.tx = width / 2 - ((b.x0 + b.x1) / 2) * view.scale;
    view.ty = height / 2 - ((b.y0 + b.y1) / 2) * view.scale;
  }

  function recenter() {
    fitTo(visibleBodies());
    draw();
  }

  function focusNode(id, { zoom = null } = {}) {
    const body = data.sim?.byId.get(id);
    if (!body) return;
    const { width, height } = cssSize();
    if (zoom) view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, zoom));
    view.tx = width / 2 - body.x * view.scale;
    view.ty = height / 2 - body.y * view.scale;
    draw();
  }

  function zoomBy(factor, anchor) {
    const { width, height } = cssSize();
    const rect = canvas.getBoundingClientRect();
    const ax = anchor ? anchor.clientX - rect.left : width / 2;
    const ay = anchor ? anchor.clientY - rect.top : height / 2;
    const worldX = (ax - view.tx) / view.scale;
    const worldY = (ay - view.ty) / view.scale;
    view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
    view.tx = ax - worldX * view.scale;
    view.ty = ay - worldY * view.scale;
    draw();
  }

  // --- interaction -------------------------------------------------------

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    pointerMoved = false;
    const world = toWorld(event.clientX, event.clientY);
    const body = pickNode(world);
    if (body) {
      dragging = { kind: 'node', body, dx: body.x - world.x, dy: body.y - world.y };
      body.fixed = true;
    } else {
      dragging = { kind: 'view', startX: event.clientX, startY: event.clientY, tx: view.tx, ty: view.ty };
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) {
      const world = toWorld(event.clientX, event.clientY);
      const body = pickNode(world);
      const next = body ? body.id : null;
      const edgeHit = !body && pickEdge(world);
      canvas.style.cursor = body ? 'pointer' : edgeHit ? 'pointer' : 'grab';
      if (next !== hover) {
        hover = next;
        draw();
      }
      return;
    }
    pointerMoved = true;
    if (dragging.kind === 'view') {
      view.tx = dragging.tx + (event.clientX - dragging.startX);
      view.ty = dragging.ty + (event.clientY - dragging.startY);
      draw();
    } else {
      const world = toWorld(event.clientX, event.clientY);
      dragging.body.x = world.x + dragging.dx;
      dragging.body.y = world.y + dragging.dy;
      dragging.body.vx = 0;
      dragging.body.vy = 0;
      data.sim?.reheat(0.35);
      start();
    }
  });

  function endDrag(event) {
    if (!dragging) return;
    const wasNode = dragging.kind === 'node' ? dragging.body : null;
    const moved = pointerMoved;
    if (wasNode) wasNode.fixed = false;
    dragging = null;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      /* pointer already released */
    }
    if (moved) return;
    // A click, not a drag: select.
    const world = toWorld(event.clientX, event.clientY);
    const body = pickNode(world);
    if (body) {
      handlers.onSelectNode?.(body.id);
      return;
    }
    const edge = pickEdge(world);
    if (edge) {
      handlers.onSelectEdge?.(edge.id);
      return;
    }
    handlers.onClearSelection?.();
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0016);
      zoomBy(factor, event);
    },
    { passive: false }
  );

  const onResize = () => draw();
  globalThis.addEventListener('resize', onResize);

  return {
    view,
    setData(next) {
      data = { ...data, ...next };
      draw();
    },
    setSelection(next) {
      selection = next;
      draw();
    },
    setMatches(matches) {
      data.matches = matches ?? new Set();
      draw();
    },
    setVisible(visibleNodes, visibleEdges) {
      data.visibleNodes = visibleNodes;
      data.visibleEdges = visibleEdges;
      draw();
    },
    recenter,
    focusNode,
    zoomBy,
    fitAll() {
      fitTo(visibleBodies());
    },
    draw,
    start,
    stop,
    destroy() {
      stop();
      globalThis.removeEventListener('resize', onResize);
    },
  };
}
