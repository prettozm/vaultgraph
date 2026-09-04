# Vault Graph — universal viewer

Static, zero-dependency web application that **reads and projects** a `.vault-graph/`
already produced in a Git repository. It never builds the graph (CDC §1, §26).

- Plain HTML + CSS + ES modules. No bundler, no CDN, no runtime dependency, no backend.
- Own 2D force-directed layout on `<canvas>` (pan, zoom, select, recenter, search),
  plus an optional 3D view that projects the **same** graph along a meaningful Z axis.
- Mobile-first: compact header, collapsible filters, the graph keeps ~70–80 % of the screen.
- Filters (type, context, epistemic status, provenance, relation, relation status) are
  discovered from the data — no vocabulary is hardcoded.
- Shows `generated_at` (graph freshness) separately from `fetched_at` (page fetch).
- A night "living constellation" theme and a light paper variant of the same design,
  with a compact **View** panel (motion, labels, edges, glow, layers, quality).
- Light / dark theme, local preferences, shareable URLs.

## 2D and 3D

`[ 2D | 3D ]` in the toolbar switches views. Both consume the same `graph.json` and the
same layout simulation, so positions (and your selection) survive the switch.

- **2D** is always available and is the fallback whenever the 3D module is missing or
  fails to load; the viewer then shows *"3D view unavailable — staying in 2D"* and keeps
  working.
- **3D** adds a `Projection ▾` selector. A projection whose data does not exist in the
  graph is listed but disabled, with the reason in its tooltip — an unavailable projection
  is preferred over an invented one (CDC §26).

| Projection | Z axis answers |
|---|---|
| `context` | how concepts spread across bounded contexts, and where contexts touch |
| `time` | how knowledge evolves (needs temporal metadata; `undated` layer otherwise) |
| `provenance` | which document a piece of knowledge comes from |
| `knowledge` | what a document *is about* (aboutness) vs what it *asserts* (substance) |
| `epistemic` | where the graph is stable, candidate or unresolved |

## Reading the graph

| Channel | Meaning |
|---|---|
| Shape | node type — circle (default), square `source`, diamond `decision`, triangle `hypothese` |
| Colour | node type (a stable hue derived from the type name) |
| Size | degree (number of incident relations), square-rooted and clamped |
| Dashed halo | node is `candidate` / `unresolved`, or has no recorded source |
| Thin dashed edge | `candidate` relation or a relation with no source — never shown as confirmed |
| Amber ring | search match; solid ring: current selection |
| Brightness & size | degree again — a brighter, bigger star has more relations |
| Warm halo | selected or hovered |
| Dimmed | outside the current focus or quick action |
| Shelves | the layers of the current 3D projection |

Motion is ambient only: it carries **no** information. Nothing is encoded in a drift, a
pulse or a rotation, so turning motion off (see **View** below, or arriving with
`prefers-reduced-motion`) removes nothing you could otherwise read.

Those five sentences are also printed in the **Reading** group of the legend, so the
encoding never depends on having read this file. On mobile the legend folds to two lines
and collapses with the chevron; the fold is remembered.

Labels are drawn selectively (selection, hover, matches, focused neighbourhood, then the
highest-degree nodes as zoom allows) so the canvas stays readable with hundreds of nodes —
unless you ask for something else in **View → Labels**.

### View settings

`View`, at the right of the second toolbar row, opens a small panel: anchored under the
button on desktop, a bottom sheet on mobile. `Escape`, a click outside or `✕` closes it.
Every control is keyboard-reachable, carries an `aria-label` and has a ≥ 40 px target.

| Control | Values | What it changes |
|---|---|---|
| Ambient motion | on / off | the idle drift and the ambient particles. Default: **off** when the system asks for reduced motion, **on** otherwise |
| Labels | Auto · Hover · All · Off | `Auto` is the selective budget above; `All` gets dense on a large graph |
| Edges | on / off | hides the relations to read the node cloud alone — a drawing change, not a filter |
| Glow | Off · Low · Medium · High | the luminosity of the stars; `Off` is the flattest and the cheapest |
| Layers | Flat · Layered · Expanded | how far apart the projection shelves sit on the Z axis. **3D only** — in 2D the row is disabled and marked *3D view* |
| Quality | Auto · Low · High | rendering effort (see *Performance* below) |
| Reset view settings | — | back to the defaults, including "motion follows the system" |

In 3D, `Layers` is mirrored as a segmented control directly in the toolbar: the multilayer
reading is what the 3D view exists for, so it never hides behind a menu.

These settings are **presentation only**. They never filter, never change the counts and
never change what the graph asserts.

### Performance

`Quality` decides how much the renderers spend per frame (device-pixel ratio, glow passes,
label budget). `Auto` adapts to the device; `Low` is the one to pick on a modest machine
or a large graph; `High` forces the full treatment. Two cheaper levers when a graph feels
heavy: `Glow: Off` and `Edges: off`. Turning **Ambient motion** off stops the animation
loop entirely, which is the largest saving of all — and costs no information.

### Actions

- **Candidates (n) / Unresolved (n)** in the stats strip filter to those items, fade the
  rest and open the first one in the inspector. They stay visible (disabled) at zero.
- **Focus 1 hop / 2 hops / All** emphasises the neighbourhood of the selected node.
- **Search** (`/` focuses it) matches label, alias and id; picking a result centres the
  node, selects it, opens the inspector and flashes its direct neighbourhood.
