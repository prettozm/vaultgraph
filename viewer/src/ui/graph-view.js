// Canvas renderer + interaction for the 2D graph (CDC §22, brief §4/§16).
// Pan (drag background), zoom (wheel/pinch-less), node drag, click-to-select,
// recenter/fit/reset, search highlighting, emphasis (Focus), theme-aware colours.
import { colorFor, inkFor, statusColor, shapeForType, isTentative } from '../lib/colors.js';
import { boundsOf } from '../lib/layout.js';

const MIN_SCALE = 0.08;
const MAX_SCALE = 8;
const LABEL_ALWAYS_MAX = 40; // never label every node beyond this many (§16)

function cssVar(styles, name, fallback) {
  const value = styles.getPropertyValue(name);
  return value && value.trim() ? value.trim() : fallback;
}

/** Read the canvas palette from the CSS custom properties (dark mode, §18). */
export function readPalette(root = document.documentElement) {
  let styles;
  try {
    styles = getComputedStyle(root);
  } catch {
    styles = { getPropertyValue: () => '' };
  }
  const edgeRgb = cssVar(styles, '--canvas-edge', '120, 130, 145');
  const dark = (root.dataset?.theme ?? '') === 'dark' ||
    (!root.dataset?.theme && matchesDark());
  return {
    dark,
    edge: (alpha) => `rgba(${edgeRgb}, ${alpha})`,
    label: cssVar(styles, '--canvas-label', '#14243a'),
    labelSoft: cssVar(styles, '--canvas-label-soft', '#5c6675'),
    halo: cssVar(styles, '--canvas-halo', 'rgba(252,252,250,0.92)'),
    accent: cssVar(styles, '--focus', '#2f6f9f'),
  };
}

function matchesDark() {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  } catch {
    return false;
  }
}

/** Draw one node glyph; shape carries the type so colour is never alone (§19). */
export function pathForShape(ctx, shape, x, y, r) {
  ctx.beginPath();
  if (shape === 'square') {
    const s = r * 0.92;
    ctx.rect(x - s, y - s, s * 2, s * 2);
  } else if (shape === 'diamond') {
    const s = r * 1.25;
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s, y);
    ctx.closePath();
  } else if (shape === 'triangle') {
    const s = r * 1.3;
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.9, y + s * 0.72);
    ctx.lineTo(x - s * 0.9, y + s * 0.72);
    ctx.closePath();
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  return ctx;
}

