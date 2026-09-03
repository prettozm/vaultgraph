#!/usr/bin/env node
// Validates template/.vault-graph/ against the vault-graph protocol shape.
// Exit 0 on success, 1 on any FAIL.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { Reporter, validateStructure } from "./lib/common.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const vaultDir = path.join(repoRoot, "template", ".vault-graph");

const reporter = new Reporter("validate:template");

if (!existsSync(vaultDir)) {
  reporter.fail(`template vault directory not found: ${vaultDir}`);
  const ok = reporter.summary();
  process.exit(ok ? 0 : 1);
}

validateStructure(vaultDir, reporter, { requireNonNullDates: false });

const ok = reporter.summary();
process.exit(ok ? 0 : 1);
