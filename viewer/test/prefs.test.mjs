import test from 'node:test';
import assert from 'node:assert/strict';

// The module reads globalThis.localStorage lazily, so a stub installed here is
// enough — no DOM, no browser.
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

class HostileStorage {
  getItem() { throw new Error('blocked'); }
  setItem() { throw new Error('quota'); }
  removeItem() { throw new Error('blocked'); }
}

const { readPrefs, writePrefs, clearPrefs, normalizePrefs, effectiveTheme, DEFAULT_PREFS } = await import(
  '../src/lib/prefs.js'
);

function withStorage(storage, fn) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
}

test('defaults are returned when nothing is stored', () => {
  withStorage(new MemoryStorage(), () => {
    assert.deepEqual(readPrefs(), DEFAULT_PREFS);
  });
});

test('preferences round-trip through storage', () => {
  withStorage(new MemoryStorage(), () => {
    writePrefs({ view: '3d', projection: 'time' });
    writePrefs({ theme: 'dark', lastRepo: 'foo/bar' });
    assert.deepEqual(readPrefs(), { view: '3d', projection: 'time', theme: 'dark', lastRepo: 'foo/bar' });
    clearPrefs();
    assert.deepEqual(readPrefs(), DEFAULT_PREFS);
  });
});

test('stored garbage never breaks the viewer', () => {
  const storage = new MemoryStorage();
  storage.setItem('vault-graph.prefs.v1', '{not json');
  withStorage(storage, () => assert.deepEqual(readPrefs(), DEFAULT_PREFS));

  const storage2 = new MemoryStorage();
  storage2.setItem('vault-graph.prefs.v1', JSON.stringify({ view: '7d', theme: 'neon', lastRepo: 42 }));
  withStorage(storage2, () => assert.deepEqual(readPrefs(), DEFAULT_PREFS));
});

test('a hostile or absent storage degrades to defaults, never throws', () => {
  withStorage(new HostileStorage(), () => {
    assert.deepEqual(readPrefs(), DEFAULT_PREFS);
    assert.deepEqual(writePrefs({ view: '3d' }), { ...DEFAULT_PREFS, view: '3d' });
    assert.doesNotThrow(() => clearPrefs());
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  delete globalThis.localStorage;
  assert.deepEqual(readPrefs(), DEFAULT_PREFS);
  if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
});

test('normalizePrefs is total', () => {
  assert.deepEqual(normalizePrefs(null), DEFAULT_PREFS);
  assert.equal(normalizePrefs({ view: '3D' }).view, '3d');
  assert.equal(normalizePrefs({ projection: '  Time ' }).projection, 'Time');
});

test('effectiveTheme resolves system against the media query', () => {
  assert.equal(effectiveTheme('dark'), 'dark');
  assert.equal(effectiveTheme('light'), 'light');
  assert.equal(effectiveTheme('system', () => ({ matches: true })), 'dark');
  assert.equal(effectiveTheme('system', () => ({ matches: false })), 'light');
  assert.equal(effectiveTheme('system', () => { throw new Error('no matchMedia'); }), 'light');
});
