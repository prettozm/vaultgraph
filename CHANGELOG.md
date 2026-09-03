# Changelog

## 0.2.0 — viewer: semantic 3D projections and mobile-first UI (2026-09-03)

The `.vault-graph` protocol is unchanged except for one **optional, backward-compatible** node field:
`date` (ISO-8601 at the known precision, only when the source states it — see INSTRUCTIONS.md §3).
Graphs without it keep working; the Time projection then falls back to relation order or is unavailable.

### Viewer
- **3D view** as a projection of the same graph: X/Y = the 2D force layout, Z = meaning. Rendered on the
  existing canvas with zero dependencies (no three.js, no CDN). Orbit, zoom, pan, tap-select, recenter,
  fit, reset; faint labelled layer planes so the Z axis reads at a glance.
- **Projections** (selector, 3D only): Context (Z = context; homonyms land on distinct layers), Time (Z =
  `date` buckets when dates exist, else ordinal order along `precede`/`raffine`/`supersede`/`derive_de`,
  undated nodes in their own layer, unavailable when neither exists), Provenance (Z = primary source
  file), Knowledge (aboutness = concepts vs substance = besoin/cas_usage/fonctionnalite/decision/hypothese
  vs other), Epistemic (Z = declared status, colour by status). Unavailable projections are disabled with
  their reason — nothing is invented.
- **Mobile-first layout**: compact header (repo · version · "Generated N min ago" with exact UTC on tap ·
  commit · Refresh · theme), stats strip with `Candidates (n)` / `Unresolved (n)` quick actions, toolbar
  `2D | 3D` + projection + search + Filters, filters in a bottom sheet (side panel on desktop), inspector
  as a bottom sheet / right panel. ≥ 70 % of the viewport goes to the graph on a phone.
- **Inspector redesign**: label first, type/context/status chips, counts, collapsible Sources / Relations /
  Metadata; candidate relations carry an explicit "proposed, not a fact" note; ids last.
- **Search** selects, centres, opens the inspector and emphasises the 1-hop neighbourhood; **Focus**
  1 hop / 2 hops / All fades the rest of the graph.
- **Visual encoding**: shape by type (circle, square `source`, diamond `decision`, triangle `hypothese`),
  size by degree, dashed thin candidate relations, dashed halo on candidate/unresolved nodes, selective
  labels (never all at once beyond ~40 nodes). Legend explains shapes and statuses, not colour alone.
- Dark mode (`prefers-color-scheme` + toggle), local prefs (view, projection, theme, last repo),
  shareable URLs `?repo=owner/repo&view=3d&projection=context`.
- Error taxonomy: repository not found, private/inaccessible, invalid manifest, unsupported version,
  missing graph file, invalid JSON, network — no stack traces.

### Tooling
- `scripts/validate-vault.mjs` checks the optional `node.date` is ISO-8601.
- `scripts/rebuild-graph-summary.mjs` recomputes `graph.json` from the JSONL data.
- The demo graph dates its three decisions from explicit statements in the sources (build.md revision 4).

### Known limitations
- Public GitHub repositories only (unauthenticated raw fetch).
- 3D layout is a projection of the 2D layout, not a 3D force simulation: layers are readable, but
  nodes of one layer keep their 2D arrangement.
- Touch gestures were validated with pointer events in headless Chromium, not on a physical device.
- Label collisions are not resolved; labels are limited by zoom level instead.

## 0.1.0 — protocol, template, install prompt, viewer, tooling (2026-09-02/03)
Initial delivery of the CDC v0.1: `.vault-graph` embedded protocol, bootstrap ZIP, single-prompt install,
zero-dependency 2D viewer, validation pipeline, GitHub Pages and release workflows, synthetic demo vault.
