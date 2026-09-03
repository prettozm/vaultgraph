import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchText,
  resolveRef,
  resolveTarget,
  loadVaultGraph,
  countMismatch,
  LoadError,
} from '../src/lib/loader.js';
import { buildGraph } from '../src/lib/graph-model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(here, 'fixtures', '.vault-graph');
const ORIGIN = 'https://raw.githubusercontent.com/foo/bar/trunk/.vault-graph/';
const MANIFEST_URL = `${ORIGIN}manifest.json`;

/**
 * A fetch that serves the on-disk fixture. No network is ever touched.
 * `overrides` maps a URL (without cache-busting) to a canned response.
 */
function makeFetch(overrides = {}) {
  const calls = [];
  async function fake(url, init) {
    calls.push({ url, init });
    const clean = url.split('?')[0];
    if (Object.prototype.hasOwnProperty.call(overrides, clean)) {
      const override = overrides[clean];
      if (typeof override === 'function') return override(url, init);
      return override;
    }
    if (!clean.startsWith(ORIGIN)) {
      return { ok: false, status: 404, async text() { return ''; } };
    }
    const rel = clean.slice(ORIGIN.length);
    try {
      const body = await readFile(path.join(FIXTURE_DIR, rel), 'utf8');
      return { ok: true, status: 200, async text() { return body; }, async json() { return JSON.parse(body); } };
    } catch {
      return { ok: false, status: 404, async text() { return 'Not Found'; } };
    }
  }
  fake.calls = calls;
  return fake;
}

const response = (status, body = '') => ({
  ok: status >= 200 && status < 300,
  status,
  async text() { return body; },
  async json() { return JSON.parse(body); },
});

// --- ref resolution --------------------------------------------------------

test('an explicit branch short-circuits the API call', async () => {
  const fetchImpl = makeFetch();
  const result = await resolveRef('foo', 'bar', { fetchImpl, branch: 'release/2' });
  assert.deepEqual(result, { ref: 'release/2', source: 'explicit' });
  assert.equal(fetchImpl.calls.length, 0);
});

test('the default branch comes from the GitHub API, never assumed to be main', async () => {
  const fetchImpl = makeFetch({
    'https://api.github.com/repos/foo/bar': response(200, JSON.stringify({ default_branch: 'trunk' })),
  });
  const result = await resolveRef('foo', 'bar', { fetchImpl });
  assert.equal(result.ref, 'trunk');
  assert.equal(result.source, 'api');
});

test('a rate-limited API falls back to the HEAD ref with an explanation', async () => {
  const fetchImpl = makeFetch({ 'https://api.github.com/repos/foo/bar': response(403, '') });
  const result = await resolveRef('foo', 'bar', { fetchImpl });
  assert.equal(result.ref, 'HEAD');
  assert.equal(result.source, 'head-fallback');
  assert.match(result.note, /rate limit/i);
});

test('an unreachable API falls back to the HEAD ref', async () => {
  const fetchImpl = async () => {
    throw new TypeError('Failed to fetch');
  };
  const result = await resolveRef('foo', 'bar', { fetchImpl });
  assert.equal(result.ref, 'HEAD');
  assert.match(result.note, /unreachable/i);
});

test('an API answer without default_branch still yields a usable ref', async () => {
  const fetchImpl = makeFetch({
    'https://api.github.com/repos/foo/bar': response(200, JSON.stringify({ name: 'bar' })),
  });
  assert.equal((await resolveRef('foo', 'bar', { fetchImpl })).ref, 'HEAD');
});

// --- target resolution -----------------------------------------------------

test('a repo target becomes a manifest URL at the resolved ref', async () => {
  const fetchImpl = makeFetch({
    'https://api.github.com/repos/foo/bar': response(200, JSON.stringify({ default_branch: 'trunk' })),
  });
  const resolved = await resolveTarget({ kind: 'repo', owner: 'foo', repo: 'bar', branch: null }, { fetchImpl });
  assert.equal(resolved.manifestUrl, MANIFEST_URL);
  assert.deepEqual(resolved.repo, { owner: 'foo', repo: 'bar', ref: 'trunk' });
  assert.deepEqual(resolved.notes, []);
});

test('a manifest target keeps the URL and recovers repo identity when it can', async () => {
  const fromRaw = await resolveTarget({ kind: 'manifest', value: MANIFEST_URL });
  assert.equal(fromRaw.manifestUrl, MANIFEST_URL);
  assert.deepEqual(fromRaw.repo, { owner: 'foo', repo: 'bar', ref: 'trunk' });

  const local = await resolveTarget({
    kind: 'manifest',
    value: 'http://127.0.0.1:8080/viewer/test/fixtures/.vault-graph/manifest.json',
  });
  assert.equal(local.repo, null, 'a bare manifest URL has no repository identity');
});

test('resolveTarget refuses an unusable target', async () => {
  await assert.rejects(() => resolveTarget(null), (err) => err instanceof LoadError && err.code === 'format');
});

// --- transport -------------------------------------------------------------

