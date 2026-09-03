// Graph model: normalisation, adjacency, degree, dynamic filter discovery,
// filtering and search. Pure functions — no DOM, no network.
//
// The vocabularies of `type`, `context`, `status` and `relation` are NEVER
// hardcoded here: they are discovered from the data (CDC §9, §23).

export const UNSET = '(unset)';

function str(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeSources(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const file = str(s.file);
    if (!file) continue;
    out.push({
      file,
      heading: str(s.heading),
      line_start: Number.isFinite(s.line_start) ? s.line_start : null,
      line_end: Number.isFinite(s.line_end) ? s.line_end : null,
    });
  }
  return out;
}

function normalizeAliases(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((a) => str(a)).filter(Boolean);
}

/** True when the item carries at least one usable source reference. */
export function hasSources(item) {
  return Array.isArray(item?.sources) && item.sources.length > 0;
}

export function normalizeNode(record) {
  const id = str(record?.id);
  if (!id) return null;
  return {
    id,
    type: str(record.type) ?? UNSET,
    label: str(record.label) ?? id,
    context: str(record.context) ?? UNSET,
    status: str(record.status) ?? UNSET,
    reason: str(record.reason),
    aliases: normalizeAliases(record.aliases),
    sources: normalizeSources(record.sources),
    raw: record,
  };
}

export function normalizeEdge(record, index) {
  const from = str(record?.from);
  const to = str(record?.to);
  if (!from || !to) return null;
  return {
    id: str(record.id) ?? `edge:${index}:${from}->${to}`,
    from,
    to,
    relation: str(record.relation) ?? UNSET,
    status: str(record.status) ?? UNSET,
    sources: normalizeSources(record.sources),
    raw: record,
  };
}

/**
 * Build the in-memory graph.
 * Duplicate node ids keep the first occurrence and are reported.
 * Edges pointing at unknown nodes are dropped from the graph and reported;
 * they are never silently rendered (CDC §12/§15: no invented knowledge).
 * @returns {{nodes:object[], edges:object[], nodeById:Map, adjacency:Map, degree:Map, issues:string[]}}
 */
export function buildGraph(nodeRecords = [], edgeRecords = []) {
  const issues = [];
  const nodes = [];
  const nodeById = new Map();

  for (const record of nodeRecords) {
    const node = normalizeNode(record);
    if (!node) {
      issues.push('A node record was skipped: missing "id".');
      continue;
    }
    if (nodeById.has(node.id)) {
      issues.push(`Duplicate node id "${node.id}" — the first occurrence is kept.`);
      continue;
    }
    nodeById.set(node.id, node);
    nodes.push(node);
  }

  const edges = [];
  const edgeById = new Map();
  const adjacency = new Map();
  for (const node of nodes) adjacency.set(node.id, { in: [], out: [] });

  edgeRecords.forEach((record, index) => {
    const edge = normalizeEdge(record, index);
    if (!edge) {
      issues.push('An edge record was skipped: missing "from" or "to".');
      return;
    }
    if (edgeById.has(edge.id)) {
      issues.push(`Duplicate edge id "${edge.id}" — the first occurrence is kept.`);
      return;
    }
    const missing = [];
    if (!nodeById.has(edge.from)) missing.push(edge.from);
    if (!nodeById.has(edge.to)) missing.push(edge.to);
    if (missing.length) {
      issues.push(`Edge "${edge.id}" references unknown node(s): ${missing.join(', ')}.`);
      return;
    }
    edgeById.set(edge.id, edge);
    edges.push(edge);
    adjacency.get(edge.from).out.push(edge.id);
    adjacency.get(edge.to).in.push(edge.id);
  });

  const degree = new Map();
  for (const node of nodes) {
    const a = adjacency.get(node.id);
    degree.set(node.id, a.in.length + a.out.length);
  }

  return { nodes, edges, nodeById, edgeById, adjacency, degree, issues };
}

