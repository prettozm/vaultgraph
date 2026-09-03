#!/usr/bin/env node
// Validates a real .vault-graph/ directory: structural shape (shared with
// validate-template.mjs) plus the CDC invariants (ids, references, counts,
// provenance, orphans, state freshness).
//
// Usage: node scripts/validate-vault.mjs <path-to-vault-dir>
// Exit 0 on success, 1 on any FAIL.

import path from "node:path";
import { existsSync } from "node:fs";
import { Reporter, validateStructure, sha256File } from "./lib/common.mjs";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/validate-vault.mjs <path-to-vault-dir>");
  process.exit(1);
}

const vaultDir = path.resolve(process.cwd(), arg);
const repoParent = path.resolve(vaultDir, "..");

const reporter = new Reporter("validate:vault");

if (!existsSync(vaultDir)) {
  reporter.fail(`vault directory not found: ${vaultDir}`);
  const ok = reporter.summary();
  process.exit(ok ? 0 : 1);
}

const { manifest, schemaDoc, graphDoc, nodes, edges, state } = validateStructure(
  vaultDir,
  reporter,
  { requireNonNullDates: true },
);

const nodeTypes = schemaDoc && Array.isArray(schemaDoc.nodes) ? schemaDoc.nodes : [];
const relations = schemaDoc && Array.isArray(schemaDoc.relations) ? schemaDoc.relations : [];
const epistemicStates =
  schemaDoc && Array.isArray(schemaDoc.epistemic_states) ? schemaDoc.epistemic_states : [];

const ID_RE = /^[a-z0-9_-]+:[a-z0-9-]+$/;

function hasSources(entity) {
  return Array.isArray(entity.sources) && entity.sources.length > 0;
}

// --- Node id uniqueness + shape -------------------------------------------
const nodeIds = new Set();
const nodeById = new Map();
let dupNodeIds = 0;
let badNodeIds = 0;
for (const node of nodes) {
  if (typeof node.id !== "string") {
    reporter.fail(`node missing string id: ${JSON.stringify(node)}`);
    continue;
  }
  if (!ID_RE.test(node.id)) {
    badNodeIds += 1;
    reporter.fail(`node id does not match ^[a-z0-9_-]+:[a-z0-9-]+$: ${node.id}`);
  }
  if (nodeIds.has(node.id)) {
    dupNodeIds += 1;
    reporter.fail(`duplicate node id: ${node.id}`);
  }
  nodeIds.add(node.id);
  nodeById.set(node.id, node);
}
if (nodes.length > 0) {
  reporter.check(dupNodeIds === 0, "node ids are unique", `${dupNodeIds} duplicate node id(s)`);
  reporter.check(badNodeIds === 0, "node ids match required pattern", `${badNodeIds} malformed node id(s)`);
}

// --- Edge id uniqueness -----------------------------------------------------
const edgeIds = new Set();
let dupEdgeIds = 0;
for (const edge of edges) {
  if (typeof edge.id !== "string") {
    reporter.fail(`edge missing string id: ${JSON.stringify(edge)}`);
    continue;
  }
  if (edgeIds.has(edge.id)) {
    dupEdgeIds += 1;
    reporter.fail(`duplicate edge id: ${edge.id}`);
  }
  edgeIds.add(edge.id);
}
if (edges.length > 0) {
  reporter.check(dupEdgeIds === 0, "edge ids are unique", `${dupEdgeIds} duplicate edge id(s)`);
}

// --- type/relation/status enums ---------------------------------------------
let badNodeType = 0;
let badNodeStatus = 0;
for (const node of nodes) {
  if (nodeTypes.length && !nodeTypes.includes(node.type)) {
    badNodeType += 1;
    reporter.fail(`node ${node.id ?? "?"}: type "${node.type}" not in schema.nodes`);
  }
  if (epistemicStates.length && !epistemicStates.includes(node.status)) {
    badNodeStatus += 1;
    reporter.fail(`node ${node.id ?? "?"}: status "${node.status}" not in schema.epistemic_states`);
  }
}
if (nodes.length > 0) {
  reporter.check(badNodeType === 0, "all node types are declared in schema.nodes", `${badNodeType} node(s) with undeclared type`);
  reporter.check(badNodeStatus === 0, "all node statuses are declared in schema.epistemic_states", `${badNodeStatus} node(s) with undeclared status`);
}

