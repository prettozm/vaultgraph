// manifest.json contract handling. Pure functions.
import { resolveRelative } from './urls.js';

export const FORMAT = 'vault-graph';

/** Keys pointing at protocol files, relative to the manifest directory. */
export const PATH_KEYS = ['graph', 'nodes', 'edges', 'config', 'schema'];

/**
 * Validate a parsed manifest against the v0.1 contract.
 * `errors` are fatal (the viewer must not pretend to render a graph);
 * `warnings` are tolerated gaps.
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validateManifest(manifest) {
  const errors = [];
  const warnings = [];

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['manifest.json is not a JSON object'], warnings };
  }
  if (manifest.format !== FORMAT) {
    errors.push(
      `Unexpected manifest format ${JSON.stringify(manifest.format ?? null)} — expected "${FORMAT}".`
    );
  }
  for (const key of ['nodes', 'edges']) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim()) {
      errors.push(`manifest.${key} is missing — the viewer cannot locate the ${key} file.`);
    }
  }
  if (typeof manifest.graph !== 'string' || !manifest.graph.trim()) {
    warnings.push('manifest.graph is missing — summary counts will be derived from the data only.');
  }
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    warnings.push('manifest.version is missing.');
  }
  if (manifest.generated_at !== null && manifest.generated_at !== undefined) {
    if (typeof manifest.generated_at !== 'string' || Number.isNaN(new Date(manifest.generated_at).getTime())) {
      warnings.push('manifest.generated_at is not a valid ISO-8601 timestamp.');
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Normalised, defensive view of the manifest metadata used by the UI. */
export function readManifestMeta(manifest) {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const source = m.source && typeof m.source === 'object' ? m.source : {};
  const generator = m.generator && typeof m.generator === 'object' ? m.generator : {};
  return {
    format: typeof m.format === 'string' ? m.format : null,
    version: typeof m.version === 'string' ? m.version : null,
    generatedAt: typeof m.generated_at === 'string' ? m.generated_at : null,
    sourceType: typeof source.type === 'string' ? source.type : null,
    commit: typeof source.commit === 'string' && source.commit.trim() ? source.commit.trim() : null,
    branch: typeof source.branch === 'string' && source.branch.trim() ? source.branch.trim() : null,
    generatorType: typeof generator.type === 'string' ? generator.type : null,
    generatorName: typeof generator.name === 'string' ? generator.name : null,
  };
}

/**
 * Resolve every manifest path against the manifest URL's directory.
 * @returns {Record<string, string|null>}
 */
export function resolveManifestPaths(manifest, manifestUrl) {
  const out = {};
  for (const key of PATH_KEYS) {
    const value = manifest && typeof manifest === 'object' ? manifest[key] : null;
    out[key] = typeof value === 'string' && value.trim() ? resolveRelative(manifestUrl, value) : null;
  }
  return out;
}

/** Normalised view of graph.json (all fields optional). */
export function readSummary(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};
  const counts = s.counts && typeof s.counts === 'object' ? s.counts : {};
  const dict = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return {
    generatedAt: typeof s.generated_at === 'string' ? s.generated_at : null,
    sourceCommit: typeof s.source_commit === 'string' ? s.source_commit : null,
    nodes: Number.isFinite(counts.nodes) ? counts.nodes : null,
    edges: Number.isFinite(counts.edges) ? counts.edges : null,
    byType: dict(s.by_type),
    byRelation: dict(s.by_relation),
    byContext: dict(s.by_context),
    byStatus: dict(s.by_status),
  };
}
