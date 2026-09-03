# scripts/

Node scripts (`type: module`, ESM `.mjs`, zero runtime dependency besides
the `yaml` devDependency) that implement the vault-graph protocol's
validation and packaging pipeline. Every script prints human-readable
`OK`/`FAIL`/`WARN` lines and exits `1` if any check fails.

## `validate-template.mjs`

```
node scripts/validate-template.mjs
```

Validates `template/.vault-graph/` against the protocol shape: all 11
required paths present, JSON/YAML parse, JSONL files are empty or
well-formed, `manifest.json` is internally consistent and its referenced
paths exist, `generated_at` is `null` or ISO-8601, and `state/state.json`
has the right shape. Since this is the template, `generated_at` and
`source.commit` are allowed to be `null`.

Exit 0 on success, 1 on any FAIL.

## `validate-vault.mjs <dir>`

```
node scripts/validate-vault.mjs .vault-graph
```

Runs the same structural checks as `validate-template.mjs` on a real vault
directory (here `generated_at` and `source.commit` must be non-null), then
the CDC invariants:

- node ids unique and match `^[a-z0-9_-]+:[a-z0-9-]+$`; edge ids unique
- every node `type` is declared in `schema.nodes`; every edge `relation`
  in `schema.relations`; every node/edge `status` in
  `schema.epistemic_states`
- every edge's `from`/`to` resolves to an existing node (no dangling edges)
- a node/edge with empty or missing `sources` must have status
  `candidate` or `unresolved`
- a degree-0 node ("orphan") must carry a non-empty string `reason`
- every `sources[].file` is a path (relative to the vault's parent
  directory) that exists in the repository — reported as FAIL if missing
- `manifest.generated_at` == `graph.json.generated_at`, and
  `manifest.source.commit` == `graph.json.source_commit`
- `graph.json.counts` and the `by_type`/`by_relation`/`by_context`/
  `by_status` maps agree with the actual nodes/edges
- `state/state.json` file hashes are checked against current file
  contents: a mismatch or a file that no longer exists is a WARN (the repo
  may have moved on since the last run) — unless that file no longer
  exists yet is still referenced by a node/edge `sources[].file`, which is
  a FAIL

Prints a one-line summary (`nodes=`, `edges=`, `orphans=`, `candidates=`,
`unresolved=`). Exit 0 on success, 1 on any FAIL.

## `build-bootstrap.mjs`

```
node scripts/build-bootstrap.mjs            # writes dist/vault-graph-bootstrap.zip
node scripts/build-bootstrap.mjs --out <p>  # writes to a custom path instead
node scripts/build-bootstrap.mjs --check    # build in memory, diff vs. the
                                             # committed zip, write nothing
```

Zero-dependency, byte-for-byte deterministic ZIP writer: every file under
`template/.vault-graph/` (files only, including empty ones) becomes an
entry `.vault-graph/<relative path>`, entries sorted by path with forward
slashes. Determinism comes from a fixed DOS date/time
(2026-01-01 00:00:00) on every entry, no extra fields, unix mode `0644` in
the external attributes, and `zlib.deflateRawSync(buf, {level:9})` (or
`store` when deflate isn't smaller). Implements local file headers, the
central directory, and the EOCD record by hand — no archiver dependency.

Prints the resulting sha256 and the entry list. `--check` exits 1 if the
committed `dist/vault-graph-bootstrap.zip` differs from a fresh build
(this is what keeps a stale committed zip from passing CI), otherwise
exits 0 and writes nothing.

## `verify.mjs`

```
node scripts/verify.mjs      # == npm run verify == npm test
```

Runs, in order:

1. `validate:template`
2. `validate:vault` — only if `.vault-graph/manifest.json` exists at the
   repo root; otherwise prints `SKIP validate:vault (no root .vault-graph)`
   and moves on
3. `build:bootstrap` reproducibility: builds the bootstrap zip twice to
   throwaway files under `scripts/__verify_tmp__/` (removed afterwards),
   asserts the two builds are byte-identical, then asserts the committed
   `dist/vault-graph-bootstrap.zip` matches a fresh build (`--check`)
4. `build:viewer` (`npm --prefix viewer run build`)

Each step prints `OK`/`FAIL`/`SKIP`; the process exits non-zero if any
step failed.

## `lib/common.mjs`

Shared helpers used by the scripts above: JSON/YAML/JSONL readers that
report parse failures through a `Reporter`, ISO-8601 validation, sha256
hashing, and `validateStructure()` — the structural check shared by
`validate-template.mjs` and `validate-vault.mjs` (parameterized by whether
`generated_at`/`source.commit` are required to be non-null). Not a
standalone script — no `main`/CLI entry point.

## check-install-prompt.mjs

Extracts the fenced protocol files embedded in `dist/CLAUDE_INSTALL_PROMPT.md` and compares
each byte-for-byte with `template/.vault-graph/`. Run by `npm run verify`. Exit 1 on drift.

## rebuild-graph-summary.mjs <vault-dir> [--touch]

Recomputes `graph/graph.json` histograms and counts from the JSONL data; `--touch` stamps a
new `generated_at` into graph.json, manifest.json and `state.json.last_run`. Seed of the V1
deterministic CLI (CDC §39): the summary is derived, never hand-written.
