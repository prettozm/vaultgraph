// Authenticated fetch for private repositories (fine-grained token).
//
// The viewer's loader fetches files from raw.githubusercontent.com and detects
// the default branch via api.github.com — both anonymous, hence "public only".
// A fine-grained token cannot be used against raw.githubusercontent.com, but the
// authenticated Contents API *can* return private file contents (and is
// CORS-enabled). So, when a token is present, we transparently rewrite:
//
//   https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
//     -> https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={ref}
//        with  Authorization: Bearer <token>  and  Accept: application/vnd.github.raw
//
// and add the Authorization header to api.github.com calls. Every other host is
// passed through untouched — the token is NEVER attached to a non-GitHub host.
//
// This is a drop-in `fetchImpl` for resolveTarget/resolveRef/loadVaultGraph;
// with no token it is exactly the identity fetch, so behaviour is unchanged.

import { RAW_HOST } from './github.js';

const API_HOST = 'api.github.com';
const API_VERSION = '2022-11-28';

/**
 * @param {string} token - a GitHub token (fine-grained PAT). Empty/nullish → passthrough.
 * @param {typeof fetch} [baseFetch] - injectable for tests; defaults to globalThis.fetch.
 * @returns {typeof fetch} a fetch function usable as loader `fetchImpl`.
 */
export function makeAuthFetch(token, baseFetch) {
  const base = baseFetch || ((...args) => globalThis.fetch(...args));
  if (!token) return base;
  const bearer = `Bearer ${token}`;

  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    let u;
    try {
      u = new URL(url);
    } catch {
      return base(input, init); // not a parseable URL → leave untouched
    }

    if (u.hostname === API_HOST) {
      const headers = new Headers(init.headers || {});
      headers.set('Authorization', bearer);
      headers.set('X-GitHub-Api-Version', API_VERSION);
      return base(url, { ...init, headers });
    }

    if (u.hostname === RAW_HOST) {
      const parts = u.pathname.split('/').filter(Boolean);
      // /{owner}/{repo}/{ref}/{...path}
      if (parts.length >= 4) {
        const owner = parts[0];
        const repo = parts[1];
        const ref = decodeURIComponent(parts[2]);
        const filePath = parts
          .slice(3)
          .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
          .join('/');
        const apiUrl = `https://${API_HOST}/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`;
        const headers = new Headers(init.headers || {});
        headers.set('Authorization', bearer);
        headers.set('Accept', 'application/vnd.github.raw');
        headers.set('X-GitHub-Api-Version', API_VERSION);
        return base(apiUrl, { ...init, headers });
      }
    }

    // Any other host (e.g. the public lab repo for the install prompt): no token.
    return base(input, init);
  };
}
