#!/usr/bin/env node
// Recomputes <vault>/graph/graph.json from the JSONL data (counts, by_type, by_context on
// nodes; by_relation on edges; by_status on nodes AND edges — see INSTRUCTIONS.md §11).
// With --touch, also stamps a new generated_at (UTC) into graph.json, manifest.json and
// state.json.last_run. Zero dependencies. Usage: node scripts/rebuild-graph-summary.mjs <vault-dir> [--touch]
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: rebuild-graph-summary.mjs <vault-dir> [--touch]"); process.exit(2); }
const touch = process.argv.includes("--touch");
const readJsonl = (p) => fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const tally = (items, key) => {
  const out = {};
  for (const it of items) { const k = it[key] ?? "(unset)"; out[k] = (out[k] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
};
const merge = (a, b) => { const out = { ...a }; for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v; return Object.fromEntries(Object.entries(out).sort(([x], [y]) => x.localeCompare(y))); };

const gPath = path.join(dir, "graph", "graph.json");
const mPath = path.join(dir, "manifest.json");
const sPath = path.join(dir, "state", "state.json");
const graph = JSON.parse(fs.readFileSync(gPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(mPath, "utf8"));
const state = JSON.parse(fs.readFileSync(sPath, "utf8"));
const nodes = readJsonl(path.join(dir, "graph", "nodes.jsonl"));
const edges = readJsonl(path.join(dir, "graph", "edges.jsonl"));

const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const generatedAt = touch ? now : graph.generated_at;
const next = {
  format: graph.format ?? "vault-graph",
  version: graph.version ?? "0.1",
  generated_at: generatedAt,
  source_commit: manifest.source?.commit ?? graph.source_commit ?? null,
  counts: { nodes: nodes.length, edges: edges.length },
  by_type: tally(nodes, "type"),
  by_relation: tally(edges, "relation"),
  by_context: tally(nodes, "context"),
  by_status: merge(tally(nodes, "status"), tally(edges, "status")),
};
fs.writeFileSync(gPath, JSON.stringify(next, null, 2) + "\n");
if (touch) {
  manifest.generated_at = generatedAt;
  fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2) + "\n");
  state.last_run = generatedAt;
  fs.writeFileSync(sPath, JSON.stringify(state, null, 2) + "\n");
}
console.log(JSON.stringify({ generated_at: generatedAt, counts: next.counts, by_relation: next.by_relation, by_status: next.by_status }, null, 2));