let badEdgeRelation = 0;
let badEdgeStatus = 0;
let danglingEdges = 0;
for (const edge of edges) {
  if (relations.length && !relations.includes(edge.relation)) {
    badEdgeRelation += 1;
    reporter.fail(`edge ${edge.id ?? "?"}: relation "${edge.relation}" not in schema.relations`);
  }
  if (epistemicStates.length && !epistemicStates.includes(edge.status)) {
    badEdgeStatus += 1;
    reporter.fail(`edge ${edge.id ?? "?"}: status "${edge.status}" not in schema.epistemic_states`);
  }
  const fromOk = nodeIds.has(edge.from);
  const toOk = nodeIds.has(edge.to);
  if (!fromOk || !toOk) {
    danglingEdges += 1;
    reporter.fail(`edge ${edge.id ?? "?"}: dangling reference (from=${edge.from}, to=${edge.to})`);
  }
}
if (edges.length > 0) {
  reporter.check(badEdgeRelation === 0, "all edge relations are declared in schema.relations", `${badEdgeRelation} edge(s) with undeclared relation`);
  reporter.check(badEdgeStatus === 0, "all edge statuses are declared in schema.epistemic_states", `${badEdgeStatus} edge(s) with undeclared status`);
  reporter.check(danglingEdges === 0, "no dangling edges", `${danglingEdges} dangling edge(s)`);
}

// --- Provenance: empty/missing sources => candidate or unresolved ----------
let badProvenanceNodes = 0;
for (const node of nodes) {
  if (!hasSources(node)) {
    if (!["candidate", "unresolved"].includes(node.status)) {
      badProvenanceNodes += 1;
      reporter.fail(
        `node ${node.id ?? "?"}: has no sources but status is "${node.status}" (must be candidate or unresolved)`,
      );
    }
  }
}
let badProvenanceEdges = 0;
for (const edge of edges) {
  if (!hasSources(edge)) {
    if (!["candidate", "unresolved"].includes(edge.status)) {
      badProvenanceEdges += 1;
      reporter.fail(
        `edge ${edge.id ?? "?"}: has no sources but status is "${edge.status}" (must be candidate or unresolved)`,
      );
    }
  }
}
if (nodes.length > 0) {
  reporter.check(
    badProvenanceNodes === 0,
    "sourceless nodes are candidate/unresolved",
    `${badProvenanceNodes} sourceless node(s) with a non-candidate/unresolved status`,
  );
}
if (edges.length > 0) {
  reporter.check(
    badProvenanceEdges === 0,
    "sourceless edges are candidate/unresolved",
    `${badProvenanceEdges} sourceless edge(s) with a non-candidate/unresolved status`,
  );
}

// --- Orphans: degree-0 nodes need a non-empty reason ------------------------
const degree = new Map();
for (const id of nodeIds) degree.set(id, 0);
for (const edge of edges) {
  if (nodeIds.has(edge.from)) degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
  if (nodeIds.has(edge.to)) degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
}
let orphanCount = 0;
let badOrphanReason = 0;
for (const node of nodes) {
  if ((degree.get(node.id) ?? 0) === 0) {
    orphanCount += 1;
    if (typeof node.reason !== "string" || node.reason.trim() === "") {
      badOrphanReason += 1;
      reporter.fail(`node ${node.id ?? "?"}: degree-0 (orphan) but missing non-empty "reason"`);
    }
  }
}
if (nodes.length > 0) {
  reporter.check(
    badOrphanReason === 0,
    "all orphan nodes carry a reason",
    `${badOrphanReason} orphan node(s) missing a reason`,
  );
}

// --- Sources file existence -------------------------------------------------
let missingSourceFiles = 0;
const allSourceFiles = new Set();
function checkSources(entity, kind) {
  if (!Array.isArray(entity.sources)) return;
  for (const src of entity.sources) {
    if (!src || typeof src.file !== "string" || src.file.length === 0) {
      reporter.fail(`${kind} ${entity.id ?? "?"}: source entry missing "file"`);
      continue;
    }
    allSourceFiles.add(src.file);
    const resolved = path.resolve(repoParent, src.file);
    if (!existsSync(resolved)) {
      missingSourceFiles += 1;
      reporter.fail(`${kind} ${entity.id ?? "?"}: source file does not exist: ${src.file}`);
    }
  }
}
for (const node of nodes) checkSources(node, "node");
for (const edge of edges) checkSources(edge, "edge");
if (nodes.length + edges.length > 0) {
  reporter.check(
    missingSourceFiles === 0,
    "all sources[].file paths exist in the repository",
    `${missingSourceFiles} source file(s) referenced but missing`,
  );
}

