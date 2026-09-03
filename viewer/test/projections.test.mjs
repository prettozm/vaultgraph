import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROJECTION_IDS,
  TEMPORAL_RELATIONS,
  computeProjection,
  knowledgePlane,
  listProjections,
  nodeDate,
  temporalRank,
} from '../src/lib/projections.js';

function node(id, extra = {}) {
  return {
    id,
    type: extra.type ?? 'concept',
    label: extra.label ?? id,
    context: extra.context ?? '(unset)',
    status: extra.status ?? '(unset)',
    sources: extra.sources ?? [],
    ...extra,
  };
}

function graphOf(nodes, edges = []) {
  return {
    nodes,
    edges: edges.map((e, i) => ({ id: `e${i}`, status: 'explicit', sources: [], ...e })),
  };
}

function layerOf(result, nodeId) {
  const z = result.z.get(nodeId);
  return result.layers.find((l) => l.z === z);
}

test('PROJECTION_IDS and TEMPORAL_RELATIONS are the documented vocabularies', () => {
  assert.deepEqual(PROJECTION_IDS, ['context', 'time', 'provenance', 'knowledge', 'epistemic']);
  assert.deepEqual(TEMPORAL_RELATIONS, ['precede', 'raffine', 'supersede', 'derive_de']);
});

// --- context -------------------------------------------------------------

test('context: homonyms in two contexts land on different layers', () => {
  const g = graphOf([
    node('a', { label: 'Marge', context: 'finance' }),
    node('b', { label: 'Marge', context: 'electronique' }),
    node('c', { context: 'finance' }),
    node('d', {}), // no context → (unset)
  ]);
  const r = computeProjection(g, 'context');
  assert.equal(r.available, true);
  assert.equal(r.encoding.colorBy, 'type');
  assert.deepEqual(
    r.layers.map((l) => l.key),
    ['(unset)', 'electronique', 'finance']
  );
  assert.notEqual(r.z.get('a'), r.z.get('b'));
  assert.equal(r.z.get('a'), r.z.get('c'));
  assert.equal(layerOf(r, 'a').count, 2);
  // evenly spaced across [-1, 1]
  assert.deepEqual(r.layers.map((l) => l.z), [-1, 0, 1]);
});

test('context: a single layer sits at z = 0', () => {
  const r = computeProjection(graphOf([node('a', { context: 'x' }), node('b', { context: 'x' })]), 'context');
  assert.equal(r.layers.length, 1);
  assert.equal(r.layers[0].z, 0);
  assert.equal(r.z.get('a'), 0);
});

// --- time ----------------------------------------------------------------

test('nodeDate reads only the documented `date` field and never guesses', () => {
  assert.equal(nodeDate(node('a', { date: '2024-05-02' })).getUTCFullYear(), 2024);
  assert.equal(nodeDate(node('a', { created_at: '2023-01-01T10:00:00Z' })), null);
  assert.equal(nodeDate(node('a', { valid_from: '2022' })), null);
  assert.equal(nodeDate(node('a')), null);
  assert.equal(nodeDate(node('a', { date: 'sometime last spring' })), null);
});

test('time: dates produce calendar buckets plus an undated bottom layer', () => {
  const g = graphOf([
    node('a', { date: '2023-02-01' }),
    node('b', { date: '2024-06-11' }),
    node('c', { date: '2024-09-01' }),
    node('d', {}),
  ]);
  const r = computeProjection(g, 'time');
  assert.equal(r.available, true);
  assert.equal(r.ordinal, false);
  assert.deepEqual(r.layers.map((l) => l.key), ['undated', '2023', '2024']);
  assert.equal(r.layers[0].z, -1); // undated at the bottom
  assert.equal(r.z.get('d'), -1);
  assert.equal(r.z.get('b'), r.z.get('c'));
  assert.equal(layerOf(r, 'b').count, 2);
});

test('time: no dates but a precede chain gives ordinal steps and an undated layer', () => {
  const g = graphOf(
    [node('a'), node('b'), node('c'), node('loose')],
    [
      { from: 'a', to: 'b', relation: 'precede' },
      { from: 'b', to: 'c', relation: 'supersede' },
    ]
  );
  const r = computeProjection(g, 'time');
  assert.equal(r.available, true);
  assert.equal(r.ordinal, true);
  assert.deepEqual(r.layers.map((l) => l.label), ['undated', 'step 1', 'step 2', 'step 3']);
  assert.equal(r.z.get('loose'), -1);
  assert.ok(r.z.get('a') < r.z.get('b'));
  assert.ok(r.z.get('b') < r.z.get('c'));
});

test('temporalRank: longest path, cycles broken, untouched nodes absent', () => {
  const g = graphOf(
    [node('a'), node('b'), node('c'), node('x')],
    [
      { from: 'a', to: 'b', relation: 'precede' },
      { from: 'b', to: 'c', relation: 'raffine' },
      { from: 'a', to: 'c', relation: 'derive_de' },
      { from: 'c', to: 'a', relation: 'precede' }, // cycle → back-edge ignored
      { from: 'a', to: 'x', relation: 'lie_a' }, // not a temporal relation
    ]
  );
  const rank = temporalRank(g);
  assert.equal(rank.get('a'), 0);
  assert.equal(rank.get('b'), 1);
  assert.equal(rank.get('c'), 2); // longest path, not shortest
  assert.equal(rank.has('x'), false);
});

