# Vault Graph — universal viewer

Static, zero-dependency web application that **reads and projects** a `.vault-graph/`
already produced in a Git repository. It never builds the graph (CDC §1, §26).

- Plain HTML + CSS + ES modules. No bundler, no CDN, no runtime dependency.
- Own 2D force-directed layout on `<canvas>` (pan, zoom, select, recenter, search).
- Filters (type, context, epistemic status, provenance) are discovered from the data.
- Shows `generated_at` (graph freshness) separately from `fetched_at` (page fetch).

## Load a graph

| Input | Behaviour |
|---|---|
| `?repo=https://github.com/owner/repo` | resolves the default branch via the GitHub API (falls back to the `HEAD` ref on raw.githubusercontent.com), then fetches `.vault-graph/manifest.json` |
| `?repo=https://github.com/owner/repo/tree/branch` | uses that branch |
| `?manifest=<absolute URL>` | loads a manifest directly (overrides `repo`) — used for local testing and future local viewers |

The home screen accepts the same values in its input field.

## Develop

```bash
cd viewer
npm test          # unit tests (node:test), no network
npm run build     # copies src/ to dist/ (dist/ is git-ignored; GitHub Pages publishes it)
```

Try it locally against the repository's own demo graph:

```bash
# from the repository root
npx http-server -p 8080 .
# then open
# http://127.0.0.1:8080/viewer/src/index.html?manifest=http://127.0.0.1:8080/.vault-graph/manifest.json
```

A small sample vault lives in `test/fixtures/.vault-graph/` for unit tests.

## Smoke test (optional, needs Playwright + Chromium available to Node)

```bash
node test/smoke.mjs   # starts a local static server, drives Chromium, writes test/smoke.png
```

## Layout

```
viewer/
├── build.mjs        # copy src/ → dist/
├── src/
│   ├── index.html
│   ├── styles.css
│   ├── app.js       # application shell / screens
│   ├── lib/         # pure, unit-tested modules (github, urls, manifest, jsonl, graph-model, layout…)
│   └── ui/          # DOM helpers, panels, canvas graph view
└── test/            # *.test.mjs unit tests + fixtures/
```