export function createGraphView(canvas, handlers = {}) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, tx: 0, ty: 0 };
  let data = { graph: null, sim: null, visibleNodes: new Set(), visibleEdges: new Set(), matches: new Set() };
  let selection = null;
  let hover = null;
  let emphasis = null;
  let palette = readPalette();
  let running = false;
  let rafId = 0;
  let dragging = null;
  let pointerMoved = false;
  let labelRank = new Map();

  function cssSize() {
    const rect = canvas.getBoundingClientRect();
    return { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
  }

  function resizeCanvas() {
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

  // Size by degree: sqrt, clamped, so a hub reads bigger without exploding (§4).
  function radiusOf(body) {
    return Math.min(4 + Math.sqrt(body.degree || 0) * 2.4, 18);
  }

  function visibleBodies() {
    if (!data.sim) return [];
    return data.sim.bodies.filter((b) => data.visibleNodes.has(b.id));
  }

  function computeLabelRank() {
    labelRank = new Map();
    const bodies = visibleBodies()
      .slice()
      .sort((a, b) => (b.degree || 0) - (a.degree || 0));
    bodies.forEach((b, i) => labelRank.set(b.id, i));
  }

  function pickNode(world) {
    let best = null;
    let bestDist = Infinity;
    for (const body of visibleBodies()) {
      const r = radiusOf(body) + 8 / view.scale;
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
    const tolerance = 7 / view.scale;
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

  function faded(id) {
    return Boolean(emphasis) && !emphasis.has(id);
  }

  function draw() {
    const { width, height, dpr } = resizeCanvas();
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
      const touchesSelection = selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId);
      const dim = faded(edge.from) || faded(edge.to) || (Boolean(selectedNodeId) && !touchesSelection);
      // Candidate / unresolved relations stay visually lighter — never confirmed (§4, §27).
      const tentative = isTentative(edge.status) || edge.sources.length === 0;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (isSelected) ctx.strokeStyle = palette.accent;
      else if (tentative) ctx.strokeStyle = statusColor(edge.status, { dark: palette.dark, alpha: dim ? 0.16 : 0.5 });
      else ctx.strokeStyle = palette.edge(dim ? 0.12 : touchesSelection ? 0.75 : 0.42);
      ctx.lineWidth = (isSelected ? 2.6 : tentative ? 0.9 : touchesSelection ? 1.7 : 1.1) / view.scale;
      if (tentative) ctx.setLineDash([5 / view.scale, 4 / view.scale]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (view.scale > 0.45 && !tentative) {
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
        ctx.fillStyle = isSelected ? palette.accent : palette.edge(dim ? 0.15 : 0.55);
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
      const dim = faded(body.id) || (Boolean(selectedNodeId) && !isSelected && !isNeighbour);
      const shape = shapeForType(node.type);

      pathForShape(ctx, shape, body.x, body.y, r);
      ctx.fillStyle = dim ? colorFor(node.type, { alpha: 0.18 }) : colorFor(node.type);
      ctx.fill();
      ctx.strokeStyle = dim ? palette.edge(0.18) : inkFor(node.type);
      ctx.lineWidth = 1.2 / view.scale;
      ctx.stroke();

      // Dashed halo = candidate / unresolved, or no recorded provenance (§4).
      const tentative = isTentative(node.status) || node.sources.length === 0;
      if (tentative) {
        pathForShape(ctx, shape, body.x, body.y, r + 3.5 / view.scale);
        ctx.setLineDash([3 / view.scale, 3 / view.scale]);
        ctx.strokeStyle = statusColor(node.status, { dark: palette.dark, alpha: dim ? 0.3 : 0.95 });
        ctx.lineWidth = 1.6 / view.scale;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (data.matches.has(body.id)) {
        pathForShape(ctx, shape, body.x, body.y, r + 6 / view.scale);
        ctx.strokeStyle = '#c98a00';
        ctx.lineWidth = 2.2 / view.scale;
        ctx.stroke();
      }
      if (isSelected) {
        pathForShape(ctx, shape, body.x, body.y, r + 8 / view.scale);
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 2.4 / view.scale;
        ctx.stroke();
      }
    }

    // --- labels: selective (§16)
    const zoomBudget = Math.round(Math.min(220, Math.max(0, (view.scale - 0.5) * 90)));
    const topN = bodies.length <= LABEL_ALWAYS_MAX ? bodies.length : zoomBudget;
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
        hover === body.id ||
        (emphasis ? emphasis.has(body.id) : false);
      const ranked = (labelRank.get(body.id) ?? Infinity) < topN;
      if (!important && !ranked) continue;
      if (!important && faded(body.id)) continue;
      if (!important && Boolean(selectedNodeId)) continue;
      const text = node.label.length > 34 ? `${node.label.slice(0, 33)}…` : node.label;
      const y = body.y + radiusOf(body) + 4 / view.scale;
      ctx.lineWidth = 3 / view.scale;
      ctx.strokeStyle = palette.halo;
      ctx.strokeText(text, body.x, y);
      ctx.fillStyle = important ? palette.label : palette.labelSoft;
      ctx.fillText(text, body.x, y);
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

  function fitTo(points, padding = 56) {
    const { width, height } = cssSize();
    if (!points.length) {
      view.scale = 1;
      view.tx = width / 2;
      view.ty = height / 2;
      return;
    }
    const b = boundsOf(points);
    const scale = Math.min((width - padding * 2) / b.width, (height - padding * 2) / b.height, 2.2);
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
      canvas.style.cursor = body || edgeHit ? 'pointer' : 'grab';
      if (next !== hover) {
        hover = next;
        handlers.onHover?.(next);
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
      zoomBy(Math.exp(-event.deltaY * 0.0016), event);
    },
    { passive: false }
  );

  const onResize = () => draw();
  globalThis.addEventListener('resize', onResize);

  return {
    view,
    setData(next) {
      data = { ...data, ...next };
      computeLabelRank();
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
      computeLabelRank();
      draw();
    },
    /** Emphasise a subset; everything else is drawn faded (Focus, §13). */
    setEmphasis(idSet) {
      emphasis = idSet && idSet.size ? idSet : null;
      draw();
    },
    getEmphasis() {
      return emphasis;
    },
    /** Re-read the CSS palette after a theme change (§18). */
    setTheme() {
      palette = readPalette();
      draw();
    },
    recenter,
    focusNode,
    zoomBy,
    fitAll() {
      fitTo(visibleBodies());
      draw();
    },
    /** Back to a neutral camera: fit everything, drop emphasis and hover (§15). */
    resetView() {
      emphasis = null;
      hover = null;
      fitTo(visibleBodies());
      draw();
    },
    resize() {
      resizeCanvas();
      draw();
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
