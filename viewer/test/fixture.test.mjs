// The shipped sample .vault-graph is both a test input and the thing a person
// opens to try the viewer locally. These tests keep it honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonl } from '../src/lib/jsonl.js';
import { validateManifest, readSummary } from '../src/lib/manifest.js';
import { buildGraph, discoverFilterValues, findHomonyms, hasSources } from '../src/lib/graph-model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(here, 'fixtures', '.vault-graph');

const readJson = async (rel) => JSON.parse(await readFile(path.join(DIR, rel), 'utf8'));

test('the fixture manifest conforms to the contract and its files exist', async () => {
  const manifest = await readJson('manifest.json');
  const result = validateManifest(manifest);
  assert.equal(result.ok, true, result.errors.join(' '));
  assert.deepEqual(result.warnings, []);
  for (const key of ['graph', 'nodes', 'edges', 'config', 'schema']) {
    assert.ok(existsSync(path.join(DIR, manifest[key])), `${key} -> ${manifest[key]} is missing`);
  }
});

test('graph.json counts agree with the JSONL data', async () => {
  const summary = readSummary(await readJson('graph/graph.json'));
  const nodes = parseJsonl(await readFile(path.join(DIR, 'graph/nodes.jsonl'), 'utf8'));
  const edges = parseJsonl(await readFile(path.join(DIR, 'graph/edges.jsonl'), 'utf8'));
  assert.deepEqual(nodes.errors, []);
  assert.deepEqual(edges.errors, []);
  assert.equal(nodes.records.length, summary.nodes);
  assert.equal(edges.records.length, summary.edges);
});

test('the fixture exercises the cases the viewer must show', async () => {
  const nodes = parseJsonl(await readFile(path.join(DIR, 'graph/nodes.jsonl'), 'utf8')).records;
  const edges = parseJsonl(await readFile(path.join(DIR, 'graph/edges.jsonl'), 'utf8')).records;
  const graph = buildGraph(nodes, edges);
  assert.deepEqual(graph.issues, [], 'the fixture must contain no dangling edges or duplicates');

  const orphans = graph.nodes.filter((n) => graph.degree.get(n.id) === 0);
  assert.equal(orphans.length, 1, 'exactly one degree-0 node');
  assert.ok(orphans[0].reason, 'the orphan carries a reason (CDC §14)');

  const unsourced = graph.nodes.filter((n) => !hasSources(n));
  assert.equal(unsourced.length, 1);
  assert.equal(unsourced[0].status, 'candidate', 'a node without provenance is candidate (CDC §12)');

  const homonyms = findHomonyms(graph.nodes);
  assert.equal(homonyms.length, 1, 'one homonym pair (CDC §13)');
  assert.deepEqual(homonyms[0].nodes.map((n) => n.context).sort(), ['electronique', 'finance']);

  assert.ok(graph.edges.some((e) => !hasSources(e)), 'at least one relation without provenance');
  assert.ok(graph.nodes.some((n) => n.aliases.length > 0), 'at least one node with aliases (search)');
});

test('the fixture yields a multi-valued, dynamically discovered vocabulary', async () => {
  const nodes = parseJsonl(await readFile(path.join(DIR, 'graph/nodes.jsonl'), 'utf8')).records;
  const facets = discoverFilterValues(buildGraph(nodes, []).nodes);
  assert.ok(facets.type.length >= 4);
  assert.ok(facets.context.length >= 4);
  assert.ok(facets.status.length >= 3);
  assert.equal(facets.provenance.length, 2, 'both provenance buckets are represented');
  const statuses = facets.status.map((s) => s.value);
  assert.ok(statuses.includes('candidate') && statuses.includes('unresolved'), 'quick filters have something to show');
});

test('graph.json breakdowns match the data they summarise', async () => {
  const summary = readSummary(await readJson('graph/graph.json'));
  const nodes = parseJsonl(await readFile(path.join(DIR, 'graph/nodes.jsonl'), 'utf8')).records;
  const edges = parseJsonl(await readFile(path.join(DIR, 'graph/edges.jsonl'), 'utf8')).records;
  const graph = buildGraph(nodes, edges);

  const recount = (items, key) => {
    const out = {};
    for (const item of items) out[item[key]] = (out[item[key]] ?? 0) + 1;
    return out;
  };
  assert.deepEqual(recount(graph.nodes, 'type'), summary.byType);
  assert.deepEqual(recount(graph.nodes, 'context'), summary.byContext);
  assert.deepEqual(recount(graph.nodes, 'status'), summary.byStatus);
  assert.deepEqual(recount(graph.edges, 'relation'), summary.byRelation);
});
