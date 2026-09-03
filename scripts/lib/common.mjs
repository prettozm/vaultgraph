// Shared helpers for the vault-graph validation scripts.
// Zero runtime dependency beyond Node core + the `yaml` package.

import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import YAML from "yaml";

export const REQUIRED_RELATIVE_PATHS = [
  "manifest.json",
  "config.yaml",
  "schema.yaml",
  "INSTRUCTIONS.md",
  "graph/graph.json",
  "graph/nodes.jsonl",
  "graph/edges.jsonl",
  "state/state.json",
  "reports/build.md",
  "reports/candidates.md",
  "reports/unresolved.md",
];

const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function isIsoUtcString(value) {
  if (typeof value !== "string") return false;
  if (!ISO_8601_RE.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256File(filePath) {
  return sha256Hex(readFileSync(filePath));
}

/** Simple pass/fail reporter with human-readable output. */
export class Reporter {
  constructor(label) {
    this.label = label;
    this.failures = 0;
    this.warnings = 0;
  }

  ok(message) {
    console.log(`OK   ${message}`);
  }

  fail(message) {
    console.log(`FAIL ${message}`);
    this.failures += 1;
  }

  warn(message) {
    console.log(`WARN ${message}`);
    this.warnings += 1;
  }

  check(condition, okMessage, failMessage) {
    if (condition) {
      this.ok(okMessage);
    } else {
      this.fail(failMessage);
    }
    return condition;
  }

  summary() {
    console.log("");
    if (this.failures > 0) {
      console.log(
        `${this.label}: FAIL (${this.failures} failure(s), ${this.warnings} warning(s))`,
      );
    } else {
      console.log(
        `${this.label}: OK (${this.warnings} warning(s))`,
      );
    }
    return this.failures === 0;
  }
}

export function readJsonFile(filePath, reporter, label) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    reporter.fail(`${label}: cannot read ${filePath} (${err.message})`);
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    reporter.fail(`${label}: invalid JSON in ${filePath} (${err.message})`);
    return undefined;
  }
}

export function readYamlFile(filePath, reporter, label) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    reporter.fail(`${label}: cannot read ${filePath} (${err.message})`);
    return undefined;
  }
  try {
    return YAML.parse(raw);
  } catch (err) {
    reporter.fail(`${label}: invalid YAML in ${filePath} (${err.message})`);
    return undefined;
  }
}

/**
 * Parse a JSONL file. Blank lines are tolerated and skipped.
 * Returns { entries, ok } where entries is an array of parsed objects
 * (only for well-formed lines) and ok is false if any line failed to parse.
 */
export function readJsonlFile(filePath, reporter, label) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    reporter.fail(`${label}: cannot read ${filePath} (${err.message})`);
    return { entries: [], ok: false };
  }
  const lines = raw.split("\n");
  const entries = [];
  let ok = true;
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    try {
      entries.push(JSON.parse(trimmed));
    } catch (err) {
      reporter.fail(
        `${label}: invalid JSON on line ${idx + 1} of ${filePath} (${err.message})`,
      );
      ok = false;
    }
  });
  return { entries, ok };
}

export function isNonEmptyStringArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === "string" && v.length > 0)
  );
}

/**
 * Validate the structural shape shared by template and real vaults.
 * Returns { manifest, configDoc, schemaDoc, graphDoc, nodes, edges, state }
 * (any of which may be undefined if that file failed to parse).
 *
 * @param {string} vaultDir absolute path to the .vault-graph directory
 * @param {Reporter} reporter
 * @param {{ requireNonNullDates: boolean }} opts
 */
