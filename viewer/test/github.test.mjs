import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGitHubUrl,
  rawBaseUrl,
  manifestUrlFor,
  apiRepoUrl,
  inferRepoFromRawUrl,
  blobUrl,
  commitUrl,
} from '../src/lib/github.js';

test('parseGitHubUrl accepts the canonical form', () => {
  assert.deepEqual(parseGitHubUrl('https://github.com/foo/bar'), {
    owner: 'foo',
    repo: 'bar',
    branch: null,
  });
});

test('parseGitHubUrl tolerates .git, trailing slash, whitespace, query and hash', () => {
  const expected = { owner: 'foo', repo: 'bar', branch: null };
  for (const input of [
    'https://github.com/foo/bar.git',
    'https://github.com/foo/bar/',
    '  https://github.com/foo/bar  ',
    'https://github.com/foo/bar?tab=readme-ov-file',
    'https://github.com/foo/bar#readme',
    'http://github.com/foo/bar',
    'https://www.github.com/foo/bar',
    'github.com/foo/bar',
    'foo/bar',
    'git@github.com:foo/bar.git',
  ]) {
    assert.deepEqual(parseGitHubUrl(input), expected, `failed for ${input}`);
  }
});

test('parseGitHubUrl reads an explicit branch from /tree/ and /blob/', () => {
  assert.deepEqual(parseGitHubUrl('https://github.com/foo/bar/tree/trunk'), {
    owner: 'foo',
    repo: 'bar',
    branch: 'trunk',
  });
  assert.deepEqual(parseGitHubUrl('https://github.com/foo/bar/tree/feature/x'), {
    owner: 'foo',
    repo: 'bar',
    branch: 'feature/x',
  });
  assert.deepEqual(parseGitHubUrl('https://github.com/foo/bar/blob/dev/docs/a.md'), {
    owner: 'foo',
    repo: 'bar',
    branch: 'dev',
  });
});

test('parseGitHubUrl rejects what is not a repository reference', () => {
  for (const input of ['', '   ', 'https://github.com/foo', 'https://example.com', null, 42, 'https://github.com//bar']) {
    assert.equal(parseGitHubUrl(input), null, `should reject ${String(input)}`);
  }
});

test('raw URL construction never assumes a branch name', () => {
  assert.equal(rawBaseUrl('foo', 'bar', 'trunk'), 'https://raw.githubusercontent.com/foo/bar/trunk/');
  assert.equal(
    manifestUrlFor('foo', 'bar', 'trunk'),
    'https://raw.githubusercontent.com/foo/bar/trunk/.vault-graph/manifest.json'
  );
  assert.equal(
    manifestUrlFor('foo', 'bar', 'HEAD'),
    'https://raw.githubusercontent.com/foo/bar/HEAD/.vault-graph/manifest.json'
  );
  assert.equal(apiRepoUrl('foo', 'bar'), 'https://api.github.com/repos/foo/bar');
});

test('inferRepoFromRawUrl recovers repository identity from a manifest URL', () => {
  assert.deepEqual(
    inferRepoFromRawUrl('https://raw.githubusercontent.com/foo/bar/trunk/.vault-graph/manifest.json'),
    { owner: 'foo', repo: 'bar', ref: 'trunk' }
  );
  assert.equal(inferRepoFromRawUrl('http://127.0.0.1:8080/viewer/x/.vault-graph/manifest.json'), null);
  assert.equal(inferRepoFromRawUrl('not a url'), null);
});

test('blobUrl points at file + commit + line range', () => {
  assert.equal(
    blobUrl({ owner: 'foo', repo: 'bar', ref: 'abc123', file: 'docs/memory.md', lineStart: 14, lineEnd: 22 }),
    'https://github.com/foo/bar/blob/abc123/docs/memory.md#L14-L22'
  );
  assert.equal(
    blobUrl({ owner: 'foo', repo: 'bar', ref: 'abc123', file: 'docs/a.md', lineStart: 7, lineEnd: 7 }),
    'https://github.com/foo/bar/blob/abc123/docs/a.md#L7'
  );
  assert.equal(
    blobUrl({ owner: 'foo', repo: 'bar', ref: 'abc123', file: './docs/a.md' }),
    'https://github.com/foo/bar/blob/abc123/docs/a.md'
  );
  assert.equal(
    blobUrl({ owner: 'foo', repo: 'bar', ref: 'main', file: 'docs/a b.md', lineStart: 2 }),
    'https://github.com/foo/bar/blob/main/docs/a%20b.md#L2'
  );
  assert.equal(blobUrl({ owner: null, repo: 'bar', ref: 'x', file: 'a.md' }), null);
});

test('commitUrl is null without a repository', () => {
  assert.equal(commitUrl('foo', 'bar', 'abc'), 'https://github.com/foo/bar/commit/abc');
  assert.equal(commitUrl(null, 'bar', 'abc'), null);
  assert.equal(commitUrl('foo', 'bar', null), null);
});
