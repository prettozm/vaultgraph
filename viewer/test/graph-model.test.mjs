import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGraph,
  discoverFilterValues,
  discoverEdgeValues,
  applyFilters,
  searchNodes,
  findHomonyms,
  incidentEdges,
  hasSources,
  UNSET,
  PROVENANCE_WITH,
  PROVENANCE_WITHOUT,
} from '../src/lib/graph-model.js';

const NODES = [
  { id: 'a', type: 'concept', label: 'alpha', context: 'core', status: 'explicit', sources: [{ file: 'a.md', line_start: 1, line_end: 2 }] },
  { id: 'b', type: 'besoin', label: 'beta', context: 'core', status: 'candidate', sources: [] },
  { id: 'c', type: 'concept', label: 'résistance', context: 'electronique', status: 'explicit', aliases: ['resistance'], sources: [{ file: 'c.md' }] },
  { id: 'd', type: 'concept', label: 'résistance', context: 'finance', status: 'candidate', sources: [{ file: 'd.md' }] },
  { id: 'e', type: 'decision', label: 'orphan', context: 'archi', status: 'unresolved', reason: 'no justified relation found', sources: [{ file: 'e.md' }] },
];

const EDGES = [
  { id: 'e1', from: 'a', to: 'b', relation: 'fonde', status: 'explicit', sources: [{ file: 'a.md' }] },
  { id: 'e2', from: 'c', to: 'd', relation: 'related_to', status: 'candidate', sources: [] },
];

test('buildGraph indexes nodes, edges, adjacency and degree', () => {
  const g = buildGraph(NODES, EDGES);
  assert.equal(g.nodes.length, 5);
  assert.equal(g.edges.length, 2);
  assert.equal(g.nodeById.get('a').label, 'alpha');
  assert.deepEqual(g.adjacency.get('a'), { in: [], out: ['e1'] });
  assert.deepEqual(g.adjacency.get('b'), { in: ['e1'], out: [] });
  assert.equal(g.degree.get('a'), 1);
  assert.equal(g.degree.get('e'), 0, 'the orphan has degree 0');
  assert.deepEqual(g.issues, []);
});

test('missing fields are normalised without inventing data', () => {
  const g = buildGraph([{ id: 'x' }], []);
  const x = g.nodeById.get('x');
  assert.equal(x.label, 'x', 'the id stands in for a missing label');
  assert.equal(x.type, UNSET);
  assert.equal(x.context, UNSET);
  assert.equal(x.status, UNSET);
  assert.deepEqual(x.sources, []);
  assert.equal(x.reason, null);
});

test('an edge pointing at an unknown node is dropped and reported', () => {
  const g = buildGraph(NODES, [...EDGES, { id: 'ghost', from: 'a', to: 'nowhere', relation: 'x' }]);
  assert.equal(g.edges.length, 2);
  assert.equal(g.issues.length, 1);
  assert.match(g.issues[0], /unknown node/);
  assert.match(g.issues[0], /nowhere/);
});

test('duplicate ids keep the first occurrence and are reported', () => {
  const g = buildGraph([...NODES, { id: 'a', label: 'other alpha' }], EDGES);
  assert.equal(g.nodes.length, 5);
  assert.equal(g.nodeById.get('a').label, 'alpha');
  assert.match(g.issues.join(' '), /Duplicate node id "a"/);
});

test('records without an id (nodes) or endpoints (edges) are skipped', () => {
  const g = buildGraph([{ label: 'no id' }], [{ id: 'e', from: 'a' }]);
  assert.equal(g.nodes.length, 0);
  assert.equal(g.edges.length, 0);
  assert.equal(g.issues.length, 2);
});

test('filter values are discovered from the data, with counts', () => {
  const g = buildGraph(NODES, EDGES);
  const facets = discoverFilterValues(g.nodes);
  assert.deepEqual(facets.type.map((t) => [t.value, t.count]), [
    ['concept', 3],
    ['besoin', 1],
    ['decision', 1],
  ]);
  assert.deepEqual(new Set(facets.context.map((c) => c.value)), new Set(['core', 'electronique', 'finance', 'archi']));
  assert.deepEqual(facets.status.map((s) => [s.value, s.count]).sort(), [
    ['candidate', 2],
    ['explicit', 2],
    ['unresolved', 1],
  ].sort());
  assert.deepEqual(facets.provenance, [
    { value: PROVENANCE_WITH, count: 4 },
    { value: PROVENANCE_WITHOUT, count: 1 },
  ]);
});