// --- manifest <-> graph.json cross-checks -----------------------------------
if (manifest && graphDoc) {
  reporter.check(
    manifest.generated_at === graphDoc.generated_at,
    "manifest.generated_at == graph.generated_at",
    `manifest.generated_at (${JSON.stringify(manifest.generated_at)}) != graph.generated_at (${JSON.stringify(graphDoc.generated_at)})`,
  );
  const manifestCommit = manifest.source && manifest.source.commit;
  reporter.check(
    manifestCommit === graphDoc.source_commit,
    "manifest.source.commit == graph.source_commit",
    `manifest.source.commit (${JSON.stringify(manifestCommit)}) != graph.source_commit (${JSON.stringify(graphDoc.source_commit)})`,
  );
}

// --- graph.json counts / by_* tallies ---------------------------------------
if (graphDoc) {
  const actualNodeCount = nodes.length;
  const actualEdgeCount = edges.length;
  reporter.check(
    graphDoc.counts && graphDoc.counts.nodes === actualNodeCount,
    `graph.counts.nodes == ${actualNodeCount}`,
    `graph.counts.nodes (${graphDoc.counts?.nodes}) != actual node count (${actualNodeCount})`,
  );
  reporter.check(
    graphDoc.counts && graphDoc.counts.edges === actualEdgeCount,
    `graph.counts.edges == ${actualEdgeCount}`,
    `graph.counts.edges (${graphDoc.counts?.edges}) != actual edge count (${actualEdgeCount})`,
  );

  function tally(items, field) {
    const t = {};
    for (const item of items) {
      const key = item[field];
      if (key === undefined || key === null) continue;
      t[key] = (t[key] ?? 0) + 1;
    }
    return t;
  }
  function sameTally(actual, declared, label) {
    const declaredObj = declared && typeof declared === "object" ? declared : {};
    const keys = new Set([...Object.keys(actual), ...Object.keys(declaredObj)]);
    let mismatches = 0;
    for (const key of keys) {
      if ((actual[key] ?? 0) !== (declaredObj[key] ?? 0)) mismatches += 1;
    }
    reporter.check(
      mismatches === 0,
      `graph.${label} matches actual tallies`,
      `graph.${label} disagrees with actual tallies (${mismatches} mismatched key(s))`,
    );
  }
  sameTally(tally(nodes, "type"), graphDoc.by_type, "by_type");
  sameTally(tally(edges, "relation"), graphDoc.by_relation, "by_relation");
  sameTally(tally(nodes, "context"), graphDoc.by_context, "by_context");
  const statusTally = tally(nodes, "status");
  const edgeStatusTally = tally(edges, "status");
  for (const [k, v] of Object.entries(edgeStatusTally)) {
    statusTally[k] = (statusTally[k] ?? 0) + v;
  }
  sameTally(statusTally, graphDoc.by_status, "by_status");
}

// --- state.json freshness ----------------------------------------------------
if (state && state.files && typeof state.files === "object") {
  for (const [file, meta] of Object.entries(state.files)) {
    const resolved = path.resolve(repoParent, file);
    const stillReferenced = allSourceFiles.has(file);
    if (!existsSync(resolved)) {
      if (stillReferenced) {
        reporter.fail(
          `state.files["${file}"]: file no longer exists but is still referenced as a source`,
        );
      } else {
        reporter.warn(`state.files["${file}"]: file no longer exists (stale state entry)`);
      }
      continue;
    }
    if (typeof meta?.sha256 === "string") {
      const currentHash = sha256File(resolved);
      if (currentHash !== meta.sha256) {
        reporter.warn(`state.files["${file}"]: sha256 does not match current content (repo has moved on)`);
      }
    }
  }
}

// --- Summary -----------------------------------------------------------------
const candidateCount = nodes.filter((n) => n.status === "candidate").length;
const unresolvedCount = nodes.filter((n) => n.status === "unresolved").length;
console.log("");
console.log(
  `summary: nodes=${nodes.length} edges=${edges.length} orphans=${orphanCount} candidates=${candidateCount} unresolved=${unresolvedCount}`,
);

const ok = reporter.summary();
process.exit(ok ? 0 : 1);
