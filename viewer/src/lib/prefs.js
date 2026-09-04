// Local UI preferences (CDC §22): browser storage only, never a backend.
// Every access is guarded: private mode, disabled storage and quota errors
// must degrade to "no preferences", never break the viewer.

const KEY = 'vault-graph.prefs.v1';

/**
 * Visual options shared by the 2D and the 3D renderer (v0.3 "living
 * constellation"). `animation: null` means "not chosen yet": it is resolved at
 * read time against prefers-reduced-motion, so a reduced-motion machine never
 * gets ambient drift it did not ask for.
 */
export const DEFAULT_VISUAL = {
  animation: null,
  labels: 'auto',
  edges: true,
  glow: 'medium',
  layers: 'layered',
  quality: 'auto',
};

export const LABEL_MODES = ['auto', 'hover', 'all', 'off'];
export const GLOW_LEVELS = ['off', 'low', 'medium', 'high'];
export const LAYER_MODES = ['flat', 'layered', 'expanded'];
export const QUALITY_LEVELS = ['auto', 'low', 'high'];

const LABELS = new Set(LABEL_MODES);
const GLOWS = new Set(GLOW_LEVELS);
const LAYERS = new Set(LAYER_MODES);
const QUALITIES = new Set(QUALITY_LEVELS);

export const DEFAULT_PREFS = {
  view: '2d',
  projection: 'context',
  theme: 'dark', // the product identity is the night constellation; the switch offers day
  lastRepo: '',
  legendOpen: true,
  visual: { ...DEFAULT_VISUAL },
};

const VIEWS = new Set(['2d', '3d']);
const THEMES = new Set(['light', 'dark', 'system']);

/** A fresh copy — callers must never be able to mutate the shared defaults. */
function defaults() {
  return { ...DEFAULT_PREFS, visual: { ...DEFAULT_VISUAL } };
}

function storage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    return s;
  } catch {
    return null;
  }
}

function pickEnum(value, allowed, fallback) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return allowed.has(v) ? v : fallback;
}

/** Coerce any stored/URL value into a valid visual-options object. */
export function normalizeVisual(raw) {
  const out = { ...DEFAULT_VISUAL };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.animation === 'boolean') out.animation = raw.animation;
  out.labels = pickEnum(raw.labels, LABELS, DEFAULT_VISUAL.labels);
  if (typeof raw.edges === 'boolean') out.edges = raw.edges;
  out.glow = pickEnum(raw.glow, GLOWS, DEFAULT_VISUAL.glow);
  out.layers = pickEnum(raw.layers, LAYERS, DEFAULT_VISUAL.layers);
  out.quality = pickEnum(raw.quality, QUALITIES, DEFAULT_VISUAL.quality);
  return out;
}

/** Coerce any stored/URL value into a valid preferences object. */
export function normalizePrefs(raw) {
  const out = defaults();
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.view === 'string' && VIEWS.has(raw.view.toLowerCase())) out.view = raw.view.toLowerCase();
  if (typeof raw.projection === 'string' && raw.projection.trim()) out.projection = raw.projection.trim();
  if (typeof raw.theme === 'string' && THEMES.has(raw.theme.toLowerCase())) out.theme = raw.theme.toLowerCase();
  if (typeof raw.lastRepo === 'string') out.lastRepo = raw.lastRepo.trim().slice(0, 400);
  if (typeof raw.legendOpen === 'boolean') out.legendOpen = raw.legendOpen;
  out.visual = normalizeVisual(raw.visual);
  return out;
}

/**
 * Resolve the visual options into concrete values a renderer can consume:
 * `animation` stops being "unset" and becomes the answer to
 * prefers-reduced-motion.
 * @param {object} visual
 * @param {Function} [matchMedia]
 */
export function resolveVisual(visual, matchMedia = globalThis.matchMedia) {
  const v = normalizeVisual(visual);
  if (typeof v.animation === 'boolean') return v;
  return { ...v, animation: !prefersReducedMotion(matchMedia) };
}

/** True when the machine asks for reduced motion; false when it cannot be asked. */
export function prefersReducedMotion(matchMedia = globalThis.matchMedia) {
  try {
    return Boolean(matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/** Read the stored preferences; always returns a usable object. */
export function readPrefs() {
  const s = storage();
  if (!s) return defaults();
  try {
    const text = s.getItem(KEY);
    if (!text) return defaults();
    return normalizePrefs(JSON.parse(text));
  } catch {
    return defaults();
  }
}

/**
 * Merge a patch into the stored preferences. `visual` merges field by field,
 * so a caller can change one option without restating the others.
 * @returns {object} the resulting preferences (even when persistence failed)
 */
export function writePrefs(patch) {
  const current = readPrefs();
  const merged = { ...current, ...(patch ?? {}) };
  if (patch && patch.visual && typeof patch.visual === 'object') {
    merged.visual = { ...current.visual, ...patch.visual };
  }
  const next = normalizePrefs(merged);
  const s = storage();
  if (s) {
    try {
      s.setItem(KEY, JSON.stringify(next));
    } catch {
      /* quota or disabled storage — the session still uses `next` in memory */
    }
  }
  return next;
}

/** Forget everything the viewer stored locally. */
export function clearPrefs() {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/** Resolve 'system' against the media query, with a safe fallback. */
export function effectiveTheme(theme, matchMedia = globalThis.matchMedia) {
  if (theme === 'light' || theme === 'dark') return theme;
  try {
    return matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