test('fetchText maps transport outcomes to error codes', async () => {
  const url = `${ORIGIN}missing.json`;
  await assert.rejects(
    () => fetchText(url, { fetchImpl: makeFetch(), what: 'nodes.jsonl' }),
    (err) => err.code === 'not-found' && err.details.what === 'nodes.jsonl'
  );
  await assert.rejects(
    () => fetchText(url, { fetchImpl: async () => response(500), what: 'manifest.json' }),
    (err) => err.code === 'http' && err.details.status === 500
  );
  await assert.rejects(
    () => fetchText(url, { fetchImpl: async () => { throw new TypeError('offline'); }, what: 'manifest.json' }),
    (err) => err.code === 'network'
  );
});

test('requests are made with no-store, and Refresh adds a cache-busting token', async () => {
  const fetchImpl = makeFetch();
  await fetchText(MANIFEST_URL, { fetchImpl, what: 'manifest.json' });
  assert.equal(fetchImpl.calls[0].init.cache, 'no-store');
  assert.equal(fetchImpl.calls[0].url, MANIFEST_URL);

  await fetchText(MANIFEST_URL, { fetchImpl, cacheBust: 999, what: 'manifest.json' });
  assert.match(fetchImpl.calls[1].url, /_vg=999$/);
});

// --- full load -------------------------------------------------------------

test('loadVaultGraph reads the whole protocol payload from the fixture', async () => {
  const payload = await loadVaultGraph(MANIFEST_URL, { fetchImpl: makeFetch() });
  assert.equal(payload.meta.version, '0.1');
  assert.equal(payload.meta.generatedAt, '2026-09-02T22:00:00Z');
  assert.equal(payload.meta.commit, 'abc1234def5678901234567890abcdef12345678');
  assert.equal(payload.summaryAvailable, true);
  assert.equal(payload.summary.nodes, 9);
  assert.equal(payload.nodeRecords.length, 9);
  assert.equal(payload.edgeRecords.length, 7);
  assert.deepEqual(payload.warnings, [], 'the fixture must load without warnings');
  assert.equal(payload.paths.nodes, `${ORIGIN}graph/nodes.jsonl`);
  assert.ok(!Number.isNaN(Date.parse(payload.fetchedAt)));
});

test('a missing manifest is reported as such, distinctly from other failures', async () => {
  const fetchImpl = makeFetch({ [MANIFEST_URL]: response(404) });
  await assert.rejects(
    () => loadVaultGraph(MANIFEST_URL, { fetchImpl }),
    (err) => err.code === 'not-found' && err.details.what === 'manifest.json'
  );
});

test('a missing nodes.jsonl is an error, not an "incompatible repository"', async () => {
  const fetchImpl = makeFetch({ [`${ORIGIN}graph/nodes.jsonl`]: response(404) });
  await assert.rejects(
    () => loadVaultGraph(MANIFEST_URL, { fetchImpl }),
    (err) => err.code === 'not-found' && err.details.what === 'nodes.jsonl'
  );
});

test('a foreign or unparseable manifest fails with a precise code', async () => {
  const foreign = makeFetch({ [MANIFEST_URL]: response(200, JSON.stringify({ format: 'other' })) });
  await assert.rejects(
    () => loadVaultGraph(MANIFEST_URL, { fetchImpl: foreign }),
    (err) => err.code === 'format' && /vault-graph/.test(err.message)
  );

  const broken = makeFetch({ [MANIFEST_URL]: response(200, '{ not json') });
  await assert.rejects(
    () => loadVaultGraph(MANIFEST_URL, { fetchImpl: broken }),
    (err) => err.code === 'parse'
  );
});

test('an unreadable graph.json degrades to a warning: the data is the source of truth', async () => {
  const fetchImpl = makeFetch({ [`${ORIGIN}graph/graph.json`]: response(500) });
  const payload = await loadVaultGraph(MANIFEST_URL, { fetchImpl });
  assert.equal(payload.summaryAvailable, false);
  assert.equal(payload.nodeRecords.length, 9);
  assert.match(payload.warnings.join(' '), /graph\.json could not be read/);
});

test('malformed JSONL lines surface as warnings without losing the good records', async () => {
  const fetchImpl = makeFetch({
    [`${ORIGIN}graph/edges.jsonl`]: response(
      200,
      '{"id":"e1","from":"source:docs-memory","to":"concept:memory-activable","relation":"aborde"}\nBROKEN\n'
    ),
  });
  const payload = await loadVaultGraph(MANIFEST_URL, { fetchImpl });
  assert.equal(payload.edgeRecords.length, 1);
  assert.match(payload.warnings.join(' '), /edges\.jsonl line 2/);
});

test('countMismatch flags a summary that disagrees with the data', async () => {
  const payload = await loadVaultGraph(MANIFEST_URL, { fetchImpl: makeFetch() });
  const graph = buildGraph(payload.nodeRecords, payload.edgeRecords);
  assert.deepEqual(countMismatch(payload.summary, graph), [], 'fixture counts agree');

  const wrong = countMismatch({ nodes: 42, edges: 7 }, graph);
  assert.equal(wrong.length, 1);
  assert.match(wrong[0], /declares 42 nodes/);
  assert.deepEqual(countMismatch({ nodes: null, edges: null }, graph), []);
});
