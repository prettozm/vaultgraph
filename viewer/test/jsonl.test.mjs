import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonl } from '../src/lib/jsonl.js';

test('parses one object per line', () => {
  const { records, errors } = parseJsonl('{"id":"a"}\n{"id":"b"}');
  assert.deepEqual(records, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(errors.length, 0);
});

test('tolerates blank lines, trailing newline, CRLF and a BOM', () => {
  const text = '﻿{"id":"a"}\r\n\r\n   \n{"id":"b"}\n';
  const { records, errors } = parseJsonl(text);
  assert.deepEqual(records, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(errors.length, 0);
});

test('empty and non-string input yields no records', () => {
  for (const input of ['', '\n\n', null, undefined, 42]) {
    const { records, errors } = parseJsonl(input);
    assert.equal(records.length, 0);
    assert.equal(errors.length, 0);
  }
});

test('a malformed line is reported, not thrown, and does not abort the parse', () => {
  const { records, errors } = parseJsonl('{"id":"a"}\n{oops\n{"id":"c"}');
  assert.deepEqual(records, [{ id: 'a' }, { id: 'c' }]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 2);
  assert.match(errors[0].text, /oops/);
});

test('non-object records are rejected with their line number', () => {
  const { records, errors } = parseJsonl('{"id":"a"}\n[1,2]\n"plain"\n3');
  assert.deepEqual(records, [{ id: 'a' }]);
  assert.deepEqual(errors.map((e) => e.line), [2, 3, 4]);
});