test('edge vocabularies are discovered too', () => {
  const g = buildGraph(NODES, EDGES);
  const { relation, status } = discoverEdgeValues(g.edges);
  assert.deepEqual(new Set(relation.map((r) => r.value)), new Set(['fonde', 'related_to']));
  assert.deepEqual(new Set(status.map((s) => s.value)), new Set(['explicit', 'candidate']));
});

test('an empty facet selection means "everything"', () => {
  const g = buildGraph(NODES, EDGES);
  const { visibleNodeIds, visibleEdgeIds } = applyFilters(g, {});
  assert.equal(visibleNodeIds.size, 5);
  assert.equal(visibleEdgeIds.size, 2);
});

test('filtering a node hides every edge that touches it', () => {
  const g = buildGraph(NODES, EDGES);
  const { visibleNodeIds, visibleEdgeIds } = applyFilters(g, { type: new Set(['concept']) });
  assert.deepEqual([...visibleNodeIds].sort(), ['a', 'c', 'd']);
  assert.deepEqual([...visibleEdgeIds], ['e2'], 'e1 is hidden because "b" is filtered out');
});

test('facets combine as an intersection', () => {
  const g = buildGraph(NODES, EDGES);
  const { visibleNodeIds } = applyFilters(g, {
    type: new Set(['concept']),
    context: new Set(['finance']),
  });
  assert.deepEqual([...visibleNodeIds], ['d']);
});

test('provenance filtering isolates items with no source', () => {
  const g = buildGraph(NODES, EDGES);
  const { visibleNodeIds } = applyFilters(g, { provenance: new Set([PROVENANCE_WITHOUT]) });
  assert.deepEqual([...visibleNodeIds], ['b']);
  assert.equal(hasSources(g.nodeById.get('b')), false);
  assert.equal(hasSources(g.nodeById.get('a')), true);
});

test('search covers labels, aliases and ids, case-insensitively', () => {
  const g = buildGraph(NODES, EDGES);
  assert.deepEqual(searchNodes(g.nodes, 'ALPHA'), ['a']);
  assert.deepEqual(searchNodes(g.nodes, 'résist'), ['c', 'd']);
  assert.deepEqual(searchNodes(g.nodes, 'resistance'), ['c'], 'matched through the alias');
  assert.deepEqual(searchNodes(g.nodes, ''), []);
  assert.deepEqual(searchNodes(g.nodes, '   '), []);
});

test('homonyms in different contexts coexist and are detectable (CDC §13)', () => {
  const g = buildGraph(NODES, EDGES);
  const homonyms = findHomonyms(g.nodes);
  assert.equal(homonyms.length, 1);
  assert.equal(homonyms[0].nodes.length, 2);
  assert.deepEqual(homonyms[0].nodes.map((n) => n.context).sort(), ['electronique', 'finance']);
});

test('incidentEdges resolves both directions', () => {
  const g = buildGraph(NODES, EDGES);
  assert.deepEqual(incidentEdges(g, 'a').outgoing.map((e) => e.id), ['e1']);
  assert.deepEqual(incidentEdges(g, 'a').incoming, []);
  assert.deepEqual(incidentEdges(g, 'b').incoming.map((e) => e.id), ['e1']);
  assert.deepEqual(incidentEdges(g, 'unknown'), { incoming: [], outgoing: [] });
});

test('relations can be filtered by their own epistemic status (candidates reachable, CDC §41)', () => {
  const g = buildGraph(NODES, EDGES);
  const facets = discoverEdgeValues(g.edges);
  assert.deepEqual(facets.status.map((s) => s.value).sort(), ['candidate', 'explicit']);
  const { visibleNodeIds, visibleEdgeIds } = applyFilters(g, { edgeStatus: new Set(['candidate']) });
  assert.equal(visibleNodeIds.size, NODES.length, 'edge-status filtering never hides nodes');
  assert.deepEqual([...visibleEdgeIds], ['e2']);
});
