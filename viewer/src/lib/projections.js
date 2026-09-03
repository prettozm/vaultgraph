// Semantic Z projections for the 3D view (v0.2 §2-3).
//
// X/Y always come from the 2D force layout; only Z changes. Each projection
// answers one question about the vault, so Z carries meaning rather than
// decoration. Nothing here touches the DOM and nothing invents data: a node
// without a date is `undated`, a node without sources lands in `no sources`.
//
// Vocabularies (context, type, status, source files) are discovered from the
// graph, never hardcoded — the only ordered lists below are *preferences*
// applied on top of whatever the data actually contains.

export const PROJECTION_IDS = ['context', 'time', 'provenance', 'knowledge', 'epistemic'];

/** Relations that carry a "from = earlier, to = later" reading. */
export const TEMPORAL_RELATIONS = ['precede', 'raffine', 'supersede', 'derive_de'];

export const UNSET = '(unset)';
export const UNDATED_KEY = 'undated';
export const NO_SOURCES_KEY = 'no sources';

const PROJECTION_LABELS = {
  context: 'Context',
  time: 'Time',
  provenance: 'Provenance',
  knowledge: 'Knowledge',
  epistemic: 'Epistemic',
};

/** Preferred epistemic order; any other discovered status follows, A→Z. */
const STATUS_ORDER = ['confirmed', 'explicit', 'candidate', 'unresolved', 'rejected'];

/** Substance types for the knowledge projection (matched by name, not by id). */
const SUBSTANCE_TYPES = new Set(['besoin', 'cas_usage', 'fonctionnalite', 'decision', 'hypothese']);

// --- small helpers -------------------------------------------------------

/** Lowercase, strip accents, fold separators — so `Cas d'usage` ≈ `cas_usage`. */
function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function nodesOf(graph) {
  return Array.isArray(graph?.nodes) ? graph.nodes : [];
}

function edgesOf(graph) {
  return Array.isArray(graph?.edges) ? graph.edges : [];
}

function hasSources(node) {
  return Array.isArray(node?.sources) && node.sources.length > 0;
}

/** Read a possibly-nested field: normalised graphs keep extras under `raw`. */
function field(node, name) {
  if (node && node[name] != null) return node[name];
  if (node && node.raw && node.raw[name] != null) return node.raw[name];
  return null;
}

// --- dates ---------------------------------------------------------------

