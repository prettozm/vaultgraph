#!/usr/bin/env node
// Orchestrates the vault-graph verification pipeline:
//   1. validate:template
//   2. validate:vault (only if a root .vault-graph/manifest.json exists)
//   3. build:bootstrap reproducibility (build twice in memory, compare sha256;
//      then assert the committed dist zip matches a fresh build)
//   4. build:viewer
//
// Each step prints OK/FAIL/SKIP. Exits non-zero if any step fails.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "./lib/common.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

let hadFailure = false;

function step(name, fn) {
  console.log(`\n=== ${name} ===`);
  const result = fn();
  if (result === "SKIP") {
    console.log(`SKIP ${name}`);
  } else if (result === false) {
    console.log(`FAIL ${name}`);
    hadFailure = true;
  } else {
    console.log(`OK ${name}`);
  }
}

function run(cmd, cmdArgs, opts = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    cwd: repoRoot,
    ...opts,
  });
  return res.status === 0;
}

step("validate:template", () => run(process.execPath, ["scripts/validate-template.mjs"]));

step("validate:vault", () => {
  const manifestPath = path.join(repoRoot, ".vault-graph", "manifest.json");
  if (!existsSync(manifestPath)) {
    console.log("SKIP validate:vault (no root .vault-graph)");
    return "SKIP";
  }
  return run(process.execPath, ["scripts/validate-vault.mjs", ".vault-graph"]);
});

step("check:install-prompt", () => run(process.execPath, ["scripts/check-install-prompt.mjs"]));

step("build:bootstrap (reproducibility)", () => {
  // Scripts write only within the repo's write scope: keep the two throwaway
  // builds under scripts/ and remove them before returning.
  const workDir = path.join(repoRoot, "scripts", "__verify_tmp__");
  rmSync(workDir, { recursive: true, force: true });
  const outA = path.join(workDir, "a.zip");
  const outB = path.join(workDir, "b.zip");
  try {
    const okA = run(process.execPath, ["scripts/build-bootstrap.mjs", "--out", outA]);
    const okB = run(process.execPath, ["scripts/build-bootstrap.mjs", "--out", outB]);
    if (!okA || !okB) return false;
    const hashA = sha256Hex(readFileSync(outA));
    const hashB = sha256Hex(readFileSync(outB));
    if (hashA !== hashB) {
      console.error(`FAIL two fresh builds differ: ${hashA} != ${hashB}`);
      return false;
    }
    console.log(`OK two fresh builds are byte-identical (sha256 ${hashA})`);

    const checkOk = run(process.execPath, ["scripts/build-bootstrap.mjs", "--check"]);
    if (!checkOk) {
      console.error("FAIL committed dist/vault-graph-bootstrap.zip does not match a fresh build");
      return false;
    }
    return true;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

step("test:viewer", () => run("npm", ["--prefix", "viewer", "test"]));
step("build:viewer", () => run("npm", ["--prefix", "viewer", "run", "build"]));

console.log("");
if (hadFailure) {
  console.log("verify: FAIL");
  process.exit(1);
} else {
  console.log("verify: OK");
  process.exit(0);
}