- **Recenter / Fit / Reset view** re-frame the camera; `Escape` closes panels, then the
  selection. `Refresh` re-fetches `.vault-graph` — it never rebuilds the graph.

## Load a graph

| Input | Behaviour |
|---|---|
| `?repo=https://github.com/owner/repo` | resolves the default branch via the GitHub API (falls back to the `HEAD` ref on raw.githubusercontent.com), then fetches `.vault-graph/manifest.json` |
| `?repo=https://github.com/owner/repo/tree/branch` | uses that branch |
| `?repo=owner/repo` | same, short form |
| `?manifest=<absolute URL>` | loads a manifest directly (overrides `repo`) — used for local testing and future local viewers |
| `&view=2d\|3d` | optional: start in that view |
| `&projection=<id>` | optional: start on that 3D projection (only meaningful with `view=3d`) |
| `&labels=auto\|hover\|all\|off` | optional: start with that label mode |
| `&layers=flat\|layered\|expanded` | optional: start with that layer spread (3D only) |

The home screen accepts the same values in its input field. The current view, projection
and non-default visual options are written back into the URL with `history.replaceState`,
so the address bar is always shareable. Defaults are never written: `view=2d`,
`labels=auto` and `layers=layered` stay out of the URL, and `layers` is never emitted
next to a 2D view. An unknown value is ignored rather than guessed.

## Theme

The header toggle cycles `system → light → dark`. `system` (the default) follows
`prefers-color-scheme` live — with no stored choice on a light machine, the viewer stays
light; the switch is always there.

- **Dark** is a deep navy/black cosmic ground with luminous nodes. The chrome sits *on*
  that ground: translucent panels with a blur where the browser supports it, 1 px borders
  at ~14 % white, and the warm glow used sparingly for active states only.
- **Light** is the same design as paper: a calm off-white ground, the same shapes, the
  same encoding.

Both renderers read the ground from CSS custom properties (`--canvas-bg`, `--canvas-bg-top`
/ `-bottom`, `--canvas-vignette`, `--canvas-particle`, `--canvas-edge`,
`--canvas-edge-focus`, `--canvas-glow`, `--canvas-plane`, `--canvas-label`,
`--canvas-label-soft`, `--canvas-halo`), declared in all three theme blocks (`:root`,
`:root[data-theme="dark"]` and the `prefers-color-scheme: dark` block). The canvas
container is painted with `--canvas-bg`, so switching theme never flashes.

## Local preferences

`localStorage` only (key `vault-graph.prefs.v1`), no backend, every access guarded:
view mode, projection, theme (`system` / `light` / `dark`), the legend fold, the last
repository (pre-filled on the home screen) and the visual options:

```json
"visual": { "animation": null, "labels": "auto", "edges": true,
            "glow": "medium", "layers": "layered", "quality": "auto" }
```

`animation: null` means *not chosen*: it is resolved at read time against
`prefers-reduced-motion`, so a reduced-motion machine gets a still constellation until
someone says otherwise, and "Reset view settings" gives that behaviour back. Every stored
value is validated on read — an unknown enum falls back to its default instead of reaching
a renderer. A blocked, full or private-mode storage silently falls back to defaults. URL
parameters win over stored preferences.

## Limitations

- Public GitHub repositories only: no authentication, no private repos, no proxy.
- The GitHub API is used unauthenticated (60 requests/hour/IP); on a rate limit the viewer
  falls back to the `HEAD` ref and says so in the data notes.
- The layout is recomputed on load, not persisted: node positions differ between sessions
  (they are deterministic for a given graph and canvas size).
- The 3D view is a projection of the same 2D layout; it does not re-run a 3D force layout.
- Comfortable up to a few hundred nodes; no clustering or level-of-detail beyond selective
  labelling.
- The viewer never writes: no graph editing, no candidate validation, no vault change.

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
NODE_PATH=/opt/node22/lib/node_modules node test/smoke.mjs
# starts a local static server, drives Chromium on a desktop (1280×800) and a mobile
# (390×844) viewport, and writes test/smoke-desktop.png and test/smoke-mobile.png
```

It checks the header (generation date, commit), the stats strip, the filters drawer, the
search → inspector path, the `Candidates` shortcut, and that on mobile the canvas starts
above 45 % of the viewport and keeps at least 55 % of its height. It then drives the
**View** panel (motion off, `Labels: All`, edges off, `Glow: High`, `Layers: Expanded`
then `Flat` from the toolbar mirror), asserts that the options reached `localStorage` and
the URL, that `Escape` closes the panel and that "Reset view settings" restores the
defaults. The 3D assertions run only when `dist/ui/graph-view-3d.js` exists.

Screenshots written: `smoke-desktop.png`, `smoke-mobile.png`, one per 3D projection,
`smoke-3d-expanded.png` / `smoke-3d-flat.png`, and `smoke-dark.png` — the dark 3D Context
hero shot the visual identity is judged on.

## Layout

```
viewer/
├── build.mjs        # copy src/ → dist/
├── src/
│   ├── index.html
│   ├── styles.css
│   ├── app.js       # application shell / screens
│   ├── lib/         # pure, unit-tested modules (github, urls, manifest, jsonl, graph-model,
│   │                #   layout, projections, colors, format, params, prefs…)
│   └── ui/          # DOM helpers, panels, 2D canvas graph view, 3D graph view
└── test/            # *.test.mjs unit tests + fixtures/
```
