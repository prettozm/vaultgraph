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

const {
  readPrefs,
  writePrefs,
  clearPrefs,
  normalizePrefs,
  normalizeVisual,
  resolveVisual,
  prefersReducedMotion,
  effectiveTheme,
  DEFAULT_PREFS,
  DEFAULT_VISUAL,
} = await import('../src/lib/prefs.js');

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
    assert.deepEqual(readPrefs(), {
      view: '3d',
      projection: 'time',
      theme: 'dark',
      lastRepo: 'foo/bar',
      legendOpen: true,
      visual: { ...DEFAULT_VISUAL },
    });
    clearPrefs();
    assert.deepEqual(readPrefs(), DEFAULT_PREFS);
  });
});

test('visual options merge field by field and survive a round-trip (v0.3)', () => {
  withStorage(new MemoryStorage(), () => {
    writePrefs({ visual: { glow: 'high' } });
    writePrefs({ visual: { labels: 'all', edges: false } });
    assert.deepEqual(readPrefs().visual, {
      ...DEFAULT_VISUAL,
      glow: 'high',
      labels: 'all',
      edges: false,
    });
    // The other preferences are untouched by a visual patch.
    assert.equal(readPrefs().theme, 'dark');
    // Resetting to the defaults puts `animation` back to "unset".
    writePrefs({ visual: { ...DEFAULT_VISUAL } });
    assert.deepEqual(readPrefs().visual, DEFAULT_VISUAL);
  });
});

test('normalizeVisual validates every enum and never throws', () => {
  assert.deepEqual(normalizeVisual(null), DEFAULT_VISUAL);
  assert.deepEqual(normalizeVisual('nonsense'), DEFAULT_VISUAL);
  assert.deepEqual(normalizeVisual({ labels: 'ALL', glow: ' High ', layers: 'Flat', quality: 'LOW' }), {
    animation: null,
    labels: 'all',
    edges: true,
    glow: 'high',
    layers: 'flat',
    quality: 'low',
  });
  // Unknown values fall back to the default rather than being carried through.
  assert.equal(normalizeVisual({ labels: 'enormous' }).labels, 'auto');
  assert.equal(normalizeVisual({ glow: 42 }).glow, 'medium');
  assert.equal(normalizeVisual({ edges: 'yes' }).edges, true);
  assert.equal(normalizeVisual({ animation: 'yes' }).animation, null);
  assert.equal(normalizeVisual({ animation: false }).animation, false);
});

test('the defaults are never shared: mutating a read cannot poison the next one', () => {
  const first = normalizePrefs(null);
  first.visual.glow = 'high';
  assert.equal(normalizePrefs(null).visual.glow, 'medium');
  assert.equal(DEFAULT_PREFS.visual.glow, 'medium');
});

test('an unset animation resolves against prefers-reduced-motion', () => {
  const reduce = () => ({ matches: true });
  const noReduce = () => ({ matches: false });
  assert.equal(resolveVisual({}, reduce).animation, false);
  assert.equal(resolveVisual({}, noReduce).animation, true);
  // An explicit choice always wins over the system preference.
  assert.equal(resolveVisual({ animation: true }, reduce).animation, true);
  assert.equal(resolveVisual({ animation: false }, noReduce).animation, false);
  // No matchMedia at all: motion stays on, nothing throws.
  assert.equal(resolveVisual({}, undefined).animation, true);
  assert.equal(prefersReducedMotion(() => { throw new Error('no matchMedia'); }), false);
});

test('a stored garbage visual block degrades to the defaults', () => {
  const storage = new MemoryStorage();
  storage.setItem('vault-graph.prefs.v1', JSON.stringify({ view: '3d', visual: { glow: 'nuclear', labels: 7 } }));
  withStorage(storage, () => {
    assert.deepEqual(readPrefs().visual, DEFAULT_VISUAL);
    assert.equal(readPrefs().view, '3d');
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
  assert.equal(effectiveTheme('system', () => { throw new Error('no matchMedia'); }), 'dark'); // same fallback as the pre-paint bootstrap
});
