// Local UI preferences (CDC §22): browser storage only, never a backend.
// Every access is guarded: private mode, disabled storage and quota errors
// must degrade to "no preferences", never break the viewer.

const KEY = 'vault-graph.prefs.v1';

export const DEFAULT_PREFS = {
  view: '2d',
  projection: 'context',
  theme: 'system',
  lastRepo: '',
};

const VIEWS = new Set(['2d', '3d']);
const THEMES = new Set(['light', 'dark', 'system']);

function storage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    return s;
  } catch {
    return null;
  }
}

/** Coerce any stored/URL value into a valid preferences object. */
export function normalizePrefs(raw) {
  const out = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.view === 'string' && VIEWS.has(raw.view.toLowerCase())) out.view = raw.view.toLowerCase();
  if (typeof raw.projection === 'string' && raw.projection.trim()) out.projection = raw.projection.trim();
  if (typeof raw.theme === 'string' && THEMES.has(raw.theme.toLowerCase())) out.theme = raw.theme.toLowerCase();
  if (typeof raw.lastRepo === 'string') out.lastRepo = raw.lastRepo.trim().slice(0, 400);
  return out;
}

/** Read the stored preferences; always returns a usable object. */
export function readPrefs() {
  const s = storage();
  if (!s) return { ...DEFAULT_PREFS };
  try {
    const text = s.getItem(KEY);
    if (!text) return { ...DEFAULT_PREFS };
    return normalizePrefs(JSON.parse(text));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Merge a patch into the stored preferences.
 * @returns {object} the resulting preferences (even when persistence failed)
 */
export function writePrefs(patch) {
  const next = normalizePrefs({ ...readPrefs(), ...(patch ?? {}) });
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
