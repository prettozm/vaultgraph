import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateManifest,
  resolveManifestPaths,
  readManifestMeta,
  readSummary,
} from '../src/lib/manifest.js';

const MANIFEST_URL = 'https://raw.githubusercontent.com/foo/bar/trunk/.vault-graph/manifest.json';

const VALID = {
  format: 'vault-graph',
  version: '0.1',
  graph: 'graph/graph.json',
  nodes: 'graph/nodes.jsonl',
  edges: 'graph/edges.jsonl',
  config: 'config.yaml',
  schema: 'schema.yaml',
  generated_at: '2026-09-02T22:00:00Z',
  source: { type: 'git', commit: 'abc123', branch: 'trunk' },
  generator: { type: 'agent', name: 'claude' },
};

test('a conforming manifest validates cleanly', () => {
  const result = validateManifest(VALID);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('a foreign format is a fatal error (CDC §6)', () => {
  const result = validateManifest({ ...VALID, format: 'something-else' });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /vault-graph/);
});

test('missing nodes/edges pointers are fatal, a missing graph summary is not', () => {
  const noData = validateManifest({ ...VALID, nodes: undefined, edges: '' });
  assert.equal(noData.ok, false);
  assert.equal(noData.errors.length, 2);

  const noSummary = validateManifest({ ...VALID, graph: undefined });
  assert.equal(noSummary.ok, true);
  assert.match(noSummary.warnings.join(' '), /graph/);
});

test('a null generated_at is legitimate; a bad one is a warning', () => {
  assert.deepEqual(validateManifest({ ...VALID, generated_at: null }).warnings, []);
  assert.match(validateManifest({ ...VALID, generated_at: 'soon' }).warnings.join(' '), /ISO-8601/);
});

test('a non-object manifest is rejected', () => {
  for (const value of [null, [], 'text', 7]) {
    assert.equal(validateManifest(value).ok, false);
  }
});

test('manifest paths resolve against the manifest directory', () => {
  const paths = resolveManifestPaths(VALID, MANIFEST_URL);
  assert.equal(paths.nodes, 'https://raw.githubusercontent.com/foo/bar/trunk/.vault-graph/graph/nodes.jsonl');
  assert.equal(paths.edges, 'https://raw.githubusercontent.com/foo/bar/trunk/.vault-graph/graph/edges.jsonl');
  assert.equal(paths.graph, 'https://raw.githubusercontent.com/foo/bar/trunk/.vault-graph/graph/graph.json');
  assert.equal(paths.config, 'https://raw.githubusercontent.com/foo/bar/trunk/.vault-graph/config.yaml');
  assert.equal(resolveManifestPaths({ ...VALID, schema: undefined }, MANIFEST_URL).schema, null);
});

test('readManifestMeta is defensive about missing sub-objects', () => {
  assert.deepEqual(readManifestMeta(VALID), {
    format: 'vault-graph',
    version: '0.1',
    generatedAt: '2026-09-02T22:00:00Z',
    sourceType: 'git',
    commit: 'abc123',
    branch: 'trunk',
    generatorType: 'agent',
    generatorName: 'claude',
  });
  const empty = readManifestMeta({});
  assert.equal(empty.commit, null);
  assert.equal(empty.generatedAt, null);
  assert.equal(readManifestMeta(null).version, null);
  assert.equal(readManifestMeta({ source: { commit: '   ' } }).commit, null);
});

test('readSummary normalises graph.json and tolerates an absent one', () => {
  const summary = readSummary({
    generated_at: '2026-09-02T22:00:00Z',
    source_commit: 'abc123',
    counts: { nodes: 9, edges: 7 },
    by_type: { concept: 3 },
  });
  assert.equal(summary.nodes, 9);
  assert.equal(summary.edges, 7);
  assert.deepEqual(summary.byType, { concept: 3 });
  assert.deepEqual(summary.byStatus, {});

  const none = readSummary(null);
  assert.equal(none.nodes, null);
  assert.equal(none.edges, null);
});
