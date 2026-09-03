import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAuthFetch } from '../src/lib/auth-fetch.js';

function recorder() {
  const calls = [];
  const base = async (url, init = {}) => {
    calls.push({ url, init, headers: new Headers(init.headers || {}) });
    return { ok: true, status: 200, async text() { return ''; } };
  };
  return { base, calls };
}

test('no token → returns the base fetch unchanged (identity)', () => {
  const { base } = recorder();
  assert.equal(makeAuthFetch('', base), base);
  assert.equal(makeAuthFetch(null, base), base);
  assert.equal(makeAuthFetch(undefined, base), base);
});

test('raw.githubusercontent.com is rewritten to the authenticated Contents API', async () => {
  const { base, calls } = recorder();
  const f = makeAuthFetch('tok123', base);
  await f('https://raw.githubusercontent.com/prettozm/ariadne/claude%2Frepo-x/.vault-graph/manifest.json');
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://api.github.com/repos/prettozm/ariadne/contents/.vault-graph/manifest.json?ref=claude%2Frepo-x',
  );
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer tok123');
  assert.equal(calls[0].headers.get('Accept'), 'application/vnd.github.raw');
});

test('nested graph paths keep their sub-path in the Contents API call', async () => {
  const { base, calls } = recorder();
  const f = makeAuthFetch('tok', base);
  await f('https://raw.githubusercontent.com/o/r/main/.vault-graph/graph/nodes.jsonl');
  assert.equal(
    calls[0].url,
    'https://api.github.com/repos/o/r/contents/.vault-graph/graph/nodes.jsonl?ref=main',
  );
});

test('api.github.com gets an Authorization header, same host', async () => {
  const { base, calls } = recorder();
  const f = makeAuthFetch('tok', base);
  await f('https://api.github.com/repos/o/r');
  assert.equal(calls[0].url, 'https://api.github.com/repos/o/r');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer tok');
});

test('the token never leaks to a non-GitHub host', async () => {
  const { base, calls } = recorder();
  const f = makeAuthFetch('secret', base);
  await f('https://example.com/whatever');
  assert.equal(calls[0].url, 'https://example.com/whatever');
  assert.equal(calls[0].headers.get('Authorization'), null);
});

test('a non-URL input is passed through untouched', async () => {
  const { base, calls } = recorder();
  const f = makeAuthFetch('secret', base);
  await f('not a url');
  assert.equal(calls[0].url, 'not a url');
  assert.equal(calls[0].headers.get('Authorization'), null);
});
