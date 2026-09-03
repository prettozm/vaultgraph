# Vault Graph

> **Vault Graph is a portable protocol that lets any Git repository expose a contextualized, traceable, reconstructible graph representation of its content through a single `.vault-graph` folder; its generation and its visualization are deliberately decoupled.**

Vault Graph is three independent pieces:

```text
YOUR REPO
     │
     └── .vault-graph/
              │
              │ contract + derived state
              ▼
       UNIVERSAL VIEWER
              │
              ▼
       explorable graph
```

An AI agent builds or updates `.vault-graph/`. The universal viewer never builds the graph — it only **reads and projects** one that already exists. Repo, engine, and viewer are all independently replaceable; Git provides the history, `.vault-graph` provides the contract.

## Quick start

### Method A — download the ZIP

1. Download `vault-graph-bootstrap.zip` from the [latest release](../../releases/latest).
2. Extract it at the root of your repository (it adds a `.vault-graph/` folder, nothing else).
3. Ask your agent:

   > Lis `.vault-graph/INSTRUCTIONS.md` et initialise le Vault Graph de ce dépôt.

### Method B — one Claude prompt

1. Copy [`dist/CLAUDE_INSTALL_PROMPT.md`](dist/CLAUDE_INSTALL_PROMPT.md).
2. Replace `<REPO_URL>` with your repository's URL.
3. Paste the whole prompt to Claude. It will access the repo, create `.vault-graph/`, adapt the config, scan your sources, generate the first graph and reports, and validate the result — without touching any file outside `.vault-graph/`.

### Everyday update

Once installed, keep the graph current with:

> Lis .vault-graph/INSTRUCTIONS.md et mets à jour le Vault Graph.

## Open the viewer

The viewer is published at **https://prettozm.github.io/vaultgraph/**.

Paste a public GitHub repository URL and click **Load graph**. Notes:

- v0 supports **public repositories only**; the default branch is detected automatically, it does not assume `main`.
- The viewer never rebuilds the graph — **Refresh** only refetches the `.vault-graph` already committed in the repo.
- `generated_at` (in `manifest.json`) is when the graph was produced; `fetched_at` is when the viewer downloaded it. The date that matters to you is `generated_at`.

You can also open the viewer with query parameters instead of typing the URL:

```text
viewer/src/index.html?repo=https://github.com/owner/repo
viewer/src/index.html?manifest=<url to a manifest.json>
```

If Pages is not yet enabled on your fork, set the repository's **Settings → Pages → Source** to **GitHub Actions**; `pages.yml` takes care of the rest on every push to `main`.

## What is in `.vault-graph/`

| File / folder | Role |
|---|---|
| `manifest.json` | Universal entry point: paths, format version, `generated_at`, source commit, generator |
| `config.yaml` | What this repo considers its vault: include/exclude globs, reconciliation policy, write scope |
| `schema.yaml` | The local grammar: node types, relation types, epistemic states — the viewer never hardcodes these |
| `INSTRUCTIONS.md` | What the agent reads to scan, reconcile, write, and validate |
| `graph/` | `graph.json`, `nodes.jsonl`, `edges.jsonl` — the actual graph |
| `state/state.json` | Last run: source commit, per-file hashes, for incremental updates |
| `reports/` | `build.md`, `candidates.md`, `unresolved.md` — what happened, what's uncertain, what's orphaned |

## Invariants

Every durable node or relation must be traceable to a source; anything without one is marked `candidate` or `unresolved` rather than asserted as fact. The same label does not imply the same concept — reconciliation checks for an existing match before creating a new node, and ambiguous matches stay `candidate` rather than being silently merged. A fully connected graph is not a goal: orphan nodes are allowed as long as they carry an explicit reason. Hypotheses are never silently promoted to confirmed facts.

## Repository layout

```text
vaultgraph/
├── README.md
├── CDC.md
├── LICENSE
│
├── template/
│   └── .vault-graph/        # the protocol template, copied by the bootstrap
│
├── .vault-graph/            # this repo's own demo graph, built over fixtures/demo-vault
│
├── fixtures/
│   └── demo-vault/          # synthetic sample vault used to exercise the protocol
│
├── dist/
│   ├── vault-graph-bootstrap.zip
│   └── CLAUDE_INSTALL_PROMPT.md
│
├── viewer/
│   ├── src/
│   └── dist/                # built output, published to GitHub Pages
│
├── scripts/
│   ├── validate-template.mjs
│   └── build-bootstrap.mjs
│
└── .github/
    └── workflows/
        ├── pages.yml
        ├── release.yml
        └── ci.yml
```

## Fixture

`.vault-graph/` at the root of this repo is a demo graph generated over `fixtures/demo-vault/`, a synthetic surrogate vault. The CDC's original reference fixture (a BrainUniverse vault) was not available for this build, so a synthetic vault was used instead to exercise the same protocol end to end.

## Development

```bash
npm ci
npm test              # validates template + root .vault-graph, checks the ZIP is reproducible, builds the viewer
npm run build:bootstrap   # regenerates dist/vault-graph-bootstrap.zip from template/.vault-graph/ — never hand-edit the ZIP
npm run build:viewer      # builds the static viewer into viewer/dist
```

To try the viewer locally against a local manifest:

```bash
npx http-server -p 8080 .
# then open:
# http://127.0.0.1:8080/viewer/src/index.html?manifest=http://127.0.0.1:8080/.vault-graph/manifest.json
```

## Publishing

- **Pages (mode "GitHub Actions", recommended)**: `.github/workflows/pages.yml` runs `npm test`, builds `viewer/dist` and deploys it on every push to `main`; `configure-pages` enables Pages on a fresh repository. The viewer is then the site root.
- **Pages (mode "Deploy from a branch", `main` / root)**: also works — `.nojekyll` makes GitHub serve the repository as-is (Jekyll would otherwise skip `.vault-graph/`), and the root `index.html` opens `viewer/src/`. In this mode the `pages.yml` run fails at `configure-pages` by design; switch the source to "GitHub Actions" to use it.
- **Releases**: pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`, which verifies the bootstrap ZIP is up to date and attaches `dist/vault-graph-bootstrap.zip` and `dist/CLAUDE_INSTALL_PROMPT.md` to a GitHub Release.

## Roadmap

- **V0** (this repo): agent → `.vault-graph` → viewer, entirely manual triggers.
- **V1**: a deterministic CLI takes over scanning/diffing, with an LLM used only for semantic reconciliation.
- **V2**: a GitHub Action updates `.vault-graph` automatically on push, without changing the base contract.

## Non-goals

Vault Graph is not a database, not Neo4j/RDF/OWL/SPARQL, not a RAG or vector engine, not a mandatory backend server, not an auth/SaaS/user-management system, not a document editor, not an agent orchestrator, and not a full plugin system. It stays the smallest system that demonstrates the protocol.

## Spec

The full specification is [`CDC.md`](CDC.md).

## License

MIT — see [`LICENSE`](LICENSE).
