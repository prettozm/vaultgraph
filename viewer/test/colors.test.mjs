import test from 'node:test';
import assert from 'node:assert/strict';
import { colorFor, statusColor, statusKind, isTentative, shapeForType } from '../src/lib/colors.js';

test('statusColor is deterministic and theme-aware', () => {
  assert.equal(statusColor('candidate'), statusColor('candidate'));
  assert.notEqual(statusColor('candidate'), statusColor('confirmed'));
  assert.notEqual(statusColor('candidate'), statusColor('candidate', { dark: true }));
  assert.match(statusColor('candidate', { alpha: 0.5 }), /\/ 0\.5\)$/);
  // An unknown vocabulary still gets a stable colour rather than a crash (§26).
  assert.equal(statusColor('brand-new-state'), statusColor('brand-new-state'));
  assert.equal(statusKind('brand-new-state'), null);
  assert.equal(statusKind('CANDIDATE'), 'candidate');
});

test('candidate and unresolved are the states the UI must single out', () => {
  assert.equal(isTentative('candidate'), true);
  assert.equal(isTentative('Unresolved'), true);
  assert.equal(isTentative('explicit'), false);
  assert.equal(isTentative(undefined), false);
});

test('shape carries the type so colour is never the only channel (§19)', () => {
  assert.equal(shapeForType('source'), 'square');
  assert.equal(shapeForType('decision'), 'diamond');
  assert.equal(shapeForType('hypothese'), 'triangle');
  assert.equal(shapeForType('concept'), 'circle');
  assert.equal(shapeForType(null), 'circle');
  assert.equal(colorFor('concept'), colorFor('concept'));
});
