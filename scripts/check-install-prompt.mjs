#!/usr/bin/env node
// Verifies that every protocol file embedded in dist/CLAUDE_INSTALL_PROMPT.md is byte-for-byte
// identical to template/.vault-graph/. The prompt is half of the distribution (CDC §28); a
// template change must never ship silently with a stale prompt. Exit 1 on any mismatch.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROMPT = path.join(ROOT, "dist", "CLAUDE_INSTALL_PROMPT.md");
const TEMPLATE = path.join(ROOT, "template", ".vault-graph");
const REQUIRED = ["manifest.json", "config.yaml", "schema.yaml", "INSTRUCTIONS.md", "graph/graph.json", "state/state.json"];

const lines = fs.readFileSync(PROMPT, "utf8").split("\n");
const embedded = new Map();
for (let i = 0; i < lines.length; i++) {
  const head = /^## `\.vault-graph\/(.+?)`\s*$/.exec(lines[i]);
  if (!head) continue;
  let j = i + 1;
  while (j < lines.length && !/^`{3,}/.test(lines[j])) j++;
  const open = /^(`{3,})/.exec(lines[j] ?? "");
  if (!open) continue;
  const fence = open[1];
  const body = [];
  for (let k = j + 1; k < lines.length; k++) {
    if (lines[k] === fence) { embedded.set(head[1], body.join("\n")); break; }
    body.push(lines[k]);
  }
}

let failures = 0;
const report = (ok, msg) => { console.log(`${ok ? "OK  " : "FAIL"} ${msg}`); if (!ok) failures++; };
for (const rel of REQUIRED) {
  const expected = fs.readFileSync(path.join(TEMPLATE, rel), "utf8").replace(/\n$/, "");
  const actual = embedded.get(rel);
  if (actual === undefined) { report(false, `install prompt embeds .vault-graph/${rel}`); continue; }
  report(actual === expected, `install prompt block for ${rel} matches template/.vault-graph/${rel}`);
}
report(/<REPO_URL>/.test(lines.join("\n")), "install prompt carries the <REPO_URL> placeholder");
console.log(failures ? `check:install-prompt: FAIL (${failures})` : "check:install-prompt: OK");
process.exit(failures ? 1 : 0);
