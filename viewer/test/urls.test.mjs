import test from 'node:test';
import assert from 'node:assert/strict';
import { dirnameUrl, resolveRelative, withCacheBust, isAbsoluteHttpUrl } from '../src/lib/urls.js';

const MANIFEST = 'https://raw.githubusercontent.com/foo/bar/trunk/.vault-graph/manifest.json';

test('dirnameUrl returns the directory containing the manifest', () => {
  assert.equal(dirnameUrl(MANIFEST), 'https://raw.githubusercontent.com/foo/bar/trunk/.vault-graph/');
  assert.equal(dirnameUrl(`${MANIFEST}?x=1#y`), 'https://raw.githubusercontent.com/foo/bar/trunk/.vault-graph/');
});

test('manifest paths resolve relative to the manifest directory', () => {
  assert.equal(
    resolveRelative(MANIFEST, 'graph/nodes.jsonl'),
    'https://raw.githubusercontent.com/foo/bar/trunk/.vault-graph/graph/nodes.jsonl'
  );
  assert.equal(
    resolveRelative(MANIFEST, './graph/edges.jsonl'),
    'https://raw.githubusercontent.com/foo/bar/trunk/.vault-graph/graph/edges.jsonl'
  );
  assert.equal(
    resolveRelative(MANIFEST, '../elsewhere/graph.json'),
    'https://raw.githubusercontent.com/foo/bar/trunk/elsewhere/graph.json'
  );
  assert.equal(
    resolveRelative('http://127.0.0.1:8080/viewer/test/fixtures/.vault-graph/manifest.json', 'graph/graph.json'),
    'http://127.0.0.1:8080/viewer/test/fixtures/.vault-graph/graph/graph.json'
  );
});

test('an absolute path in the manifest is honoured as-is', () => {
  assert.equal(resolveRelative(MANIFEST, 'https://example.com/g.json'), 'https://example.com/g.json');
});

test('resolveRelative returns null for empty input', () => {
  assert.equal(resolveRelative(MANIFEST, ''), null);
  assert.equal(resolveRelative(MANIFEST, '   '), null);
  assert.equal(resolveRelative(MANIFEST, null), null);
});

test('withCacheBust adds a single, replaceable parameter', () => {
  const once = withCacheBust(MANIFEST, 1234);
  assert.match(once, /_vg=1234$/);
  const twice = withCacheBust(once, 5678);
  assert.match(twice, /_vg=5678$/);
  assert.equal(twice.match(/_vg=/g).length, 1);
});

test('isAbsoluteHttpUrl only accepts http(s)', () => {
  assert.equal(isAbsoluteHttpUrl('https://a/b'), true);
  assert.equal(isAbsoluteHttpUrl('http://127.0.0.1:8080/m.json'), true);
  assert.equal(isAbsoluteHttpUrl('./m.json'), false);
  assert.equal(isAbsoluteHttpUrl('file:///tmp/m.json'), false);
  assert.equal(isAbsoluteHttpUrl(null), false);
});