test('time: unavailable when the graph has neither dates nor temporal edges', () => {
  const g = graphOf([node('a'), node('b')], [{ from: 'a', to: 'b', relation: 'lie_a' }]);
  const r = computeProjection(g, 'time');
  assert.equal(r.available, false);
  assert.match(r.reason, /temporal/i);
  assert.deepEqual(r.layers, []);
  const listed = listProjections(g).find((p) => p.id === 'time');
  assert.equal(listed.available, false);
  assert.ok(listed.reason);
});

// --- provenance ----------------------------------------------------------

test('provenance: one layer per primary source file, sources-less nodes apart', () => {
  const g = graphOf([
    node('a', { sources: [{ file: 'docs/cdc.md' }] }),
    node('b', { sources: [{ file: 'docs/cdc.md' }, { file: 'other.md' }] }),
    node('c', { sources: [{ file: 'notes/a.md' }] }),
    node('d', {}),
  ]);
  const r = computeProjection(g, 'provenance');
  assert.deepEqual(r.layers.map((l) => l.key), ['no sources', 'docs/cdc.md', 'notes/a.md']);
  assert.equal(r.layers[1].label, 'cdc.md · docs');
  assert.equal(r.z.get('a'), r.z.get('b')); // primary source only
  assert.equal(r.z.get('d'), -1);
});

test('provenance: unavailable when nothing carries a source', () => {
  const r = computeProjection(graphOf([node('a'), node('b')]), 'provenance');
  assert.equal(r.available, false);
  assert.ok(r.reason);
});

// --- knowledge -----------------------------------------------------------

test('knowledge: classification by name, unknown types fall back to other', () => {
  assert.equal(knowledgePlane('concept'), 'aboutness');
  assert.equal(knowledgePlane('Concept_Metier'), 'aboutness');
  assert.equal(knowledgePlane('cas_usage'), 'substance');
  assert.equal(knowledgePlane('Hypothèse'), 'substance');
  assert.equal(knowledgePlane('source'), 'other');
  assert.equal(knowledgePlane('quelque_chose_de_neuf'), 'other');

  const g = graphOf([
    node('a', { type: 'concept' }),
    node('b', { type: 'decision' }),
    node('c', { type: 'source' }),
    node('d', { type: 'zzz_unknown_type' }),
  ]);
  const r = computeProjection(g, 'knowledge');
  assert.deepEqual(r.layers.map((l) => l.key), ['aboutness', 'substance', 'other']);
  assert.equal(r.z.get('c'), r.z.get('d'));
  assert.equal(layerOf(r, 'c').count, 2);
  assert.equal(r.encoding.colorBy, 'type');
});

// --- epistemic -----------------------------------------------------------

test('epistemic: known statuses keep their order, others follow alphabetically', () => {
  const g = graphOf([
    node('a', { status: 'rejected' }),
    node('b', { status: 'confirmed' }),
    node('c', { status: 'candidate' }),
    node('d', { status: 'zeta' }),
    node('e', { status: 'alpha' }),
  ]);
  const r = computeProjection(g, 'epistemic');
  assert.deepEqual(
    r.layers.map((l) => l.key),
    ['confirmed', 'candidate', 'rejected', 'alpha', 'zeta']
  );
  assert.equal(r.encoding.colorBy, 'status');
  assert.equal(r.layers[0].z, -1);
  assert.equal(r.layers[r.layers.length - 1].z, 1);
});

// --- listing -------------------------------------------------------------

test('listProjections reports availability for the whole family', () => {
  const g = graphOf([node('a', { context: 'x', sources: [{ file: 'f.md' }], date: '2024-01-01' })]);
  const list = listProjections(g);
  assert.deepEqual(list.map((p) => p.id), PROJECTION_IDS);
  assert.ok(list.every((p) => p.available));
  assert.ok(list.every((p) => typeof p.label === 'string' && p.label.length));

  const empty = listProjections(graphOf([]));
  assert.ok(empty.every((p) => p.available === false && typeof p.reason === 'string'));
});


test('S1: a year-only date is never placed on a month shelf (precision is capped, not upgraded)', () => {
  const g = graphOf([
    { id: 'a', type: 'decision', label: 'A', context: 'c', status: 'explicit', date: '2026', sources: [{ file: 'a.md' }] },
    { id: 'b', type: 'decision', label: 'B', context: 'c', status: 'explicit', date: '2026-03', sources: [{ file: 'b.md' }] },
    { id: 'c', type: 'decision', label: 'C', context: 'c', status: 'explicit', date: '2026-07', sources: [{ file: 'c.md' }] },
  ]);
  const t = computeProjection(g, 'time');
  assert.equal(t.available, true);
  assert.equal(t.granularity, 'year');
  const keys = t.layers.map((l) => l.key);
  assert.ok(keys.includes('2026'), `layers: ${keys.join(',')}`);
  assert.ok(!keys.some((k) => /^2026-\d{2}$/.test(k)), 'no month shelf may exist when a node declared a year only');
});

test('S4: the aboutness plane matches the type name "concept" exactly, not any prefix', () => {
  assert.equal(knowledgePlane('concept'), 'aboutness');
  assert.equal(knowledgePlane('Concepts'), 'aboutness');
  assert.equal(knowledgePlane('conceptualisation'), 'other');
  assert.equal(knowledgePlane('concepteur'), 'other');
});

test('S5: only the documented `date` field is a date', () => {
  assert.equal(nodeDate({ created_at: '2019-01-01' }), null);
  assert.equal(nodeDate({ valid_from: '2019-01-01' }), null);
  assert.ok(nodeDate({ date: '2019-01-01' }) instanceof Date);
});