function tally(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function toSortedList(map) {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value));
}

export const PROVENANCE_WITH = 'with-sources';
export const PROVENANCE_WITHOUT = 'no-sources';

/**
 * Discover filter facets and their counts from the nodes themselves.
 * @returns {{type:{value,count}[], context:..., status:..., provenance:...}}
 */
export function discoverFilterValues(nodes = []) {
  const type = new Map();
  const context = new Map();
  const status = new Map();
  let withSources = 0;
  let withoutSources = 0;

  for (const node of nodes) {
    tally(type, node.type ?? UNSET);
    tally(context, node.context ?? UNSET);
    tally(status, node.status ?? UNSET);
    if (hasSources(node)) withSources += 1;
    else withoutSources += 1;
  }

  const provenance = [];
  if (withSources) provenance.push({ value: PROVENANCE_WITH, count: withSources });
  if (withoutSources) provenance.push({ value: PROVENANCE_WITHOUT, count: withoutSources });

  return {
    type: toSortedList(type),
    context: toSortedList(context),
    status: toSortedList(status),
    provenance,
  };
}

/** Discover relation and status vocabularies used by edges. */
export function discoverEdgeValues(edges = []) {
  const relation = new Map();
  const status = new Map();
  for (const edge of edges) {
    tally(relation, edge.relation ?? UNSET);
    tally(status, edge.status ?? UNSET);
  }
  return { relation: toSortedList(relation), status: toSortedList(status) };
}

function facetAllows(selected, value) {
  // An empty selection means "no restriction on this facet".
  if (!selected || selected.size === 0) return true;
  return selected.has(value);
}

/**
 * Apply the active filters.
 * A filter facet is a Set of accepted values; an empty/absent Set accepts all.
 * An edge is visible only when both endpoints are visible (CDC §23).
 * @returns {{visibleNodeIds:Set<string>, visibleEdgeIds:Set<string>}}
 */
export function applyFilters(graph, filters = {}) {
  const visibleNodeIds = new Set();
  for (const node of graph.nodes) {
    if (!facetAllows(filters.type, node.type)) continue;
    if (!facetAllows(filters.context, node.context)) continue;
    if (!facetAllows(filters.status, node.status)) continue;
    const prov = hasSources(node) ? PROVENANCE_WITH : PROVENANCE_WITHOUT;
    if (!facetAllows(filters.provenance, prov)) continue;
    visibleNodeIds.add(node.id);
  }

  const visibleEdgeIds = new Set();
  for (const edge of graph.edges) {
    if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) continue;
    if (!facetAllows(filters.relation, edge.relation)) continue;
    if (!facetAllows(filters.edgeStatus, edge.status)) continue;
    visibleEdgeIds.add(edge.id);
  }
  return { visibleNodeIds, visibleEdgeIds };
}

/** Case-insensitive search over label, aliases and id. */
export function searchNodes(nodes = [], query) {
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!q) return [];
  const out = [];
  for (const node of nodes) {
    const haystacks = [node.label, node.id, ...(node.aliases ?? [])];
    if (haystacks.some((h) => typeof h === 'string' && h.toLowerCase().includes(q))) {
      out.push(node.id);
    }
  }
  return out;
}

/** Nodes sharing a label but distinguished by context (CDC §13 homonyms). */
export function findHomonyms(nodes = []) {
  const byLabel = new Map();
  for (const node of nodes) {
    const key = node.label.toLowerCase();
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key).push(node);
  }
  return [...byLabel.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([label, group]) => ({ label, nodes: group }));
}

/** Edges incident to a node, resolved to edge objects. */
export function incidentEdges(graph, nodeId) {
  const a = graph.adjacency.get(nodeId);
  if (!a) return { incoming: [], outgoing: [] };
  const resolve = (ids) => ids.map((id) => graph.edgeById.get(id)).filter(Boolean);
  return { incoming: resolve(a.in), outgoing: resolve(a.out) };
}
