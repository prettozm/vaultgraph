import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, shortSha, formatSourceRef, formatCount, formatRelative } from '../src/lib/format.js';

test('formatDate renders the CDC example in UTC, independently of the local zone', () => {
  assert.equal(formatDate('2026-09-02T22:00:00Z'), '02 Sep 2026 22:00 UTC');
  assert.equal(formatDate('2026-09-02T22:00:00+00:00'), '02 Sep 2026 22:00 UTC');
  assert.equal(formatDate('2026-09-03T00:00:00+02:00'), '02 Sep 2026 22:00 UTC');
});

test('a graph that has never been generated says so', () => {
  assert.equal(formatDate(null), 'not generated yet');
  assert.equal(formatDate(undefined), 'not generated yet');
  assert.equal(formatDate(''), 'not generated yet');
  assert.equal(formatDate(null, { empty: '—' }), '—');
});

test('an unparseable timestamp is reported rather than silently dropped', () => {
  assert.equal(formatDate('yesterday'), 'unknown date');
});

test('shortSha shortens real shas and leaves other markers readable', () => {
  assert.equal(shortSha('abc1234def5678901234567890abcdef12345678'), 'abc1234');
  assert.equal(shortSha('abc1234'), 'abc1234');
  assert.equal(shortSha(null), 'unknown');
  assert.equal(shortSha('   '), 'unknown');
  assert.equal(shortSha('not-a-sha-at-all-here'), 'not-a-sha-at');
});

test('formatSourceRef renders file and line range', () => {
  assert.equal(formatSourceRef({ file: 'docs/a.md', line_start: 14, line_end: 22 }), 'docs/a.md:14-22');
  assert.equal(formatSourceRef({ file: 'docs/a.md', line_start: 7, line_end: 7 }), 'docs/a.md:7');
  assert.equal(formatSourceRef({ file: 'docs/a.md' }), 'docs/a.md');
  assert.equal(formatSourceRef(null), '');
});

test('formatCount groups thousands', () => {
  assert.equal(formatCount(1234), '1\u202f234');
  assert.equal(formatCount(Number.NaN), '—');
});

test('formatRelative reads freshness at a glance (CDC §8)', () => {
  const now = Date.parse('2026-09-03T12:00:00Z');
  assert.equal(formatRelative('2026-09-03T11:48:00Z', now), '12 min ago');
  assert.equal(formatRelative('2026-09-03T11:59:40Z', now), 'just now');
  assert.equal(formatRelative('2026-09-03T09:00:00Z', now), '3 hours ago');
  assert.equal(formatRelative('2026-09-02T12:00:00Z', now), '1 day ago');
  assert.equal(formatRelative('2026-07-05T12:00:00Z', now), '2 months ago');
  assert.equal(formatRelative('2024-09-03T12:00:00Z', now), '2 years ago');
  // A clock skew must not produce "-3 min ago".
  assert.equal(formatRelative('2026-09-03T12:10:00Z', now), 'in 10 min');
  assert.equal(formatRelative(null, now), 'not generated yet');
  assert.equal(formatRelative('nope', now), 'unknown date');
});
