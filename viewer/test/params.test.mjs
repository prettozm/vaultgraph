import test from 'node:test';
import assert from 'node:assert/strict';
import { readParams, classifyInput, buildAppUrl } from '../src/lib/params.js';

const BASE = 'https://prettozm.github.io/vaultgraph/';

test('readParams reads both supported parameters', () => {
  assert.deepEqual(readParams('?repo=https://github.com/foo/bar'), {
    repo: 'https://github.com/foo/bar',
    manifest: null,
    preferred: 'repo',
    view: null,
    projection: null,
  });
  const empty = { repo: null, manifest: null, preferred: null, view: null, projection: null };
  assert.deepEqual(readParams(''), empty);
  assert.deepEqual(readParams('?repo=%20%20'), empty);
});

test('readParams reads the optional view and projection (CDC §23)', () => {
  const params = readParams('?repo=foo/bar&view=3D&projection=Time');
  assert.equal(params.repo, 'foo/bar');
  assert.equal(params.view, '3d');
  assert.equal(params.projection, 'time');
  // An unknown view mode is ignored rather than guessed.
  assert.equal(readParams('?repo=foo/bar&view=4d').view, null);
});

test('classifyInput accepts the short owner/repo form (CDC §23)', () => {
  const result = classifyInput('foo/bar', BASE);
  assert.equal(result.kind, 'repo');
  assert.equal(result.owner, 'foo');
  assert.equal(result.repo, 'bar');
});

test('manifest overrides repo', () => {
  const params = readParams('?repo=https://github.com/foo/bar&manifest=https://x/.vault-graph/manifest.json');
  assert.equal(params.preferred, 'manifest');
  assert.equal(params.manifest, 'https://x/.vault-graph/manifest.json');
});

test('classifyInput recognises a GitHub repository', () => {
  const result = classifyInput('  https://github.com/foo/bar/tree/trunk ', BASE);
  assert.equal(result.kind, 'repo');
  assert.equal(result.owner, 'foo');
  assert.equal(result.repo, 'bar');
  assert.equal(result.branch, 'trunk');
});

test('a manifest.json URL pasted into the same field is accepted', () => {
  const result = classifyInput('http://127.0.0.1:8080/viewer/test/fixtures/.vault-graph/manifest.json', BASE);
  assert.deepEqual(result, {
    kind: 'manifest',
    value: 'http://127.0.0.1:8080/viewer/test/fixtures/.vault-graph/manifest.json',
  });
});

test('a relative manifest path resolves against the page URL (sub-path hosting)', () => {
  const result = classifyInput('test/fixtures/.vault-graph/manifest.json', BASE);
  assert.equal(result.kind, 'manifest');
  assert.equal(result.value, 'https://prettozm.github.io/vaultgraph/test/fixtures/.vault-graph/manifest.json');
});

test('empty or unusable input is reported with a reason, never guessed', () => {
  assert.equal(classifyInput('', BASE).kind, 'invalid');
  assert.equal(classifyInput('   ', BASE).kind, 'invalid');
  const bad = classifyInput('this is not a url', BASE);
  assert.equal(bad.kind, 'invalid');
  assert.match(bad.reason, /GitHub repository URL/);
});

test('buildAppUrl produces a bookmarkable URL for each target kind', () => {
  assert.equal(
    buildAppUrl(`${BASE}?stale=1`, { kind: 'repo', value: 'https://github.com/foo/bar' }),
    `${BASE}?repo=https%3A%2F%2Fgithub.com%2Ffoo%2Fbar`
  );
  assert.equal(
    buildAppUrl(BASE, { kind: 'manifest', value: 'https://x/m/manifest.json' }),
    `${BASE}?manifest=https%3A%2F%2Fx%2Fm%2Fmanifest.json`
  );
  assert.equal(buildAppUrl(BASE, null), BASE);
});

test('buildAppUrl prefers the short repo form and carries view/projection', () => {
  const target = { kind: 'repo', value: 'https://github.com/foo/bar', owner: 'foo', repo: 'bar', branch: null };
  assert.equal(buildAppUrl(BASE, target), `${BASE}?repo=foo%2Fbar`);
  assert.equal(
    buildAppUrl(BASE, target, { view: '3d', projection: 'time' }),
    `${BASE}?repo=foo%2Fbar&view=3d&projection=time`
  );
  // 2D is the default: it never pollutes the shared URL.
  assert.equal(buildAppUrl(BASE, target, { view: '2d', projection: 'time' }), `${BASE}?repo=foo%2Fbar`);
  // A pinned branch keeps the full URL so the ref is not lost.
  assert.equal(
    buildAppUrl(BASE, { ...target, branch: 'trunk', value: 'https://github.com/foo/bar/tree/trunk' }),
    `${BASE}?repo=https%3A%2F%2Fgithub.com%2Ffoo%2Fbar%2Ftree%2Ftrunk`
  );
});
