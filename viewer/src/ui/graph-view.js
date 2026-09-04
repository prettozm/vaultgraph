// Canvas renderer + interaction for the 2D graph (CDC §22, brief §4/§16).
// Pan (drag background), zoom (wheel/pinch-less), node drag, click-to-select,
// recenter/fit/reset, search highlighting, emphasis (Focus), theme-aware colours.
//
// v0.3 "living constellation" (Lot R): the graph is painted on a deep-space
// ground — gradient + vignette + dust — and each node is a star. Nothing
// analytic was traded for it; see ui/starfield.js for the encoding contract.
// Rendering is done in **screen space** (positions projected once per frame)
// so halo sprites, line widths and label metrics are all expressed in CSS
// pixels and stay crisp at every zoom level.
import { colorFor, inkFor, statusColor, starTint, shapeForType, isTentative } from '../lib/colors.js';
import { boundsOf } from '../lib/layout.js';
import {
  ANCHOR_COUNT,
  MAX_LABELS,
  coreRadiusPx,
  createParticles,
  defaultVisualOptions,
  drawCoreLight,
  drawHalo,
  driftOffset,
  easeToward,
  lerp,
  makeNebulaCache,
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

const MIN_SCALE = 0.08;
const MAX_SCALE = 8;
const LABEL_ALWAYS_MAX = 40; // never label every node beyond this many (§16)
const BASE_RADIUS = 5.6;     // world units for star class 1 (see radiusFor)
const DRIFT_PX = 3;          // ambient excursion, screen pixels
const DIM_NODE = 0.22;       // "outside the focus" — dimmed, never removed
const DIM_EDGE = 0.05;
const SHAPE_MIN_PX = 3;      // below this the shape is unreadable → round dot
const EDGE_ALPHA = 0.12;     // constellation lines on the night ground
const EDGE_ALPHA_LIGHT = 0.16; // paper keeps its original ink
const EDGE_FOCUS_ALPHA = 0.75;
// 2D has no camera, so depth is faked by star class: the small classes sit a
// little further back (lower alpha, cooler tint), the hubs sit in front.
const CLASS_ALPHA = Object.freeze([0.72, 0.86, 0.95, 1]);
const CLASS_COOL = Object.freeze([0.55, 0.3, 0.12, 0]);
const BG_DRIFT_PX = 10;      // how far the sky itself wanders, screen pixels
const BG_DRIFT_PERIOD = 190; // seconds for one lap of that wander
// Paper does not bloom: on the day theme the halo is drawn at its pre-0.3.1
// tightness (~2.6 × the core) so the light view is visually unchanged.
const PAPER_GLOW_SCALE = 0.42;

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

  // --- constellation state ------------------------------------------------
  let opts = defaultVisualOptions();
  let tokens = readCanvasTokens(opts.theme);
  const sprites = makeSpriteCache(300);
  const nebula = makeNebulaCache();
  let quality = 'high';
  let particles = [];
  let particleSize = { width: 0, height: 0, count: -1 };
  let maxDegree = 1;
  let anchors = new Set(); // the few brightest stars: they get the wide bloom
  let clock = 0;       // seconds of ambient time (frozen when animation is off)
  let lastTs = 0;
  let dimMix = 0;      // 0 = nothing dimmed, 1 = focus dimming fully applied
  let paused = false;  // document hidden

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

  function refreshQuality(width, height, dpr) {
    quality = qualityFor(opts, { nodeCount: data.visibleNodes?.size ?? 0, width, height, dpr });
    // The dense sky is a night-theme effect: on paper the old sparse dust is
    // the right amount of texture, so the day theme keeps its original density.
    const count = Math.round(particleCountFor(quality) * (tokens.dark ? 1 : 0.18));
    if (particleSize.count !== count || particleSize.width !== Math.round(width) || particleSize.height !== Math.round(height)) {
      particles = createParticles(count, width, height, 'vault-graph-2d');
      particleSize = { width: Math.round(width), height: Math.round(height), count };
    }
  }

  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    };
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
    // The handful of true hubs: a constellation needs a few fixed points the
    // eye returns to, so they carry an extra very wide, very faint bloom.
    anchors = new Set(
      visibleBodies()
        .slice()
        .sort((a, b) => (b.degree || 0) - (a.degree || 0) || String(a.id).localeCompare(String(b.id)))
        .slice(0, ANCHOR_COUNT)
        .map((b) => b.id)
    );
  }

  function bucketOf(body) {
    return sizeBucket(body.degree || 0, maxDegree);
  }

  // Size by degree, in four star classes: bigger = more connected (§4).
  function radiusOf(body) {
    return radiusFor(bucketOf(body), BASE_RADIUS);
  }

  /** On-screen core radius in CSS pixels: 3 px (leaf) … 8 px (hub) at zoom 1. */
  function screenRadius(body) {
    return Math.min(coreRadiusPx(bucketOf(body), view.scale), 34);
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
    const animate = opts.animation && !paused;
    for (const body of visibleBodies()) {
      const r = radiusOf(body) + 8 / view.scale;
      // Pick against the drifted position actually drawn (drift is applied in screen px).
      const off = driftOffset(body.id, clock, DRIFT_PX, animate);
      const d = Math.hypot(body.x + off.dx / view.scale - world.x, body.y + off.dy / view.scale - world.y);
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

  /** 1 when some focus (selection or emphasis) is narrowing the view. */
  function dimTarget() {
    return emphasis || selection?.kind === 'node' ? 1 : 0;
  }

  function snapDim() {
    if (!opts.animation) dimMix = dimTarget();
  }

  // --- drawing -----------------------------------------------------------

  function draw() {
    const { width, height, dpr } = resizeCanvas();
    refreshQuality(width, height, dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintBackground(ctx, width, height, tokens, {
      particles,
      tSeconds: clock,
      quality,
      animation: opts.animation,
      nebula,
      // 2D has no camera to parallax against, so the sky wanders on its own —
      // one lap in a bit over three minutes, far below the "look at me" threshold.
      parallax: opts.animation
        ? {
            x: Math.cos((clock / BG_DRIFT_PERIOD) * Math.PI * 2) * BG_DRIFT_PX,
            y: Math.sin((clock / BG_DRIFT_PERIOD) * Math.PI * 2) * BG_DRIFT_PX * 0.6,
          }
        : null,
    });
    if (!data.graph || !data.sim) return;

    const animate = opts.animation && !paused;
    const bodies = visibleBodies();
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

    // Screen positions once per frame; ambient drift never touches sim bodies.
    const pos = new Map();
    for (const body of bodies) {
      const still = dragging?.kind === 'node' && dragging.body.id === body.id;
      const d = driftOffset(body.id, clock, DRIFT_PX, animate && !still);
      pos.set(body.id, {
        x: body.x * view.scale + view.tx + d.dx,
        y: body.y * view.scale + view.ty + d.dy,
      });
    }

    const nodeDim = (id) => faded(id) || (Boolean(selectedNodeId) && id !== selectedNodeId && !neighbours.has(id));
    const nodeAlpha = (id) => (nodeDim(id) ? lerp(1, DIM_NODE, dimMix) : 1);

    // --- edges: batched by style, one stroke per bucket -------------------
    ctx.lineCap = 'round';
    const plain = { normal: [], dim: [] };
    const dashed = { normal: new Map(), dim: [] }; // by status: hues differ
    const focused = [];
    let selectedEdge = null;
    const arrows = { normal: [], dim: [], focus: [] };

    for (const edge of data.graph.edges) {
      if (!data.visibleEdges.has(edge.id)) continue;
      const a = pos.get(edge.from);
      const b = pos.get(edge.to);
      if (!a || !b) continue;
      const isSelected = edge.id === selectedEdgeId;
      const touchesSelection = Boolean(
        (selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId)) ||
        (emphasis && emphasis.has(edge.from) && emphasis.has(edge.to)) ||
        (hover && (edge.from === hover || edge.to === hover))
      );
      // A selected node must always show its relations, even with edges off.
      if (!opts.edges && !touchesSelection && !isSelected) continue;
      const dim = faded(edge.from) || faded(edge.to) || (Boolean(selectedNodeId) && !touchesSelection);
      // Candidate / unresolved relations stay visually lighter — never confirmed (§4, §27).
      const tentative = isTentative(edge.status) || edge.sources.length === 0;
      const segment = { a, b, edge, tentative };

      if (isSelected) selectedEdge = segment;
      else if (touchesSelection && !dim) focused.push(segment);
      else if (tentative && dim) dashed.dim.push(segment);
      else if (tentative) {
        const key = String(edge.status ?? '');
        const bucket = dashed.normal.get(key);
        if (bucket) bucket.push(segment);
        else dashed.normal.set(key, [segment]);
      }
      else plain[dim ? 'dim' : 'normal'].push(segment);

      if (view.scale > 0.45 && !tentative) {
        const rb = screenRadius(data.sim.byId.get(edge.to) ?? { degree: 0 });
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const head = {
          x: b.x - Math.cos(angle) * rb,
          y: b.y - Math.sin(angle) * rb,
          angle,
          size: isSelected || touchesSelection ? 8 : 6,
        };
        arrows[isSelected || (touchesSelection && !dim) ? 'focus' : dim ? 'dim' : 'normal'].push(head);
      }
    }

    const strokeBatch = (list, style, widthPx, dash) => {
      if (!list.length) return;
      ctx.beginPath();
      for (const s of list) {
        ctx.moveTo(s.a.x, s.a.y);
        ctx.lineTo(s.b.x, s.b.y);
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = widthPx;
      if (dash) ctx.setLineDash(dash);
      ctx.stroke();
      if (dash) ctx.setLineDash([]);
    };

    const additive = tokens.dark && quality !== 'low';
    if (additive) ctx.globalCompositeOperation = 'lighter';
    // Constellation lines: 1 px, barely there. They tell you the sky is a graph
    // without ever becoming the subject — the stars are.
    const edgeAlpha = tokens.dark ? EDGE_ALPHA : EDGE_ALPHA_LIGHT;
    strokeBatch(plain.normal, tokens.edge(edgeAlpha), tokens.dark ? 1 : 0.8);
    strokeBatch(plain.dim, tokens.edge(lerp(edgeAlpha, DIM_EDGE, dimMix)), tokens.dark ? 1 : 0.8);
    if (additive) ctx.globalCompositeOperation = 'source-over';
    for (const [status, list] of dashed.normal) {
      strokeBatch(list, statusColor(status, { dark: tokens.dark, alpha: tokens.dark ? 0.4 : 0.55 }), 0.9, [5, 4]);
    }
    strokeBatch(dashed.dim, tokens.edge(lerp(edgeAlpha, DIM_EDGE, dimMix)), 0.9, [5, 4]);

    if (focused.length) {
      // A faint wider stroke under the crisp one reads as a luminous filament.
      if (quality === 'high') strokeBatch(focused, tokens.edgeFocusColor(0.18), 3.5);
      const solid = focused.filter((s) => !s.tentative);
      const soft = focused.filter((s) => s.tentative);
      strokeBatch(solid, tokens.edgeFocusColor(EDGE_FOCUS_ALPHA), 1.4);
      strokeBatch(soft, tokens.edgeFocusColor(EDGE_FOCUS_ALPHA * 0.85), 1.2, [5, 4]);
    }
    if (selectedEdge) {
      if (quality === 'high') strokeBatch([selectedEdge], tokens.glowColor(0.18), 5);
      strokeBatch([selectedEdge], tokens.glowColor(0.95), 2.4, selectedEdge.tentative ? [5, 4] : null);
    }

    const fillArrows = (list, style) => {
      if (!list.length) return;
      ctx.beginPath();
      for (const h of list) {
        ctx.moveTo(h.x, h.y);
        ctx.lineTo(h.x - Math.cos(h.angle - 0.4) * h.size, h.y - Math.sin(h.angle - 0.4) * h.size);
        ctx.lineTo(h.x - Math.cos(h.angle + 0.4) * h.size, h.y - Math.sin(h.angle + 0.4) * h.size);
        ctx.closePath();
      }
      ctx.fillStyle = style;
      ctx.fill();
    };
    fillArrows(arrows.normal, tokens.edge(tokens.dark ? 0.22 : 0.4));
    fillArrows(arrows.dim, tokens.edge(lerp(tokens.dark ? 0.22 : 0.4, DIM_EDGE, dimMix)));
    fillArrows(arrows.focus, tokens.edgeFocusColor(EDGE_FOCUS_ALPHA));

    // --- halos: one drawImage per star ------------------------------------
    if (opts.glow !== 'off') {
      if (additive) ctx.globalCompositeOperation = 'lighter';
      for (const body of bodies) {
        const node = data.graph.nodeById.get(body.id);
        const p = pos.get(body.id);
        if (!node || !p) continue;
        if (p.x < -120 || p.y < -120 || p.x > width + 120 || p.y > height + 120) continue;
        const bucket = bucketOf(body);
        const r = screenRadius(body);
        const isSelected = body.id === selectedNodeId;
        const emphasised = isSelected || hover === body.id;
        const tw = quality === 'low' ? 1 : twinkle(body.id, clock, animate);
        const tint = starColor(node, bucket);
        const intensity = nodeAlpha(body.id) * (CLASS_ALPHA[bucket] ?? 1) * tw * (emphasised ? 1.35 : 1);
        // Anchors first (widest, faintest), so the tight bloom lands on top.
        if (anchors.has(body.id) && quality !== 'low' && tokens.dark) {
          drawHalo(ctx, sprites, tint, p.x, p.y, r, 'anchor', intensity, quality);
        }
        drawHalo(ctx, sprites, tint, p.x, p.y, tokens.dark ? r : r * PAPER_GLOW_SCALE, opts.glow, intensity, quality);
        if (isSelected) {
          // The warm accent bloom is the unmistakable "this one" signal.
          drawHalo(ctx, sprites, tokens.glowColor(1), p.x, p.y, r, 'select', 0.95 * tw, quality);
        }
      }
      if (additive) ctx.globalCompositeOperation = 'source-over';
    }

    // --- node cores --------------------------------------------------------
    for (const body of bodies) {
      const node = data.graph.nodeById.get(body.id);
      const p = pos.get(body.id);
      if (!node || !p) continue;
      const bucket = bucketOf(body);
      const r = screenRadius(body);
      const isSelected = body.id === selectedNodeId;
      const isNeighbour = neighbours.has(body.id) && !isSelected;
      const isMatch = data.matches.has(body.id);
      const emphasised = isSelected || hover === body.id || isMatch;
      const alpha = nodeAlpha(body.id) * (tokens.dark ? CLASS_ALPHA[bucket] ?? 1 : 1);
      const shape = shapeForType(node.type);
      // Below ~3 px a square and a circle are the same three pixels: fall back
      // to a dot (the hue still carries the type) unless the node is called out.
      const drawShape = r >= SHAPE_MIN_PX || emphasised;

      ctx.globalAlpha = alpha;
      pathForShape(ctx, drawShape ? shape : 'circle', p.x, p.y, r);
      ctx.fillStyle = starColor(node, bucket);
      ctx.fill();
      if (tokens.dark) {
        // White-hot centre, tinted rim: what makes a filled shape read as a
        // star rather than as a coloured chart marker.
        drawCoreLight(ctx, p.x, p.y, r, emphasised ? 1 : 0.82);
      } else if (r >= 2.4) {
        ctx.strokeStyle = inkFor(node.type);
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }

      // Dashed halo = candidate / unresolved, or no recorded provenance (§4).
      const tentative = isTentative(node.status) || node.sources.length === 0;
      if (tentative) {
        pathForShape(ctx, drawShape ? shape : 'circle', p.x, p.y, r + 4);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = statusColor(node.status, { dark: tokens.dark, alpha: 0.95 });
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;

      // A search match gets one thin warm ring; the selection gets a thick ring
      // plus a wider echo — "found" and "selected" never read the same.
      if (isMatch) {
        pathForShape(ctx, shape, p.x, p.y, r + 6.5);
        ctx.strokeStyle = tokens.glowColor(0.85);
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
      if (isSelected) {
        pathForShape(ctx, shape, p.x, p.y, r + 8.5);
        ctx.strokeStyle = tokens.glowColor(1);
        ctx.lineWidth = 2.6;
        ctx.stroke();
        pathForShape(ctx, shape, p.x, p.y, r + 12.5);
        ctx.strokeStyle = tokens.glowColor(0.35);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (hover === body.id) {
        pathForShape(ctx, shape, p.x, p.y, r + 6);
        ctx.strokeStyle = tokens.edgeFocusColor(0.7);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    // --- labels: per the `labels` option (§16) ------------------------------
    if (opts.labels !== 'off' || selectedNodeId) {
      drawLabels(bodies, pos, { selectedNodeId, neighbours });
    }
  }

  /**
   * Star core colour. Night: the type hue pushed toward a cool white, cooled
   * further for the small classes so size and depth agree. Day: the ink palette,
   * untouched — paper is not a sky.
   */
  function starColor(node, bucket = 3) {
    if (!tokens.dark) return colorFor(node.type, { lightness: 52 });
    return starTint(node.type, { dark: true, cool: CLASS_COOL[bucket] ?? 0 });
  }

  function drawLabels(bodies, pos, { selectedNodeId, neighbours }) {
    const mode = opts.labels;
    const zoomBudget = Math.round(Math.min(220, Math.max(0, (view.scale - 0.5) * 90)));
    const topN = bodies.length <= LABEL_ALWAYS_MAX ? bodies.length : zoomBudget;

    ctx.font = '12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const candidates = [];
    for (const body of bodies) {
      const node = data.graph.nodeById.get(body.id);
      const p = pos.get(body.id);
      if (!node || !p) continue;
      const important =
        body.id === selectedNodeId ||
        data.matches.has(body.id) ||
        neighbours.has(body.id) ||
        hover === body.id ||
        (emphasis ? emphasis.has(body.id) : false);

      let show;
      if (mode === 'off') show = body.id === selectedNodeId;
      else if (mode === 'hover') show = important;
      else if (mode === 'all') show = true;
      else {
        // 'auto': the existing degree/zoom budget, plus anything called out.
        const ranked = (labelRank.get(body.id) ?? Infinity) < topN;
        show = important || (ranked && !faded(body.id) && !selectedNodeId);
      }
      if (!show) continue;
      if (mode !== 'off' && !important && faded(body.id)) continue;
      candidates.push({ body, node, p, important, rank: labelRank.get(body.id) ?? Infinity });
    }
    // Important labels first, then by rank, so collisions are resolved in favour of meaning.
    const tier = (c) => (c.body.id === selectedNodeId ? 0 : hover === c.body.id ? 1 : c.important ? 2 : 3);
    candidates.sort((a, b) => tier(a) - tier(b) || a.rank - b.rank);

    const placer = makeLabelPlacer(3);
    let drawn = 0;
    for (const { body, node, p, important } of candidates) {
      if (drawn >= MAX_LABELS) break;
      const text = node.label.length > 34 ? `${node.label.slice(0, 33)}…` : node.label;
      const y = p.y + screenRadius(body) + 4;
      const w = ctx.measureText(text).width;
      // Skip a label that would overlap an already placed one (important labels always win).
      // Only the selected / hovered label is forced; matches and focus labels still avoid overlap.
      const forced = body.id === selectedNodeId || hover === body.id;
      if (!placer.tryPlace(p.x - w / 2, y, w, 14, forced)) continue;
      ctx.globalAlpha = important ? 1 : lerp(1, 0.45, dimMix * (faded(body.id) ? 1 : 0));
      ctx.lineWidth = 3;
      ctx.strokeStyle = tokens.halo;
      ctx.strokeText(text, p.x, y);
      ctx.fillStyle = important ? tokens.label : tokens.labelSoft;
      ctx.fillText(text, p.x, y);
      ctx.globalAlpha = 1;
      drawn += 1;
    }
  }

  // --- animation loop -----------------------------------------------------

  function settling() {
    return Boolean(data.sim && data.sim.alpha > data.sim.options.alphaMin);
  }

  function keepAnimating() {
    if (paused) return false;
    if (opts.animation) return true;
    return settling() || Boolean(dragging) || dimMix !== dimTarget();
  }

  function frame(ts) {
    if (!running) return;
    const now = (typeof ts === 'number' ? ts : 0) / 1000;
    const dt = lastTs ? Math.min(Math.max(now - lastTs, 0), 0.1) : 1 / 60;
    lastTs = now;
    if (opts.animation && !paused) clock += dt;
    if (settling()) data.sim.tick(1);
    dimMix = opts.animation ? easeToward(dimMix, dimTarget(), dt, 250) : dimTarget();
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
    snapDim();
    if (keepAnimating()) start();
    else draw();
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
    invalidate();
  }

  function focusNode(id, { zoom = null } = {}) {
    const body = data.sim?.byId.get(id);
    if (!body) return;
    const { width, height } = cssSize();
    if (zoom) view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, zoom));
    view.tx = width / 2 - body.x * view.scale;
    view.ty = height / 2 - body.y * view.scale;
    invalidate();
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
    invalidate();
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
        invalidate();
      }
      return;
    }
    pointerMoved = true;
    if (dragging.kind === 'view') {
      view.tx = dragging.tx + (event.clientX - dragging.startX);
      view.ty = dragging.ty + (event.clientY - dragging.startY);
      invalidate();
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
    if (moved) {
      invalidate();
      return;
    }
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

  const onResize = () => invalidate();
  globalThis.addEventListener('resize', onResize);

  // Ambient motion never runs in a hidden tab (§ battery, prefers-reduced-motion).
  const onVisibility = () => {
    const doc = globalThis.document;
    paused = doc ? doc.visibilityState === 'hidden' : false;
    if (paused) stop();
    else invalidate();
  };
  globalThis.document?.addEventListener?.('visibilitychange', onVisibility);

  return {
    view,
    setData(next) {
      data = { ...data, ...next };
      computeMaxDegree();
      computeLabelRank();
      invalidate();
    },
    setSelection(next) {
      selection = next;
      invalidate();
    },
    setMatches(matches) {
      data.matches = matches ?? new Set();
      invalidate();
    },
    setVisible(visibleNodes, visibleEdges) {
      data.visibleNodes = visibleNodes;
      data.visibleEdges = visibleEdges;
      computeMaxDegree();
      computeLabelRank();
      invalidate();
    },
    /** Emphasise a subset; everything else is drawn faded (Focus, §13). */
    setEmphasis(idSet) {
      emphasis = idSet && idSet.size ? idSet : null;
      invalidate();
    },
    getEmphasis() {
      return emphasis;
    },
    /** Re-read the CSS palette after a theme change (§18). */
    setTheme() {
      palette = readPalette();
      opts = mergeVisualOptions(opts, { theme: palette.dark ? 'dark' : 'light' });
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
      if (!opts.animation) dimMix = dimTarget();
      if (!opts.animation && running && !settling()) stop();
      invalidate();
      return opts;
    },
    getVisualOptions() {
      return { ...opts };
    },
    recenter,
    focusNode,
    zoomBy,
    fitAll() {
      fitTo(visibleBodies());
      invalidate();
    },
    /** Back to a neutral camera: fit everything, drop emphasis and hover (§15). */
    resetView() {
      emphasis = null;
      hover = null;
      fitTo(visibleBodies());
      invalidate();
    },
    resize() {
      resizeCanvas();
      particleSize = { width: 0, height: 0, count: -1 };
      invalidate();
    },
    draw,
    start,
    stop,
    destroy() {
      stop();
      globalThis.removeEventListener('resize', onResize);
      globalThis.document?.removeEventListener?.('visibilitychange', onVisibility);
      sprites.clear();
    },
  };
}
