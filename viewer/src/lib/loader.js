// Network orchestration for loading a .vault-graph.
// `fetchImpl` is injected so the whole flow is unit-testable without network.
import { apiRepoUrl, manifestUrlFor, inferRepoFromRawUrl } from './github.js';
import { withCacheBust } from './urls.js';
import { parseJsonl } from './jsonl.js';
import { validateManifest, resolveManifestPaths, readManifestMeta, readSummary } from './manifest.js';

export class LoadError extends Error {
  /**
   * @param {string} message
   * @param {'not-found'|'network'|'http'|'parse'|'format'} code
   * @param {object} [details]
   */
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'LoadError';
    this.code = code;
    this.details = details;
  }
}

const defaultFetch = (...args) => globalThis.fetch(...args);

/** Fetch a URL as text, mapping transport outcomes to LoadError codes. */
export async function fetchText(url, { fetchImpl = defaultFetch, cacheBust = null, what = 'file' } = {}) {
  const target = cacheBust ? withCacheBust(url, cacheBust) : url;
  let response;
  try {
    response = await fetchImpl(target, { cache: 'no-store', redirect: 'follow' });
  } catch (err) {
    throw new LoadError(`Network error while fetching the ${what}.`, 'network', { url, what, cause: String(err) });
  }
  if (response.status === 404) {
    throw new LoadError(`Not found (404): ${what}.`, 'not-found', { url, what, status: 404 });
  }
  if (!response.ok) {
    throw new LoadError(
      `Unexpected HTTP ${response.status} while fetching the ${what}.`,
      'http',
      { url, what, status: response.status }
    );
  }
  return response.text();
}

/**
 * Determine the ref to read a repository at.
 * The default branch is never assumed to be `main` (CDC §19): it is read from
 * the GitHub API, and only if that call fails do we fall back to the `HEAD`
 * ref that raw.githubusercontent.com resolves server-side.
 * @returns {Promise<{ref:string, source:'explicit'|'api'|'head-fallback', note?:string}>}
 */
export async function resolveRef(owner, repo, { fetchImpl = defaultFetch, branch = null } = {}) {
  if (branch) return { ref: branch, source: 'explicit' };
  try {
    const response = await fetchImpl(apiRepoUrl(owner, repo), {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (response.ok) {
      const data = await response.json();
      if (data && typeof data.default_branch === 'string' && data.default_branch) {
        return { ref: data.default_branch, source: 'api' };
      }
      return { ref: 'HEAD', source: 'head-fallback', note: 'GitHub API returned no default_branch.' };
    }
    const note =
      response.status === 403 || response.status === 429
        ? 'GitHub API rate limit reached; using the HEAD ref instead.'
        : `GitHub API returned HTTP ${response.status}; using the HEAD ref instead.`;
    return { ref: 'HEAD', source: 'head-fallback', note };
  } catch (err) {
    return {
      ref: 'HEAD',
      source: 'head-fallback',
      note: 'GitHub API unreachable; using the HEAD ref instead.',
      cause: String(err),
    };
  }
}

/**
 * Turn a target ({kind:'repo'|'manifest'}) into a concrete manifest URL plus
 * whatever repository identity we can establish (used for source links).
 */
export async function resolveTarget(target, { fetchImpl = defaultFetch } = {}) {
  if (target?.kind === 'manifest') {
    const inferred = inferRepoFromRawUrl(target.value);
    return {
      manifestUrl: target.value,
      repo: inferred ? { owner: inferred.owner, repo: inferred.repo, ref: inferred.ref } : null,
      refSource: inferred ? 'manifest-url' : null,
      notes: [],
    };
  }
  if (target?.kind === 'repo') {
    const { owner, repo, branch } = target;
    const resolved = await resolveRef(owner, repo, { fetchImpl, branch });
    return {
      manifestUrl: manifestUrlFor(owner, repo, resolved.ref),
      repo: { owner, repo, ref: resolved.ref },
      refSource: resolved.source,
      notes: resolved.note ? [resolved.note] : [],
    };
  }
  throw new LoadError('No repository or manifest to load.', 'format', { target });
}

/**
 * Fetch and parse the whole protocol payload referenced by a manifest.
 * @returns {Promise<{manifest:object, meta:object, summary:object, summaryAvailable:boolean,
 *                    nodeRecords:object[], edgeRecords:object[], paths:object, warnings:string[]}>}
 */
export async function loadVaultGraph(manifestUrl, { fetchImpl = defaultFetch, cacheBust = null } = {}) {
  const warnings = [];
  const manifestText = await fetchText(manifestUrl, { fetchImpl, cacheBust, what: 'manifest.json' });

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    throw new LoadError('manifest.json is not valid JSON.', 'parse', { url: manifestUrl, cause: String(err) });
  }

  const validation = validateManifest(manifest);
  warnings.push(...validation.warnings);
  if (!validation.ok) {
    throw new LoadError(validation.errors.join(' '), 'format', { url: manifestUrl, errors: validation.errors });
  }

  const paths = resolveManifestPaths(manifest, manifestUrl);

  // graph.json is a summary: useful, but the graph itself is the source of truth.
  let summaryRaw = null;
  let summaryAvailable = false;
  if (paths.graph) {
    try {
      summaryRaw = JSON.parse(await fetchText(paths.graph, { fetchImpl, cacheBust, what: 'graph.json' }));
      summaryAvailable = true;
    } catch (err) {
      warnings.push(`graph.json could not be read (${err.code ?? 'error'}); counts come from the data.`);
    }
  }

  const [nodesText, edgesText] = await Promise.all([
    fetchText(paths.nodes, { fetchImpl, cacheBust, what: 'nodes.jsonl' }),
    fetchText(paths.edges, { fetchImpl, cacheBust, what: 'edges.jsonl' }),
  ]);

  const nodesParsed = parseJsonl(nodesText);
  const edgesParsed = parseJsonl(edgesText);
  for (const e of nodesParsed.errors) warnings.push(`nodes.jsonl line ${e.line}: ${e.message}`);
  for (const e of edgesParsed.errors) warnings.push(`edges.jsonl line ${e.line}: ${e.message}`);

  return {
    manifestUrl,
    manifest,
    meta: readManifestMeta(manifest),
    summary: readSummary(summaryRaw),
    summaryAvailable,
    nodeRecords: nodesParsed.records,
    edgeRecords: edgesParsed.records,
    paths,
    warnings,
    fetchedAt: new Date().toISOString(),
  };
}

/** Compare declared counts with what the data actually contains (CDC §21). */
export function countMismatch(summary, graph) {
  const out = [];
  if (summary?.nodes != null && summary.nodes !== graph.nodes.length) {
    out.push(`graph.json declares ${summary.nodes} nodes but nodes.jsonl yields ${graph.nodes.length}.`);
  }
  if (summary?.edges != null && summary.edges !== graph.edges.length) {
    out.push(`graph.json declares ${summary.edges} edges but edges.jsonl yields ${graph.edges.length}.`);
  }
  return out;
}
