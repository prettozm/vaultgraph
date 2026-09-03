// URL helpers shared by the loader. Pure functions.

/** Directory URL (with trailing slash) that contains `url`. */
export function dirnameUrl(url) {
  const u = new URL(url);
  u.hash = '';
  u.search = '';
  u.pathname = u.pathname.replace(/[^/]*$/, '');
  return u.toString();
}

/**
 * Resolve a manifest-relative path against the manifest's directory.
 * Absolute URLs in the manifest are honoured as-is.
 */
export function resolveRelative(baseUrl, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) return null;
  const rel = relPath.trim().replace(/^\.\//, '');
  return new URL(rel, dirnameUrl(baseUrl)).toString();
}

/** Append a cache-busting parameter (used by Refresh, alongside no-store). */
export function withCacheBust(url, token) {
  const u = new URL(url);
  u.searchParams.set('_vg', String(token));
  return u.toString();
}

/** True when the string looks like an absolute http(s) URL. */
export function isAbsoluteHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
