# Changelog

## 0.3.2 — the phone pass (2026-09-04)

Three regressions reported from a real phone, fixed in one pass and verified by a touch-emulated
smoke (`viewer/test/smoke.mjs`, section "touch": a 390 × 844 context with `hasTouch`).

### Relations can be tapped with a finger
- Edge picking runs along the **whole segment** in screen pixels (`viewer/src/lib/hit-test.js`,
  `distanceToSegment` / `nearestSegment`), not within 8 px of the midpoint. The tolerance follows
  the pointer: **22 px** for a finger or any coarse pointer, **10 px** for a mouse. Candidate
  relations keep their dashed look and get the same hit zone.
- Resolution order at a tap: a star wins only when the tap is on it (core radius + 6 px), otherwise
  the nearest relation within tolerance, otherwise the selection is cleared. In 3D the test runs on
  the projected segments; a segment with an endpoint behind the camera is not picked at all.
- Desktop hover brightens the relation under the cursor and shows its name in a small tooltip;
  the cursor is `pointer` over a star *or* a relation.
- A tap no longer leaves a ghost mouse click ~300 ms later: both canvases cancel `touchend`, so a
  tap that opens the inspector sheet cannot then "click" whatever the sheet put under the finger.

### The theme switch has two states and stays on screen
- The header switch is **light ⇄ dark**, with no `system` step. `system` remains a valid stored
  value (old preferences, and the inline bootstrap in `index.html`) and is resolved once at load.
  `aria-pressed` reflects the state and the label always names the next one ("Switch to day mode" /
  "Switch to night mode").
- At 390 px the repo name truncates first; the switch never shrinks and never wraps (40 × 40 target).

### Day = the same constellation, luminance inverted
- The "paper chart" look is gone (`PAPER_GLOW_SCALE` removed). Day is the same renderer on a pale
  sky (`--canvas-bg-top #f7f9fd` → `--canvas-bg-bottom #dfe7f2`), with a soft vignette, ~40 % of the
  night dust in a dark-blue tint (alpha ≤ 0.25), a pale-blue nebula haze (alpha ≤ 0.05), the same
  four size classes and shape cores, the same faint shelves, and constellation edges at alpha 0.18.
- `starTint(type, { dark: false })` blends the type hue 40 % toward a deep navy (`#1e2a44`); stars
  are dark cores with soft tinted halos (normal compositing, no `lighter`) instead of white-hot
  blooms. Pairwise ΔE is asserted for the day palette exactly as for the night one.
- Legend and inspector swatches follow the canvas in both themes (`panels.js typeSwatch`).