export function validateStructure(vaultDir, reporter, opts) {
  const { requireNonNullDates } = opts;

  // 1. All required paths present.
  for (const rel of REQUIRED_RELATIVE_PATHS) {
    const p = path.join(vaultDir, rel);
    reporter.check(
      existsSync(p),
      `present: ${rel}`,
      `missing required path: ${rel}`,
    );
  }

  const manifestPath = path.join(vaultDir, "manifest.json");
  const configPath = path.join(vaultDir, "config.yaml");
  const schemaPath = path.join(vaultDir, "schema.yaml");
  const graphPath = path.join(vaultDir, "graph/graph.json");
  const nodesPath = path.join(vaultDir, "graph/nodes.jsonl");
  const edgesPath = path.join(vaultDir, "graph/edges.jsonl");
  const statePath = path.join(vaultDir, "state/state.json");

  const manifest = existsSync(manifestPath)
    ? readJsonFile(manifestPath, reporter, "manifest.json")
    : undefined;
  const configDoc = existsSync(configPath)
    ? readYamlFile(configPath, reporter, "config.yaml")
    : undefined;
  const schemaDoc = existsSync(schemaPath)
    ? readYamlFile(schemaPath, reporter, "schema.yaml")
    : undefined;
  const graphDoc = existsSync(graphPath)
    ? readJsonFile(graphPath, reporter, "graph/graph.json")
    : undefined;
  const { entries: nodes, ok: nodesOk } = existsSync(nodesPath)
    ? readJsonlFile(nodesPath, reporter, "graph/nodes.jsonl")
    : { entries: [], ok: false };
  const { entries: edges, ok: edgesOk } = existsSync(edgesPath)
    ? readJsonlFile(edgesPath, reporter, "graph/edges.jsonl")
    : { entries: [], ok: false };
  const state = existsSync(statePath)
    ? readJsonFile(statePath, reporter, "state/state.json")
    : undefined;

  if (existsSync(nodesPath)) {
    reporter.check(nodesOk, "graph/nodes.jsonl: well-formed", "graph/nodes.jsonl: malformed lines");
  }
  if (existsSync(edgesPath)) {
    reporter.check(edgesOk, "graph/edges.jsonl: well-formed", "graph/edges.jsonl: malformed lines");
  }

  // 2. manifest.json shape.
  if (manifest) {
    reporter.check(
      manifest.format === "vault-graph",
      "manifest.format == vault-graph",
      `manifest.format must be "vault-graph", got ${JSON.stringify(manifest.format)}`,
    );
    reporter.check(
      manifest.version === "0.1",
      "manifest.version == 0.1",
      `manifest.version must be "0.1", got ${JSON.stringify(manifest.version)}`,
    );

    for (const key of ["graph", "nodes", "edges", "config", "schema"]) {
      const rel = manifest[key];
      const okType = typeof rel === "string" && rel.length > 0;
      reporter.check(
        okType,
        `manifest.${key} is a relative path string`,
        `manifest.${key} must be a non-empty relative path string`,
      );
      if (okType) {
        const resolved = path.join(vaultDir, rel);
        reporter.check(
          existsSync(resolved),
          `manifest.${key} references an existing file (${rel})`,
          `manifest.${key} references a missing file: ${rel}`,
        );
      }
    }

    if (requireNonNullDates) {
      reporter.check(
        isIsoUtcString(manifest.generated_at),
        "manifest.generated_at is a non-null ISO-8601 string",
        `manifest.generated_at must be a non-null ISO-8601 string, got ${JSON.stringify(manifest.generated_at)}`,
      );
    } else {
      reporter.check(
        manifest.generated_at === null || isIsoUtcString(manifest.generated_at),
        "manifest.generated_at is null or ISO-8601",
        `manifest.generated_at must be null or an ISO-8601 string, got ${JSON.stringify(manifest.generated_at)}`,
      );
    }

    const source = manifest.source;
    const sourceOk = source && typeof source === "object" && source.type === "git";
    reporter.check(
      sourceOk,
      "manifest.source.type == git",
      `manifest.source must be an object with type "git", got ${JSON.stringify(source)}`,
    );
    if (sourceOk) {
      if (requireNonNullDates) {
        reporter.check(
          typeof source.commit === "string" && source.commit.length > 0,
          "manifest.source.commit is a non-null string",
          `manifest.source.commit must be a non-null string, got ${JSON.stringify(source.commit)}`,
        );
      } else {
        reporter.check(
          source.commit === null || typeof source.commit === "string",
          "manifest.source.commit is null or a string",
          `manifest.source.commit must be null or a string, got ${JSON.stringify(source.commit)}`,
        );
      }
    }

    const generator = manifest.generator;
    reporter.check(
      generator &&
        typeof generator === "object" &&
        typeof generator.type === "string" &&
        typeof generator.name === "string",
      "manifest.generator has type and name",
      `manifest.generator must be an object with string type and name, got ${JSON.stringify(generator)}`,
    );
  }

  // 3. config.yaml shape.
  if (configDoc) {
    const scan = configDoc.scan;
    reporter.check(
      scan && isNonEmptyStringArray(scan.include),
      "config.scan.include is a non-empty string array",
      "config.scan.include must be a non-empty array of strings",
    );
    reporter.check(
      scan && isNonEmptyStringArray(scan.exclude),
      "config.scan.exclude is a non-empty string array",
      "config.scan.exclude must be a non-empty array of strings",
    );
    const recon = configDoc.reconciliation;
    reporter.check(
      recon &&
        typeof recon.context_first === "boolean" &&
        typeof recon.allow_orphans === "boolean" &&
        recon.uncertain_match &&
        typeof recon.uncertain_match.action === "string" &&
        recon.uncertain_match.action.length > 0,
      "config.reconciliation shape ok",
      "config.reconciliation must have boolean context_first/allow_orphans and a string uncertain_match.action",
    );
    reporter.check(
      isNonEmptyStringArray(configDoc.write_scope),
      "config.write_scope is a non-empty string array",
      "config.write_scope must be a non-empty array of strings",
    );
  }

  // 4. schema.yaml shape.
  if (schemaDoc) {
    reporter.check(
      isNonEmptyStringArray(schemaDoc.nodes),
      "schema.nodes is a non-empty string array",
      "schema.nodes must be a non-empty array of strings",
    );
    reporter.check(
      isNonEmptyStringArray(schemaDoc.relations),
      "schema.relations is a non-empty string array",
      "schema.relations must be a non-empty array of strings",
    );
    reporter.check(
      isNonEmptyStringArray(schemaDoc.epistemic_states),
      "schema.epistemic_states is a non-empty string array",
      "schema.epistemic_states must be a non-empty array of strings",
    );
  }

  // 5. graph/graph.json shape.
  if (graphDoc) {
    reporter.check(
      graphDoc.format === "vault-graph",
      "graph.format == vault-graph",
      `graph.format must be "vault-graph", got ${JSON.stringify(graphDoc.format)}`,
    );
    reporter.check(
      graphDoc.version === "0.1",
      "graph.version == 0.1",
      `graph.version must be "0.1", got ${JSON.stringify(graphDoc.version)}`,
    );
    if (requireNonNullDates) {
      reporter.check(
        isIsoUtcString(graphDoc.generated_at),
        "graph.generated_at is a non-null ISO-8601 string",
        `graph.generated_at must be a non-null ISO-8601 string, got ${JSON.stringify(graphDoc.generated_at)}`,
      );
      reporter.check(
        typeof graphDoc.source_commit === "string" && graphDoc.source_commit.length > 0,
        "graph.source_commit is a non-null string",
        `graph.source_commit must be a non-null string, got ${JSON.stringify(graphDoc.source_commit)}`,
      );
    } else {
      reporter.check(
        graphDoc.generated_at === null || isIsoUtcString(graphDoc.generated_at),
        "graph.generated_at is null or ISO-8601",
        `graph.generated_at must be null or an ISO-8601 string, got ${JSON.stringify(graphDoc.generated_at)}`,
      );
      reporter.check(
        graphDoc.source_commit === null || typeof graphDoc.source_commit === "string",
        "graph.source_commit is null or a string",
        `graph.source_commit must be null or a string, got ${JSON.stringify(graphDoc.source_commit)}`,
      );
    }
    const counts = graphDoc.counts;
    reporter.check(
      counts &&
        Number.isInteger(counts.nodes) &&
        Number.isInteger(counts.edges),
      "graph.counts has integer nodes/edges",
      "graph.counts must have integer nodes and edges",
    );
    for (const key of ["by_type", "by_relation", "by_context", "by_status"]) {
      reporter.check(
        graphDoc[key] && typeof graphDoc[key] === "object" && !Array.isArray(graphDoc[key]),
        `graph.${key} is an object`,
        `graph.${key} must be an object`,
      );
    }
  }

  // 6. state/state.json shape.
  if (state) {
    reporter.check(
      state.last_run === null || isIsoUtcString(state.last_run),
      "state.last_run is null or ISO-8601",
      `state.last_run must be null or an ISO-8601 string, got ${JSON.stringify(state.last_run)}`,
    );
    reporter.check(
      state.source_commit === null || typeof state.source_commit === "string",
      "state.source_commit is null or a string",
      `state.source_commit must be null or a string, got ${JSON.stringify(state.source_commit)}`,
    );
    reporter.check(
      state.files && typeof state.files === "object" && !Array.isArray(state.files),
      "state.files is an object",
      "state.files must be an object",
    );
    if (state.files && typeof state.files === "object") {
      for (const [file, meta] of Object.entries(state.files)) {
        reporter.check(
          meta &&
            typeof meta.sha256 === "string" &&
            /^[0-9a-f]{64}$/.test(meta.sha256),
          `state.files["${file}"].sha256 is 64 hex chars`,
          `state.files["${file}"].sha256 must be a 64-character hex string`,
        );
      }
    }
  }

  return { manifest, configDoc, schemaDoc, graphDoc, nodes, edges, state };
}
