// Query-parameter handling and interpretation of what the user typed.
import { parseGitHubUrl } from './github.js';
import { isAbsoluteHttpUrl } from './urls.js';

/**
 * Read the supported query parameters.
 * `manifest` wins over `repo` when both are present.
 * @param {string} search - e.g. location.search
 */
export function readParams(search) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const repo = params.get('repo');
  const manifest = params.get('manifest');
  const view = params.get('view');
  const projection = params.get('projection');
  return {
    repo: repo && repo.trim() ? repo.trim() : null,
    manifest: manifest && manifest.trim() ? manifest.trim() : null,
    preferred: manifest && manifest.trim() ? 'manifest' : repo && repo.trim() ? 'repo' : null,
    view: normalizeView(view),
    projection: projection && projection.trim() ? projection.trim().toLowerCase() : null,
  };
}

const VIEWS = new Set(['2d', '3d']);

/** Accept only the two known view modes; anything else is ignored. */
export function normalizeView(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return VIEWS.has(v) ? v : null;
}

function looksLikeManifest(value) {
  return /manifest\.json$/i.test(value.split('#')[0].split('?')[0].trim());
}

/**
 * Interpret one free-text field: a GitHub repository URL, or a manifest URL
 * pasted into the same field (accepted when it ends with manifest.json).
 * @param {string} text
 * @param {string} [baseUrl] - used to resolve a relative manifest path
 * @returns {{kind:'repo'|'manifest'|'invalid', value?:string, owner?:string, repo?:string, branch?:string|null, reason?:string}}
 */
export function classifyInput(text, baseUrl) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return { kind: 'invalid', reason: 'Enter a GitHub repository URL.' };

  if (looksLikeManifest(raw)) {
    if (isAbsoluteHttpUrl(raw)) return { kind: 'manifest', value: raw };
    if (baseUrl) {
      try {
        return { kind: 'manifest', value: new URL(raw, baseUrl).toString() };
      } catch {
        /* fall through */
      }
    }
    return { kind: 'invalid', reason: 'That manifest path could not be resolved to a URL.' };
  }

  const parsed = parseGitHubUrl(raw);
  if (parsed) return { kind: 'repo', value: raw, ...parsed };

  return {
    kind: 'invalid',
    reason: 'Expected a public GitHub repository URL (https://github.com/owner/repo) or a manifest.json URL.',
  };
}

/**
 * Build the shareable/bookmarkable URL for a given target (CDC §23).
 * `view` and `projection` are appended only when they add information:
 * the 2D default and an absent projection stay out of the URL.
 * @param {string} baseUrl
 * @param {object} target
 * @param {{view?:string|null, projection?:string|null}} [ui]
 */
export function buildAppUrl(baseUrl, target, ui = {}) {
  const u = new URL(baseUrl);
  u.search = '';
  if (target?.kind === 'manifest') u.searchParams.set('manifest', target.value);
  else if (target?.kind === 'repo') {
    // Prefer the short owner/repo form when we know it (§23).
    const short = target.owner && target.repo ? `${target.owner}/${target.repo}` : target.value;
    u.searchParams.set('repo', target.branch ? target.value : short);
  }
  const view = normalizeView(ui.view);
  if (view === '3d') {
    u.searchParams.set('view', '3d');
    const projection = typeof ui.projection === 'string' ? ui.projection.trim().toLowerCase() : '';
    if (projection) u.searchParams.set('projection', projection);
  }
  return u.toString();
}