### Tunable constants
`viewer/src/lib/hit-test.js` — `TOUCH_TOLERANCE_PX` (22), `MOUSE_TOLERANCE_PX` (10), `NODE_SLOP_PX` (6).
`viewer/src/lib/colors.js` — `STAR_INK` (#1e2a44), `STAR_INK_MIX` (0.4).
`viewer/src/ui/starfield.js` — `LIGHT_PARTICLE_RATIO` (0.4), `LIGHT_PARTICLE_ALPHA` (0.7),
`LIGHT_GLOW_SCALE` (0.5), `NEBULA_BLOBS_LIGHT`, `CORE_SHADE`.

### Known limitations
- The day theme was judged from `viewer/test/smoke-touch-light-2d.png`, not by a human on a phone.
- Touch is emulated by Chromium (`hasTouch`, `isMobile`), not measured on a physical device.

## 0.3.1 — constellation pass (2026-09-04)

Night rendering reworked after review: deeper ground with soft nebula haze and a stronger vignette,
a dense parallax starfield (120 / 350 / 800 stars by quality tier, log-distributed brightness, three
depth bands), node stars with white-hot cores and 5–7× blooms, four brighter anchor stars, pastel
type tints (`starTint`, hue blended toward cool white, pairwise distinguishability tested), constellation
edges fading toward their midpoint, per-node depth jitter inside a layer, shelves reduced to a faint
horizon line with a glowing label dot, continuous slow orbit in 3D that pauses on interaction and
resumes after 6 s. Legend swatches use the same tint as the canvas. Day theme unchanged in intent.
Tunable constants are listed at the top of `viewer/src/ui/starfield.js`.

## 0.3.0 — viewer: living-constellation identity (2026-09-04)

Visual redesign of both canvases; the `.vault-graph` protocol is untouched.

### Identity
- Night theme is the default (the identity); the header switch offers the day variant and the choice is remembered. Deep navy → black gradient ground, soft vignette, a sparse field of dim dust drifting
  very slowly; day theme keeps the same design on a paper ground. The theme switch stays.
- Nodes are stars: type hue (unchanged palette, lifted for dark ground) + type shape core (circle,
  square `source`, diamond `decision`, triangle `hypothese`), four size classes by degree, soft
  pre-rendered halos, gentle twinkle. Edges are faint luminous lines that brighten only around the
  selection, hover or focus set. Everything outside the focus is dimmed (eased), never removed.
- Motion is ambient only and carries no information: drift, twinkle, dust, a very slow idle orbit
  in 3D that stops on interaction or selection. `prefers-reduced-motion` turns it off by default.

### Encoding (also in the legend's "Reading" group)
| Channel | Meaning |
|---|---|
| Hue | node type (or epistemic status when a 3D projection colours by status) |
| Shape core | type family |
| Size · brightness | degree (more relations = bigger, brighter) |
| Warm ring / halo | selected · hovered · search match |
| Dashed ring / dashed edge | candidate · unresolved (proposed, not a fact) |
| Dimmed | outside the current focus |
| Shelf height (3D) | layer of the current projection |
| Motion | ambient only |

### Controls
- `View` popover: Ambient motion, Labels (Auto · Hover · All · Off), Edges, Glow (Off · Low ·
  Medium · High), Layers (Flat · Layered · Expanded, 3D), Quality (Auto · Low · High), Reset.
  A `Layers` control also sits in the toolbar in 3D. Preferences are stored in the browser;
  `&labels=` and `&layers=` are shareable in the URL.
- Labels are placed without overlap (important ones first: selection, hover, matches, focus).

### Layers
- Flat / Layered / Expanded change the vertical spread of the projection shelves with a short
  easing; in Flat the layer names stay listed at the left so the semantics remain readable.

### Performance
- Quality tiers: Auto picks Low above 450 nodes or under 480 px width; Low disables dust,
  sprites and twinkle. Halos are cached sprites, edges are batched per style, labels capped at 300,
  the animation loop runs only while the tab is visible and motion is on.

### Known limitations
- Motion, easing and idle orbit are validated by tests and code review, not by a human watching
  the running app; tune `viewer/src/ui/starfield.js` constants if it reads as restless.
- Not measured on low-end phones; the Quality tiers describe intent, not benchmarks.
- Label collision avoidance is greedy: at very high density some secondary labels are skipped.

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
- Private repositories: an optional fine-grained token (Contents: read) on the home screen routes
  reads through the authenticated GitHub Contents API; without a token behaviour is unchanged.
- Error taxonomy: repository not found, private/inaccessible, invalid manifest, unsupported version,
  missing graph file, invalid JSON, network — no stack traces.

### Tooling
- `scripts/validate-vault.mjs` checks the optional `node.date` is ISO-8601.
- `scripts/rebuild-graph-summary.mjs` recomputes `graph.json` from the JSONL data.
- The demo graph dates its three decisions from explicit statements in the sources (build.md revision 4).

### Known limitations
- Private repositories require a token pasted by the viewer's user (kept in that browser only).
- 3D layout is a projection of the 2D layout, not a 3D force simulation: layers are readable, but
  nodes of one layer keep their 2D arrangement.
- Touch gestures were validated with pointer events in headless Chromium, not on a physical device.
- Label collisions are not resolved; labels are limited by zoom level instead.

## 0.1.0 — protocol, template, install prompt, viewer, tooling (2026-09-02/03)
Initial delivery of the CDC v0.1: `.vault-graph` embedded protocol, bootstrap ZIP, single-prompt install,
zero-dependency 2D viewer, validation pipeline, GitHub Pages and release workflows, synthetic demo vault.