function parseIsoish(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  let m = /^(\d{4})$/.exec(s);
  if (m) return new Date(Date.UTC(Number(m[1]), 0, 1));
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    return new Date(Date.UTC(Number(m[1]), month - 1, 1));
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The node's own date, if it declares one. Never guessed, never derived from
 * neighbours: `date`, then `created_at`, then `valid_from`.
 * @returns {Date|null}
 */
export function nodeDate(node) {
  for (const name of ['date', 'created_at', 'valid_from']) {
    const parsed = parseIsoish(field(node, name));
    if (parsed) return parsed;
  }
  return null;
}

// --- temporal ranks ------------------------------------------------------

function temporalEdges(graph) {
  const wanted = new Set(TEMPORAL_RELATIONS.map(normalizeName));
  const ids = new Set(nodesOf(graph).map((n) => n.id));
  const out = [];
  for (const edge of edgesOf(graph)) {
    if (!wanted.has(normalizeName(edge.relation))) continue;
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    if (edge.from === edge.to) continue;
    out.push(edge);
  }
  return out;
}

/**
 * Longest-path rank along TEMPORAL_RELATIONS (from → to = earlier → later).
 * Cycles are broken deterministically: a DFS in sorted id order drops the
 * back-edges it meets, so the same graph always yields the same ranks.
 * Nodes touched by no temporal edge are absent from the map.
 * @returns {Map<string, number>}
 */
export function temporalRank(graph) {
  const edges = temporalEdges(graph);
  const rank = new Map();
  if (!edges.length) return rank;

  const out = new Map();
  const involved = new Set();
  for (const e of edges) {
    involved.add(e.from);
    involved.add(e.to);
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e.to);
  }
  for (const list of out.values()) list.sort((a, b) => a.localeCompare(b));

  // 1. Drop back-edges (targets currently on the DFS stack) — iterative DFS.
  const state = new Map(); // 0 = unseen, 1 = on stack, 2 = done
  const kept = new Map();
  const roots = [...involved].sort((a, b) => a.localeCompare(b));
  for (const root of roots) {
    if (state.get(root)) continue;
    const stack = [{ id: root, i: 0 }];
    state.set(root, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const children = out.get(frame.id) ?? [];
      if (frame.i >= children.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const child = children[frame.i];
      frame.i += 1;
      if (state.get(child) === 1) continue; // back-edge → ignored
      if (!kept.has(frame.id)) kept.set(frame.id, []);
      kept.get(frame.id).push(child);
      if (!state.get(child)) {
        state.set(child, 1);
        stack.push({ id: child, i: 0 });
      }
    }
  }

  // 2. Longest-path rank over the remaining DAG (Kahn, deterministic order).
  const indegree = new Map();
  for (const id of involved) indegree.set(id, 0);
  for (const [, children] of kept) {
    for (const child of children) indegree.set(child, (indegree.get(child) ?? 0) + 1);
  }
  for (const id of involved) rank.set(id, 0);
  const queue = [...involved].filter((id) => indegree.get(id) === 0).sort((a, b) => a.localeCompare(b));
  let head = 0;
  while (head < queue.length) {
    const id = queue[head];
    head += 1;
    for (const child of kept.get(id) ?? []) {
      rank.set(child, Math.max(rank.get(child) ?? 0, (rank.get(id) ?? 0) + 1));
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }
  return rank;
}

// --- availability --------------------------------------------------------

function availability(graph) {
  const nodes = nodesOf(graph);
  const dated = nodes.some((n) => nodeDate(n) !== null);
  const temporal = temporalEdges(graph).length > 0;
  const sourced = nodes.some(hasSources);
  const contexts = nodes.length > 0;
  return {
    context: contexts
      ? { available: true }
      : { available: false, reason: 'No nodes in this graph.' },
    time:
      dated || temporal
        ? { available: true }
        : { available: false, reason: 'No temporal metadata in this graph.' },
    provenance: sourced
      ? { available: true }
      : { available: false, reason: 'No node carries a source in this graph.' },
    knowledge: nodes.length
      ? { available: true }
      : { available: false, reason: 'No nodes in this graph.' },
    epistemic: nodes.length
      ? { available: true }
      : { available: false, reason: 'No nodes in this graph.' },
  };
}

/**
 * Which projections this particular graph can express.
 * @returns {{id:string,label:string,available:boolean,reason?:string}[]}
 */
export function listProjections(graph) {
  const state = availability(graph);
  return PROJECTION_IDS.map((id) => {
    const entry = state[id];
    const out = { id, label: PROJECTION_LABELS[id], available: entry.available };
    if (!entry.available) out.reason = entry.reason;
    return out;
  });
}

// --- layer assembly ------------------------------------------------------

/**
 * Turn an ordered list of layer keys plus a node→key assignment into the
 * projection result. Layers are evenly spaced across [-1, 1]; a lone layer
 * sits at 0.
 */
function assemble(id, orderedKeys, labelOf, assignment, colorBy, extra = {}) {
  const counts = new Map();
  for (const key of orderedKeys) counts.set(key, 0);
  for (const key of assignment.values()) counts.set(key, (counts.get(key) ?? 0) + 1);

  const keys = orderedKeys.filter((key) => counts.get(key) > 0);
  const n = keys.length;
  const layers = keys.map((key, i) => ({
    key,
    label: labelOf(key),
    z: n <= 1 ? 0 : -1 + (2 * i) / (n - 1),
    count: counts.get(key),
  }));
  const zByKey = new Map(layers.map((l) => [l.key, l.z]));
  const z = new Map();
  for (const [nodeId, key] of assignment) z.set(nodeId, zByKey.get(key) ?? 0);

  return { id, available: true, layers, z, encoding: { colorBy }, ...extra };
}

function unavailable(id, reason) {
  return { id, available: false, reason, layers: [], z: new Map(), encoding: { colorBy: 'type' } };
}

// --- individual projections ---------------------------------------------

function contextProjection(graph) {
  const assignment = new Map();
  const keys = new Set();
  for (const node of nodesOf(graph)) {
    const key = typeof node.context === 'string' && node.context.trim() ? node.context.trim() : UNSET;
    assignment.set(node.id, key);
    keys.add(key);
  }
  const ordered = [...keys].sort((a, b) => a.localeCompare(b));
  return assemble('context', ordered, (k) => k, assignment, 'type');
}

function yearKey(date) {
  return String(date.getUTCFullYear()).padStart(4, '0');
}

function monthKey(date) {
  return `${yearKey(date)}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function timeProjection(graph) {
  const nodes = nodesOf(graph);
  const dates = new Map();
  for (const node of nodes) {
    const d = nodeDate(node);
    if (d) dates.set(node.id, d);
  }

  if (dates.size > 0) {
    const years = new Set([...dates.values()].map(yearKey));
    const months = new Set([...dates.values()].map(monthKey));
    // Pick the granularity that yields a readable 2–8 buckets.
    let granularity = 'year';
    if (years.size >= 2 && years.size <= 8) granularity = 'year';
    else if (months.size >= 2 && months.size <= 8) granularity = 'month';
    else if (years.size === 1 && months.size >= 2) granularity = 'month';
    const keyOf = granularity === 'year' ? yearKey : monthKey;

    const assignment = new Map();
    const bucketKeys = new Set();
    for (const node of nodes) {
      const d = dates.get(node.id);
      if (d) {
        const key = keyOf(d);
        bucketKeys.add(key);
        assignment.set(node.id, key);
      } else {
        assignment.set(node.id, UNDATED_KEY);
      }
    }
    const ordered = [UNDATED_KEY, ...[...bucketKeys].sort((a, b) => a.localeCompare(b))];
    return assemble('time', ordered, (k) => k, assignment, 'type', {
      ordinal: false,
      granularity,
    });
  }

  const rank = temporalRank(graph);
  if (rank.size === 0) return unavailable('time', 'No temporal metadata in this graph.');

  const maxRank = Math.max(...rank.values());
  const assignment = new Map();
  const used = new Set();
  for (const node of nodes) {
    if (rank.has(node.id)) {
      const key = `step-${rank.get(node.id) + 1}`;
      used.add(key);
      assignment.set(node.id, key);
    } else {
      assignment.set(node.id, UNDATED_KEY);
    }
  }
  const ordered = [UNDATED_KEY];
  for (let i = 0; i <= maxRank; i += 1) ordered.push(`step-${i + 1}`);
  return assemble(
    'time',
    ordered.filter((k) => k === UNDATED_KEY || used.has(k)),
    (k) => (k === UNDATED_KEY ? UNDATED_KEY : `step ${k.slice('step-'.length)}`),
    assignment,
    'type',
    { ordinal: true }
  );
}

function sourceLabel(file) {
  const parts = String(file).split('/');
  const base = parts.pop();
  const dir = parts.join('/');
  return dir ? `${base} · ${dir}` : base;
}

function provenanceProjection(graph) {
  const nodes = nodesOf(graph);
  if (!nodes.some(hasSources)) {
    return unavailable('provenance', 'No node carries a source in this graph.');
  }
  const assignment = new Map();
  const files = new Set();
  for (const node of nodes) {
    const file = hasSources(node) ? node.sources[0]?.file : null;
    if (file) {
      files.add(file);
      assignment.set(node.id, file);
    } else {
      assignment.set(node.id, NO_SOURCES_KEY);
    }
  }
  const ordered = [NO_SOURCES_KEY, ...[...files].sort((a, b) => a.localeCompare(b))];
  return assemble(
    'provenance',
    ordered,
    (k) => (k === NO_SOURCES_KEY ? NO_SOURCES_KEY : sourceLabel(k)),
    assignment,
    'type'
  );
}

/** Classify a discovered type name into one of the three knowledge planes. */
export function knowledgePlane(typeName) {
  const raw = String(typeName ?? '');
  if (/^concept/i.test(raw.trim())) return 'aboutness';
  const norm = normalizeName(raw);
  if (SUBSTANCE_TYPES.has(norm)) return 'substance';
  for (const name of SUBSTANCE_TYPES) {
    if (norm.startsWith(`${name}_`)) return 'substance';
  }
  return 'other';
}

const KNOWLEDGE_ORDER = ['aboutness', 'substance', 'other'];
const KNOWLEDGE_LABELS = {
  aboutness: 'aboutness',
  substance: 'substance',
  other: 'other',
};

function knowledgeProjection(graph) {
  const nodes = nodesOf(graph);
  if (!nodes.length) return unavailable('knowledge', 'No nodes in this graph.');
  const assignment = new Map();
  for (const node of nodes) assignment.set(node.id, knowledgePlane(node.type));
  return assemble('knowledge', KNOWLEDGE_ORDER, (k) => KNOWLEDGE_LABELS[k], assignment, 'type');
}

function epistemicProjection(graph) {
  const nodes = nodesOf(graph);
  if (!nodes.length) return unavailable('epistemic', 'No nodes in this graph.');
  const assignment = new Map();
  const found = new Set();
  for (const node of nodes) {
    const key =
      typeof node.status === 'string' && node.status.trim() ? node.status.trim() : UNSET;
    found.add(key);
    assignment.set(node.id, key);
  }
  const preferred = STATUS_ORDER.filter((s) => found.has(s));
  const rest = [...found]
    .filter((s) => !STATUS_ORDER.includes(s))
    .sort((a, b) => a.localeCompare(b));
  return assemble('epistemic', [...preferred, ...rest], (k) => k, assignment, 'status');
}

/**
 * Compute one projection.
 * @returns {{id:string, available:boolean, reason?:string,
 *            layers:{key:string,label:string,z:number,count:number}[],
 *            z:Map<string,number>, encoding:{colorBy:'type'|'status'}}}
 */
export function computeProjection(graph, id) {
  switch (id) {
    case 'context':
      return nodesOf(graph).length
        ? contextProjection(graph)
        : unavailable('context', 'No nodes in this graph.');
    case 'time':
      return timeProjection(graph);
    case 'provenance':
      return provenanceProjection(graph);
    case 'knowledge':
      return knowledgeProjection(graph);
    case 'epistemic':
      return epistemicProjection(graph);
    default:
      return unavailable(String(id), `Unknown projection "${id}".`);
  }
}
