// GitHub URL parsing and URL construction.
// Pure functions: no network, no DOM.

const NAME = /^[A-Za-z0-9._-]+$/;
export const RAW_HOST = 'raw.githubusercontent.com';

function cleanRepoName(name) {
  return name.replace(/\.git$/i, '');
}

/**
 * Parse a GitHub repository reference.
 * Accepts:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/
 *   https://github.com/owner/repo/tree/<branch>[/sub/path]
 *   https://github.com/owner/repo/blob/<branch>/path/to/file
 *   github.com/owner/repo   |   www.github.com/owner/repo   |   owner/repo
 * Query strings and hashes are ignored.
 * @returns {{owner:string, repo:string, branch:string|null}|null}
 */
export function parseGitHubUrl(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;

  // Strip hash and query.
  s = s.split('#')[0].split('?')[0];
  // Strip scheme and known hosts.
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  s = s.replace(/^git@github\.com:/i, '');
  s = s.replace(/^(www\.)?github\.com\//i, '');
  s = s.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!s) return null;

  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = cleanRepoName(parts[1]);
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;

  let branch = null;
  if (parts.length > 2 && (parts[2] === 'tree' || parts[2] === 'blob')) {
    const rest = parts.slice(3);
    if (rest.length) {
      // A branch may contain slashes (feature/x). For /blob/ the tail is a file
      // path, so only the first segment is safely a ref; for /tree/ we keep the
      // whole tail, which is the common "branch with slashes" case.
      branch = parts[2] === 'blob' ? rest[0] : rest.join('/');
    }
  }
  return { owner, repo, branch: branch || null };
}

/** Base URL (with trailing slash) for raw file access at a given ref. */
export function rawBaseUrl(owner, repo, ref) {
  const r = encodeURIComponent(String(ref || 'HEAD'));
  return `https://${RAW_HOST}/${owner}/${repo}/${r}/`;
}

/** Canonical manifest location inside a repository. */
export function manifestUrlFor(owner, repo, ref) {
  return rawBaseUrl(owner, repo, ref) + '.vault-graph/manifest.json';
}

/** GitHub REST endpoint used to discover the default branch. */
export function apiRepoUrl(owner, repo) {
  return `https://api.github.com/repos/${owner}/${repo}`;
}

/**
 * Recover repository identity from a raw.githubusercontent.com URL so that a
 * viewer opened with ?manifest=... can still build source links.
 * @returns {{owner:string, repo:string, ref:string}|null}
 */
export function inferRepoFromRawUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== RAW_HOST) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  const [owner, repo, ref] = parts;
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  return { owner, repo: cleanRepoName(repo), ref: decodeURIComponent(ref) };
}

/** Link to a file (optionally a line range) at a given commit or branch. */
export function blobUrl({ owner, repo, ref, file, lineStart, lineEnd }) {
  if (!owner || !repo || !ref || !file) return null;
  const path = String(file)
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  let url = `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(ref)}/${path}`;
  const start = Number.isFinite(lineStart) ? lineStart : null;
  const end = Number.isFinite(lineEnd) ? lineEnd : null;
  if (start != null && end != null && end !== start) url += `#L${start}-L${end}`;
  else if (start != null) url += `#L${start}`;
  return url;
}

/** Link to the commit a graph was generated from. */
export function commitUrl(owner, repo, commit) {
  if (!owner || !repo || !commit) return null;
  return `https://github.com/${owner}/${repo}/commit/${encodeURIComponent(commit)}`;
}
