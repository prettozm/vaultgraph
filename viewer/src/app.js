// Vault Graph viewer — application shell.
//
// The viewer never builds a graph: it reads one that a repository already
// exposes under .vault-graph/ and projects it in 2D or 3D (CDC §1, §26, §33).
import { $ } from './ui/dom.js';
import { createGraphView } from './ui/graph-view.js';
import {
  renderStats,
  renderFilters,
  renderInspector,
  renderWarnings,
  renderLegend,
  renderSearchResults,
} from './ui/panels.js';
import { readParams, classifyInput, buildAppUrl } from './lib/params.js';
import { resolveTarget, loadVaultGraph, countMismatch, fetchText, LoadError } from './lib/loader.js';
import {
  buildGraph,
  discoverFilterValues,
  discoverEdgeValues,
  applyFilters,
  searchNodes,
  neighborhood,
  PROVENANCE_WITHOUT,
} from './lib/graph-model.js';
import { createSimulation } from './lib/layout.js';
import { blobUrl, apiRepoUrl } from './lib/github.js';
import { makeAuthFetch } from './lib/auth-fetch.js';
import { formatCount, formatDate, formatRelative, shortSha } from './lib/format.js';
import { readPrefs, writePrefs, effectiveTheme, resolveVisual, DEFAULT_VISUAL } from './lib/prefs.js';
import { isTentative } from './lib/colors.js';

// Fine-grained token for private repositories. Stored only in this browser;
// used to read the graph through the authenticated GitHub API (see auth-fetch.js).
const TOKEN_KEY = 'vault-graph.token';
function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}
function setToken(value) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode / storage blocked — token just won't persist */
  }
}
function currentFetch() {
  return makeAuthFetch(getToken());
}

const BOOTSTRAP_ZIP =
  'https://github.com/prettozm/vaultgraph/releases/latest/download/vault-graph-bootstrap.zip';
const INSTALL_PROMPT_URL =
  'https://raw.githubusercontent.com/prettozm/vaultgraph/HEAD/dist/CLAUDE_INSTALL_PROMPT.md';

// Used only when the canonical prompt cannot be fetched (offline / rate limit),
// so the incompatible-repo screen stays useful.
const FALLBACK_PROMPT = `[ABRIDGED FALLBACK — the canonical prompt at ${INSTALL_PROMPT_URL} embeds the full protocol files; this short version lists the steps only.]

Install Vault Graph on this repository:

<paste your repository URL here>

1. Access the repository and determine its structure.
2. Create .vault-graph/ (manifest.json, config.yaml, schema.yaml, INSTRUCTIONS.md,
   graph/, state/, reports/).
3. Adapt config.yaml to what this repository considers its vault.
4. Propose the minimal schema.yaml (node types, relations, epistemic states).
5. Scan the sources described by config.yaml.
6. Produce the first graph: graph/graph.json, graph/nodes.jsonl, graph/edges.jsonl.
7. Produce reports/build.md, reports/candidates.md, reports/unresolved.md.
8. Record provenance for every node and edge; anything without provenance must be
   "candidate" or "unresolved" — never invent a source.
9. Validate manifest.json (format "vault-graph") and that every referenced file exists.
10. Do not modify any file outside .vault-graph/.`;

const screens = {
  home: $('#screen-home'),
  loading: $('#screen-loading'),
  incompatible: $('#screen-incompatible'),
  error: $('#screen-error'),
  graph: $('#screen-graph'),
};

const MOBILE = '(max-width: 768px)';

const state = {
  target: null,
  manifestUrl: null,
  repo: null,
  payload: null,
  graph: null,
  facets: null,
  filters: { type: new Set(), context: new Set(), status: new Set(), provenance: new Set(), relation: new Set(), edgeStatus: new Set() },
  selection: null,
  matches: new Set(),
  sim: null,
  view: null,
  view3d: null,
  view3dFailed: false,
  projections: [],
  projection: 'context',
  mode: '2d',
  focusHops: null,
  emphasisTimer: 0,
  quick: null,
  quickNodeIds: null, // node whitelist installed by the Unresolved quick action (never a status filter)
  drawerOpen: false,
  inspectorOpen: false,
  viewOptionsOpen: false,
  prefs: readPrefs(),
  loadToken: 0,
};

/** The only 3D projection whose colour channel carries the epistemic status. */
const STATUS_COLOURED_PROJECTIONS = new Set(['epistemic']);

function isMobile() {
  try {
    return globalThis.matchMedia?.(MOBILE).matches ?? false;
  } catch {
    return false;
  }
}

function activeView() {
  return state.mode === '3d' && state.view3d ? state.view3d : state.view;
}

function showScreen(name) {
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
  if (name !== 'graph') {
    state.view?.stop();
    state.view3d?.stop();
  }
}

// --------------------------------------------------------------------------
// Visual options (v0.3) — one vocabulary, both renderers
// --------------------------------------------------------------------------

/** Stored options with `animation` resolved against prefers-reduced-motion. */
function currentVisual() {
  return resolveVisual(state.prefs.visual);
}

/**
 * Hand the current options to both views. The renderers are Lot R's; every
 * call is optional-chained so the app runs identically before they land.
 */
function pushVisualOptions() {
  const options = { ...currentVisual(), theme: isDark() ? 'dark' : 'light' };
  state.view?.setVisualOptions?.(options);
  state.view3d?.setVisualOptions?.(options);
}

/** Reflect the options into every control that carries a `data-visual` key. */
function renderVisualControls() {
  const visual = currentVisual();
  const in3d = state.mode === '3d';

  for (const button of document.querySelectorAll('[data-visual]')) {
    const key = button.dataset.visual;
    const value = visual[key];
    if (button.dataset.value !== undefined) {
      button.setAttribute('aria-pressed', button.dataset.value === value ? 'true' : 'false');
      // Layers only mean something in 3D; the control stays visible but inert.
      if (key === 'layers') button.disabled = !in3d;
    } else {
      const on = value === true;
      button.setAttribute('aria-checked', on ? 'true' : 'false');
      const text = button.querySelector('[data-switch-text]');
      if (text) text.textContent = on ? 'On' : 'Off';
    }
  }

  const hint = $('#layers-hint');
  if (hint) hint.hidden = in3d;
  const quick = $('#layers-quick');
  if (quick) quick.hidden = !in3d;
}

/** Change one or more options: persist, push to the renderers, reflect, share. */
function setVisual(patch) {
  state.prefs = writePrefs({ visual: patch });
  pushVisualOptions();
  renderVisualControls();
  syncUrl();
}

function resetVisual() {
  setVisual({ ...DEFAULT_VISUAL });
}

/**
 * Anchor the popover under its button. It lives outside the (scrolling)
 * toolbar so nothing clips it, which means its position is ours to set.
 */
function placeViewOptions() {
  const popover = $('#view-options');
  const button = $('#view-options-button');
  if (!popover || !button) return;
  if (isMobile()) {
    // The stylesheet turns it into a bottom sheet: drop every inline override.
    popover.style.top = '';
    popover.style.right = '';
    return;
  }
  const rect = button.getBoundingClientRect();
  popover.style.top = `${Math.round(rect.bottom + 8)}px`;
  popover.style.right = `${Math.max(8, Math.round(globalThis.innerWidth - rect.right))}px`;
}

function openViewOptions() {
  state.viewOptionsOpen = true;
  $('#view-options').hidden = false;
  $('#view-backdrop').hidden = !isMobile();
  $('#view-options-button').setAttribute('aria-expanded', 'true');
  placeViewOptions();
  renderVisualControls();
}

function closeViewOptions() {
  state.viewOptionsOpen = false;
  $('#view-options').hidden = true;
  $('#view-backdrop').hidden = true;
  $('#view-options-button').setAttribute('aria-expanded', 'false');
}

// --------------------------------------------------------------------------
// Theme (§18)
// --------------------------------------------------------------------------

function applyTheme() {
  const choice = state.prefs.theme ?? 'system';
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  const effective = effectiveTheme(choice);
  const toggle = $('#theme-toggle');
  if (toggle) {
    toggle.textContent = effective === 'dark' ? '☾' : '☀';
    toggle.title = `Theme: ${choice} — click to switch`;
    toggle.setAttribute('aria-label', `Colour theme: ${choice}. Switch theme.`);
  }
  state.view?.setTheme?.();
  state.view3d?.setTheme?.();
  // The renderers read the theme through the same options bag as the rest.
  pushVisualOptions();
  return effective;
}

function isDark() {
  return effectiveTheme(state.prefs.theme ?? 'system') === 'dark';
}

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(state.prefs.theme ?? 'system') + 1) % order.length];
  state.prefs = writePrefs({ theme: next });
  applyTheme();
  renderAll();
}

// --------------------------------------------------------------------------
// Loading & error screens (§25)
// --------------------------------------------------------------------------

function setLoading(message, detail = '') {
  $('#loading-message').textContent = message;
  $('#loading-detail').textContent = detail;
  showScreen('loading');
}

function describeError(err) {
  if (!(err instanceof LoadError)) {
    return { title: 'The graph could not be loaded.', message: String(err?.message ?? err), hint: '', detail: '' };
  }
  const detail = [err.details?.url, err.details?.status ? `HTTP ${err.details.status}` : null]
    .filter(Boolean)
    .join(' — ');
  const what = err.details?.what ?? 'file';
  switch (err.code) {
    case 'repo-not-found':
      return {
        title: 'Repository not found.',
        message: 'GitHub does not know this repository.',
        hint: 'Check the owner and the name. Private repositories are not supported in v0.',
        detail,
      };
    case 'repo-private':
      return {
        title: 'Repository not accessible.',
        message: 'This repository is private, or GitHub refused the request.',
        hint: 'The viewer reads public repositories only — no authentication, no backend.',
        detail,
      };
    case 'network':
      return {
        title: 'Network error.',
        message: 'The file could not be reached.',
        hint: 'Check your connection (or the CORS policy of the host), then retry.',
        detail,
      };
    case 'not-found':
      return {
        title: 'A referenced file is missing.',
        message: `The manifest points at ${what}, but it is not there.`,
        hint: 'The .vault-graph folder is incomplete: regenerate the graph in the repository.',
        detail,
      };
    case 'parse':
      return {
        title: 'Invalid JSON.',
        message: err.message,
        hint: 'The file exists but could not be parsed. It has to be regenerated in the repository.',
        detail,
      };
    case 'format':
      return {
        title: 'Unsupported Vault Graph.',
        message: err.message,
        hint: 'The manifest is not a Vault Graph manifest, or announces a format/version this viewer does not read.',
        detail,
      };
    case 'http':
      return { title: 'The graph could not be loaded.', message: 'The server did not return the graph files.', hint: 'Check that the repository is public and that .vault-graph/ is on its default branch.', detail: detail || err.message };
    default:
      return { title: 'The graph could not be loaded.', message: 'An unexpected error occurred while loading the graph.', hint: 'Try Refresh; if it persists, the graph files may be malformed.', detail: detail || err.message };
  }
}

function showIncompatible(target) {
  $('#incompatible-target').textContent = target ?? '';
  $('#copy-status').textContent = '';
  $('#prompt-fallback').hidden = true;
  showScreen('incompatible');
}

function showError(err) {
  const { title, message, hint, detail } = describeError(err);
  $('#error-title').textContent = title;
  $('#error-message').textContent = message;
  $('#error-hint').textContent = hint;
  $('#error-detail').textContent = detail;
  showScreen('error');
}

/**
 * Best-effort: distinguish "no Vault Graph here" from "no such repository"
 * (§25). Any failure of the probe falls back to the incompatible screen.
 * @returns {Promise<'missing'|'private'|'ok'|'unknown'>}
 */
async function probeRepository(repo) {
  if (!repo?.owner || !repo?.repo) return 'unknown';
  try {
    const response = await currentFetch()(apiRepoUrl(repo.owner, repo.repo), {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (response.ok) return 'ok';
    if (response.status === 404) return 'missing';
    if (response.status === 401 || response.status === 403) return 'private';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

async function load(target, { refresh = false } = {}) {
  const token = ++state.loadToken;
  state.target = target;
  const keepUi = refresh && Boolean(state.graph);

  setLoading(
    refresh ? 'Refreshing the graph…' : 'Resolving the repository…',
    target.kind === 'repo' ? `${target.owner}/${target.repo}` : target.value
  );

  const fetchImpl = currentFetch();
  let resolved;
  try {
    resolved = await resolveTarget(target, { fetchImpl });
  } catch (err) {
    if (token === state.loadToken) showError(err);
    return;
  }
  if (token !== state.loadToken) return;

  state.manifestUrl = resolved.manifestUrl;
  state.repo = resolved.repo;
  setLoading('Reading .vault-graph…', resolved.manifestUrl);

  let payload;
  try {
    payload = await loadVaultGraph(resolved.manifestUrl, { fetchImpl, cacheBust: refresh ? Date.now() : null });
  } catch (err) {
    if (token !== state.loadToken) return;
    // A missing manifest means "this repository has no Vault Graph" (§24) —
    // unless the repository itself does not exist or is private (§25).
    if (err instanceof LoadError && err.code === 'not-found' && err.details?.what === 'manifest.json') {
      const probe = target.kind === 'repo' ? await probeRepository(resolved.repo) : 'unknown';
      if (token !== state.loadToken) return;
      if (probe === 'missing') {
        showError(new LoadError('Repository not found.', 'repo-not-found', { url: resolved.manifestUrl }));
      } else if (probe === 'private') {
        showError(new LoadError('Repository not accessible.', 'repo-private', { url: resolved.manifestUrl }));
      } else {
        showIncompatible(resolved.manifestUrl);
      }
    } else {
      showError(err);
    }
    return;
  }
  if (token !== state.loadToken) return;

  payload.warnings.unshift(...resolved.notes);
  state.payload = payload;
  if (target.kind === 'repo' && resolved.repo) {
    state.prefs = writePrefs({ lastRepo: `${resolved.repo.owner}/${resolved.repo.repo}` });
  }
  installGraph(payload, { keepUi });
}

// --------------------------------------------------------------------------
// Graph installation
// --------------------------------------------------------------------------

function intersectSelection(previous, facetValues) {
  const next = new Set();
  if (!previous) return next;
  const available = new Set(facetValues.map((v) => v.value));
  for (const value of previous) if (available.has(value)) next.add(value);
  return next;
}

function installGraph(payload, { keepUi = false } = {}) {
  const graph = buildGraph(payload.nodeRecords, payload.edgeRecords);
  const nodeFacets = discoverFilterValues(graph.nodes);
  const edgeFacets = discoverEdgeValues(graph.edges);
  const facets = { ...nodeFacets, relation: edgeFacets.relation, edgeStatus: edgeFacets.status };

  const previousSelection = keepUi ? state.selection : null;
  const previousFilters = keepUi ? state.filters : null;

  state.graph = graph;
  state.facets = facets;
  state.filters = {
    type: intersectSelection(previousFilters?.type, facets.type),
    context: intersectSelection(previousFilters?.context, facets.context),
    status: intersectSelection(previousFilters?.status, facets.status),
    provenance: intersectSelection(previousFilters?.provenance, facets.provenance),
    relation: intersectSelection(previousFilters?.relation, facets.relation),
    edgeStatus: intersectSelection(previousFilters?.edgeStatus, facets.edgeStatus),
  };
  state.selection =
    previousSelection &&
    ((previousSelection.kind === 'node' && graph.nodeById.has(previousSelection.id)) ||
      (previousSelection.kind === 'edge' && graph.edgeById.has(previousSelection.id)))
      ? previousSelection
      : null;

  const canvas = $('#graph-canvas');
  const rect = canvas.getBoundingClientRect();
  state.sim = createSimulation(graph.nodes, graph.edges, {
    width: Math.max(rect.width || 900, 400),
    height: Math.max(rect.height || 650, 300),
  });
  // Pre-settle so the first frame is already readable; the remaining alpha is
  // spent live in the animation loop.
  state.sim.settle(graph.nodes.length > 900 ? 120 : 200);

  if (!state.view) {
    state.view = createGraphView(canvas, {
      onSelectNode: (id) => selectNode(id, { focus: false }),
      onSelectEdge: (id) => selectEdge(id),
      onClearSelection: () => clearSelection(),
    });
    pushVisualOptions();
  }

  showScreen('graph');
  renderHeader();
  state.view.setData({ graph, sim: state.sim, matches: state.matches });
  state.view3d?.setData?.({ graph, sim: state.sim, matches: state.matches });
  refreshProjections();
  applyAndRender({ recenter: true });
  activeView()?.start?.();
  if (state.selection) openInspector();
}

// --------------------------------------------------------------------------
// Header (§7, §8, §29)
// --------------------------------------------------------------------------

function renderHeader() {
  const { payload, repo } = state;
  const meta = payload?.meta ?? {};
  const summary = payload?.summary ?? {};

  $('#topbar-repo').textContent = repo
    ? `${repo.owner}/${repo.repo}${repo.ref ? ` @ ${repo.ref}` : ''}`
    : payload?.manifestUrl ?? '';
  $('#topbar-version').textContent = meta.version ? `Vault Graph ${meta.version}` : 'Vault Graph (version unknown)';

  const generatedAt = meta.generatedAt ?? summary.generatedAt ?? null;
  const exact = formatDate(generatedAt);
  const generated = $('#topbar-generated');
  generated.textContent = `Generated ${formatRelative(generatedAt)}`;
  generated.title = exact;
  generated.onclick = () => {
    generated.textContent = generated.textContent.startsWith('Generated ' + exact)
      ? `Generated ${formatRelative(generatedAt)}`
      : `Generated ${exact}`;
  };

  const commit = meta.commit ?? summary.sourceCommit ?? null;
  const commitNode = $('#topbar-commit');
  if (commit) {
    commitNode.textContent = `Commit ${shortSha(commit)}`;
    commitNode.title = commit;
    if (repo) {
      commitNode.href = `https://github.com/${repo.owner}/${repo.repo}/commit/${commit}`;
      commitNode.removeAttribute('aria-disabled');
    } else {
      commitNode.removeAttribute('href');
    }
    commitNode.hidden = false;
  } else {
    commitNode.textContent = '';
    commitNode.hidden = true;
  }

  const mismatches = payload?.summaryAvailable ? countMismatch(payload.summary, state.graph) : [];
  const fetched = `Fetched ${formatDate(payload?.fetchedAt, { empty: '—' })} — the date that matters is the generation date.`;
  $('#topbar-fetched').textContent = mismatches.length ? `${fetched} · ${mismatches.join(' ')}` : fetched;
}

// --------------------------------------------------------------------------
// Stats strip, filters, legend, inspector
// --------------------------------------------------------------------------

function facetCount(facetKey, predicate) {
  return (state.facets?.[facetKey] ?? [])
    .filter((entry) => predicate(entry.value))
    .reduce((sum, entry) => sum + entry.count, 0);
}

function candidateEdgeIds() {
  return (state.graph?.edges ?? []).filter((e) => isTentative(e.status)).map((e) => e.id);
}

function unresolvedNodeIds() {
  return (state.graph?.nodes ?? [])
    .filter((n) => isTentative(n.status) || (state.graph.degree.get(n.id) ?? 0) === 0)
    .map((n) => n.id);
}

function quickActions() {
  const candidateCount = candidateEdgeIds().length;
  const unresolvedCount = unresolvedNodeIds().length;
  return [
    {
      kind: 'candidate',
      label: 'Candidates',
      count: candidateCount,
      active: state.quick === 'candidate',
      title: 'Show only candidate relations, fade the rest, and open the first one',
    },
    {
      kind: 'unresolved',
      label: 'Unresolved',
      count: unresolvedCount,
      active: state.quick === 'unresolved',
      title: 'Show unresolved or orphan nodes, fade the rest, and open the first one',
    },
  ];
}

function activeChips() {
  const chips = [];
  for (const [facet, values] of Object.entries(state.filters)) {
    for (const value of values) {
      const label = value === PROVENANCE_WITHOUT ? 'no sources' : value;
      chips.push({ facet, value, label });
    }
  }
  return chips;
}

function activeFilterCount() {
  return Object.values(state.filters).reduce((sum, set) => sum + set.size, 0);
}

function renderStatsStrip(visibleNodes, visibleEdges) {
  renderStats($('#stats'), {
    nodeCount: state.graph.nodes.length,
    edgeCount: state.graph.edges.length,
    visibleNodes,
    visibleEdges,
    quickActions: quickActions(),
    activeChips: activeChips(),
    onQuick: (action) => runQuickAction(action),
    onRemoveChip: (chip) => {
      state.filters[chip.facet].delete(chip.value);
      applyAndRender();
    },
  });
}

function renderFilterPanel() {
  renderFilters($('#filters'), {
    facets: state.facets,
    filters: state.filters,
    onToggle: (facet, value) => {
      const set = state.filters[facet];
      if (set.has(value)) set.delete(value);
      else set.add(value);
      applyAndRender();
    },
    onReset: (facet) => {
      state.filters[facet].clear();
      applyAndRender();
    },
  });
  const count = activeFilterCount();
  const badge = $('#filter-badge');
  badge.textContent = String(count);
  badge.hidden = count === 0;
}

function sourceLinker() {
  if (!state.repo) return null;
  // Provenance always points at the exact commit the graph was built from (§29).
  const ref = state.payload?.meta?.commit ?? state.repo.ref;
  const { owner, repo } = state.repo;
  return (source) =>
    blobUrl({ owner, repo, ref, file: source.file, lineStart: source.line_start, lineEnd: source.line_end });
}

function renderInspectorPanel() {
  renderInspector($('#inspector'), {
    graph: state.graph,
    selection: state.selection,
    linkFor: sourceLinker(),
    onNavigate: (id) => selectNode(id, { focus: true }),
    onSelectEdge: (id) => selectEdge(id),
    emptyHint: 'Tap a node or a relation in the graph, or search by label.',
    dark: isDark(),
  });
}

function renderAll() {
  if (!state.graph) return;
  const { visibleNodeIds, visibleEdgeIds } = applyFilters(state.graph, state.filters);
  renderStatsStrip(visibleNodeIds.size, visibleEdgeIds.size);
  renderFilterPanel();
  renderInspectorPanel();
  renderLegend($('#legend'), {
    typeFacet: state.facets.type,
    statusFacet: state.facets.status,
    dark: isDark(),
    statusFirst: state.mode === '3d' && STATUS_COLOURED_PROJECTIONS.has(state.projection),
    collapsed: state.prefs.legendOpen === false,
    onToggle: (open) => {
      state.prefs = writePrefs({ legendOpen: open });
      renderAll();
      resizeViews();
    },
  });
  renderWarnings($('#warnings'), [...(state.payload?.warnings ?? []), ...state.graph.issues]);
}

/** Facet filters, then the optional quick-action node whitelist (S2: explained orphans with a
 *  non-tentative status must stay visible when the Unresolved action is active). */
function computeVisibility() {
  const { visibleNodeIds, visibleEdgeIds } = applyFilters(state.graph, state.filters);
  if (!state.quickNodeIds) return { visibleNodeIds, visibleEdgeIds };
  const nodes = new Set([...visibleNodeIds].filter((id) => state.quickNodeIds.has(id)));
  const edges = new Set(
    (state.graph.edges ?? []).filter((e) => visibleEdgeIds.has(e.id) && nodes.has(e.from) && nodes.has(e.to)).map((e) => e.id)
  );
  return { visibleNodeIds: nodes, visibleEdgeIds: edges };
}

function applyAndRender({ recenter = false } = {}) {
  const { visibleNodeIds, visibleEdgeIds } = computeVisibility();
  for (const view of [state.view, state.view3d]) {
    if (!view) continue;
    view.setVisible(visibleNodeIds, visibleEdgeIds);
    view.setSelection(state.selection);
    view.setMatches(state.matches);
  }
  if (recenter) activeView()?.recenter?.();

  $('#visible-count').textContent = state.graph.nodes.length
    ? `${formatCount(visibleNodeIds.size)} / ${formatCount(state.graph.nodes.length)} nodes · ${formatCount(visibleEdgeIds.size)} / ${formatCount(state.graph.edges.length)} edges`
    : 'This Vault Graph is empty — no nodes have been generated yet.';

  renderAll();
  updateFocusButtons();
}

// --------------------------------------------------------------------------
// Selection, focus, quick actions
// --------------------------------------------------------------------------

function setEmphasis(idSet) {
  state.emphasis = idSet ?? null;
  for (const view of [state.view, state.view3d]) view?.setEmphasis?.(idSet);
}

function clearSelection() {
  state.selection = null;
  state.focusHops = null;
  setEmphasis(null);
  for (const view of [state.view, state.view3d]) view?.setSelection?.(null);
  closeInspector();
  renderInspectorPanel();
  updateFocusButtons();
}

function selectNode(id, { focus = false, open = true } = {}) {
  state.selection = { kind: 'node', id };
  for (const view of [state.view, state.view3d]) view?.setSelection?.(state.selection);
  if (focus) activeView()?.focusNode?.(id);
  if (open) openInspector();
  renderInspectorPanel();
  updateFocusButtons();
}

function selectEdge(id) {
  state.selection = { kind: 'edge', id };
  for (const view of [state.view, state.view3d]) view?.setSelection?.(state.selection);
  openInspector();
  renderInspectorPanel();
  updateFocusButtons();
}

function updateFocusButtons() {
  const enabled = state.selection?.kind === 'node';
  for (const button of document.querySelectorAll('.focus-group [data-hops]')) {
    button.disabled = !enabled;
    const hops = Number(button.dataset.hops);
    const active = enabled && state.focusHops === hops;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function applyFocus(hops) {
  if (state.selection?.kind !== 'node') return;
  clearTimeout(state.emphasisTimer);
  state.focusHops = hops;
  if (!hops) {
    setEmphasis(null);
  } else {
    setEmphasis(neighborhood(state.graph, state.selection.id, hops));
  }
  activeView()?.focusNode?.(state.selection.id);
  updateFocusButtons();
}

/** Temporary neighbourhood emphasis after a search hit (§12). */
function flashNeighbourhood(id) {
  clearTimeout(state.emphasisTimer);
  setEmphasis(neighborhood(state.graph, id, 1));
  state.emphasisTimer = setTimeout(() => {
    if (state.focusHops) return;
    setEmphasis(null);
  }, 2000);
}

function runQuickAction(action) {
  if (state.quick === action.kind) {
    state.quick = null; state.quickNodeIds = null;
    state.filters.edgeStatus.clear();
    state.filters.status.clear();
    setEmphasis(null);
    applyAndRender();
    return;
  }
  state.quick = action.kind;
  if (action.kind === 'candidate') {
    const edges = (state.graph.edges ?? []).filter((e) => isTentative(e.status));
    state.filters.edgeStatus = new Set(edges.map((e) => e.status));
    const nodeIds = new Set();
    for (const e of edges) {
      nodeIds.add(e.from);
      nodeIds.add(e.to);
    }
    setEmphasis(nodeIds);
    applyAndRender();
    if (edges.length) selectEdge(edges[0].id);
  } else {
    const nodes = (state.graph.nodes ?? []).filter(
      (n) => isTentative(n.status) || (state.graph.degree.get(n.id) ?? 0) === 0
    );
    // Whitelist the tentative AND the degree-0 (explained orphan) nodes — a status filter would
    // hide explicit orphans, the very items this action exists to surface (CDC §14, brief §28).
    state.quickNodeIds = new Set(nodes.map((n) => n.id));
    setEmphasis(new Set(nodes.map((n) => n.id)));
    applyAndRender();
    if (nodes.length) selectNode(nodes[0].id, { focus: true });
  }
}

// --------------------------------------------------------------------------
// Panels: filters drawer & inspector
// --------------------------------------------------------------------------

function openDrawer() {
  state.drawerOpen = true;
  $('#filters-drawer').hidden = false;
  $('#drawer-backdrop').hidden = !isMobile();
  $('#filters-button').setAttribute('aria-expanded', 'true');
  resizeViews();
}

function closeDrawer() {
  state.drawerOpen = false;
  $('#filters-drawer').hidden = true;
  $('#drawer-backdrop').hidden = true;
  $('#filters-button').setAttribute('aria-expanded', 'false');
  resizeViews();
}

function openInspector() {
  state.inspectorOpen = true;
  $('#inspector-panel').hidden = false;
  resizeViews();
}

function closeInspector() {
  state.inspectorOpen = false;
  $('#inspector-panel').hidden = true;
  resizeViews();
}

/** The canvas is re-measured, never re-laid-out: positions stay put (§20, §31). */
function resizeViews() {
  requestAnimationFrame(() => {
    state.view?.resize?.();
    state.view3d?.resize?.();
  });
}

// --------------------------------------------------------------------------
// Search (§12)
// --------------------------------------------------------------------------

function runSearch(query) {
  const ids = searchNodes(state.graph?.nodes ?? [], query);
  state.matches = new Set(ids);
  for (const view of [state.view, state.view3d]) view?.setMatches?.(state.matches);
  const nodes = ids.slice(0, 8).map((id) => state.graph.nodeById.get(id)).filter(Boolean);
  renderSearchResults($('#search-results'), {
    nodes,
    query,
    onPick: (id) => pickSearchResult(id),
  });
  $('#search-input').setAttribute('aria-expanded', query.trim() ? 'true' : 'false');
  return ids;
}

function pickSearchResult(id) {
  $('#search-results').hidden = true;
  $('#search-input').setAttribute('aria-expanded', 'false');
  selectNode(id, { focus: true });
  flashNeighbourhood(id);
}

// --------------------------------------------------------------------------
// 2D / 3D and projections (§9, §10, §26)
// --------------------------------------------------------------------------

function setGraphNote(text) {
  const note = $('#graph-note');
  note.textContent = text ?? '';
  note.hidden = !text;
}

async function ensure3D() {
  if (state.view3d || state.view3dFailed) return state.view3d;
  try {
    const module = await import('./ui/graph-view-3d.js');
    const factory = module.createGraphView3D;
    if (typeof factory !== 'function') throw new Error('createGraphView3D is missing');
    const canvas = $('#graph-canvas-3d');
    state.view3d = factory(canvas, {
      onSelect: (sel) => {
        if (!sel) return clearSelection();
        if (typeof sel === 'string') return selectNode(sel);
        if (sel.kind === 'edge') return selectEdge(sel.id);
        return selectNode(sel.id ?? sel);
      },
      onHover: () => {},
      onViewChange: () => {},
    });
    if (state.graph) state.view3d.setData({ graph: state.graph, sim: state.sim, matches: state.matches });
    pushVisualOptions();
  } catch (err) {
    state.view3dFailed = true;
    state.view3d = null;
    console.warn('3D view unavailable:', err?.message ?? err);
  }
  return state.view3d;
}

async function setMode(mode, { persist = true } = {}) {
  const next = mode === '3d' ? '3d' : '2d';
  if (next === '3d') {
    const view = await ensure3D();
    if (!view) {
      setGraphNote('3D view unavailable in this build — staying in 2D.');
      applyModeButtons('2d');
      state.mode = '2d';
      return;
    }
  }
  state.mode = next;
  applyModeButtons(next);
  $('#projection-wrap').hidden = next !== '3d';
  $('#graph-canvas').hidden = next === '3d';
  $('#graph-canvas-3d').hidden = next !== '3d';
  if (next === '3d') {
    state.view?.stop();
    state.view3d.setVisible(...currentVisibility());
    state.view3d.setSelection(state.selection);
    state.view3d.setMatches(state.matches);
    state.view3d.setEmphasis?.(state.emphasis ?? null);
    state.view3d.setProjection?.(state.projection);
    state.view3d.resize?.();
    state.view3d.start?.();
    setGraphNote(projectionNote(state.projection));
  } else {
    state.view3d?.stop?.();
    state.view?.resize?.();
    state.view?.start?.();
    setGraphNote('');
  }
  // Layers are a 3D affordance: the quick control and the popover row follow the mode.
  renderVisualControls();
  if (state.graph) renderAll();
  if (persist) {
    state.prefs = writePrefs({ view: state.mode, projection: state.projection });
    syncUrl();
  }
}

function applyModeButtons(mode) {
  $('#view-2d').setAttribute('aria-pressed', mode === '2d' ? 'true' : 'false');
  $('#view-3d').setAttribute('aria-pressed', mode === '3d' ? 'true' : 'false');
}

function currentVisibility() {
  const { visibleNodeIds, visibleEdgeIds } = computeVisibility();
  return [visibleNodeIds, visibleEdgeIds];
}

function projectionNote(id) {
  const entry = state.projections.find((p) => p.id === id);
  if (entry && entry.available === false) return `${entry.label} projection unavailable — ${entry.reason ?? 'missing data'}.`;
  return '';
}

async function refreshProjections() {
  const select = $('#projection-select');
  let list = [];
  try {
    const module = await import('./lib/projections.js');
    list = module.listProjections?.(state.graph) ?? [];
  } catch {
    list = [];
  }
  state.projections = list;
  while (select.firstChild) select.removeChild(select.firstChild);
  for (const entry of list) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.available === false ? `${entry.label} (unavailable)` : entry.label;
    option.disabled = entry.available === false;
    if (entry.reason) option.title = entry.reason;
    select.append(option);
  }
  const wanted = list.find((p) => p.id === state.projection && p.available !== false)
    ? state.projection
    : list.find((p) => p.available !== false)?.id ?? state.projection;
  state.projection = wanted;
  select.value = wanted;
}

function setProjection(id) {
  state.projection = id;
  state.view3d?.setProjection?.(id);
  setGraphNote(projectionNote(id));
  state.prefs = writePrefs({ projection: id });
  // A status-coloured projection changes what the legend has to say first.
  if (state.graph) renderAll();
  syncUrl();
}

// --------------------------------------------------------------------------
// Navigation & URL
// --------------------------------------------------------------------------

function syncUrl() {
  if (!state.target) return;
  const visual = currentVisual();
  try {
    history.replaceState(
      {},
      '',
      buildAppUrl(location.href, state.target, {
        view: state.mode,
        projection: state.projection,
        labels: visual.labels,
        layers: visual.layers,
      })
    );
  } catch {
    /* file:// or restricted context — the app still works, just not bookmarkable */
  }
}

function goHome({ push = true } = {}) {
  state.loadToken += 1;
  state.view?.stop();
  state.view3d?.stop?.();
  if (push) pushUrl(new URL(location.href.split('?')[0]).toString());
  $('#home-error').hidden = true;
  showScreen('home');
  $('#repo-input').value = state.prefs.lastRepo ?? '';
  $('#repo-input').focus();
}

function pushUrl(url) {
  try {
    history.pushState({}, '', url);
  } catch {
    /* file:// or restricted context */
  }
}

function targetFromParams(params) {
  if (params.manifest) {
    const classified = classifyInput(params.manifest, location.href);
    if (classified.kind === 'manifest') return classified;
    try {
      return { kind: 'manifest', value: new URL(params.manifest, location.href).toString() };
    } catch {
      return null;
    }
  }
  if (params.repo) {
    const classified = classifyInput(params.repo, location.href);
    return classified.kind === 'invalid' ? null : classified;
  }
  return null;
}

async function bootFromLocation({ push = false } = {}) {
  const params = readParams(location.search);
  state.mode = params.view ?? state.prefs.view ?? '2d';
  state.projection = params.projection ?? state.prefs.projection ?? 'context';
  // URL wins over the stored preference, for the visual options too (§23).
  const fromUrl = {};
  if (params.labels) fromUrl.labels = params.labels;
  if (params.layers) fromUrl.layers = params.layers;
  if (Object.keys(fromUrl).length) state.prefs = writePrefs({ visual: fromUrl });
  applyModeButtons(state.mode);
  renderVisualControls();
  pushVisualOptions();
  const target = targetFromParams(params);
  if (!target) {
    showScreen('home');
    $('#repo-input').value = state.prefs.lastRepo ?? '';
    $('#repo-input').focus();
    return;
  }
  if (push) {
    const visual = currentVisual();
    pushUrl(
      buildAppUrl(location.href, target, {
        view: state.mode,
        projection: state.projection,
        labels: visual.labels,
        layers: visual.layers,
      })
    );
  }
  await load(target);
  if (state.graph && state.mode === '3d') await setMode('3d', { persist: false });
}

// --------------------------------------------------------------------------
// Wiring
// --------------------------------------------------------------------------

function wire() {
  const tokenInput = $('#token-input');
  if (tokenInput) tokenInput.value = getToken();

  $('#home-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (tokenInput) setToken(tokenInput.value.trim());
    const classified = classifyInput($('#repo-input').value, location.href);
    const errorNode = $('#home-error');
    if (classified.kind === 'invalid') {
      errorNode.textContent = classified.reason;
      errorNode.hidden = false;
      return;
    }
    errorNode.hidden = true;
    pushUrl(buildAppUrl(location.href, classified, { view: state.mode, projection: state.projection }));
    load(classified);
  });

  for (const button of document.querySelectorAll('[data-action="home"]')) {
    button.addEventListener('click', () => goHome());
  }
  for (const button of document.querySelectorAll('[data-action="retry"]')) {
    button.addEventListener('click', () => {
      if (state.target) load(state.target, { refresh: true });
      else goHome();
    });
  }

  $('#refresh-button').addEventListener('click', () => {
    if (state.target) load(state.target, { refresh: true });
  });
  $('#theme-toggle').addEventListener('click', cycleTheme);

  $('#view-2d').addEventListener('click', () => setMode('2d'));
  $('#view-3d').addEventListener('click', () => setMode('3d'));
  $('#projection-select').addEventListener('change', (event) => setProjection(event.target.value));

  // View settings: one delegated handler for every `data-visual` control, in
  // the popover and in the 3D quick row alike.
  for (const button of document.querySelectorAll('[data-visual]')) {
    const key = button.dataset.visual;
    button.addEventListener('click', () => {
      if (button.dataset.value !== undefined) setVisual({ [key]: button.dataset.value });
      else setVisual({ [key]: button.getAttribute('aria-checked') !== 'true' });
    });
  }
  $('#view-options-button').addEventListener('click', () =>
    state.viewOptionsOpen ? closeViewOptions() : openViewOptions()
  );
  $('#view-options-close').addEventListener('click', closeViewOptions);
  $('#view-backdrop').addEventListener('click', closeViewOptions);
  $('#view-options-reset').addEventListener('click', () => resetVisual());
  document.addEventListener('click', (event) => {
    if (!state.viewOptionsOpen || isMobile()) return;
    if (!event.target.closest('#view-options') && !event.target.closest('#view-options-button')) {
      closeViewOptions();
    }
  });

  $('#filters-button').addEventListener('click', () => (state.drawerOpen ? closeDrawer() : openDrawer()));
  $('#filters-close').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);
  $('#filters-reset').addEventListener('click', () => {
    for (const set of Object.values(state.filters)) set.clear();
    state.quick = null; state.quickNodeIds = null;
    setEmphasis(null);
    applyAndRender();
  });
  $('#inspector-close').addEventListener('click', () => {
    closeInspector();
  });

  $('#recenter-button').addEventListener('click', () => activeView()?.recenter?.());
  $('#fit-button').addEventListener('click', () => activeView()?.fitAll?.());
  $('#reset-view-button').addEventListener('click', () => {
    state.focusHops = null;
    state.quick = null; state.quickNodeIds = null;
    setEmphasis(null);
    activeView()?.resetView?.();
    updateFocusButtons();
  });
  $('#zoom-in').addEventListener('click', () => activeView()?.zoomBy?.(1.25));
  $('#zoom-out').addEventListener('click', () => activeView()?.zoomBy?.(0.8));

  for (const button of document.querySelectorAll('.focus-group [data-hops]')) {
    button.addEventListener('click', () => applyFocus(Number(button.dataset.hops)));
  }

  let searchTimer = 0;
  const input = $('#search-input');
  input.addEventListener('input', (event) => {
    const value = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(value), 120);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const ids = runSearch(input.value);
    if (ids.length) pickSearchResult(ids[0]);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) runSearch(input.value);
  });
  document.addEventListener('click', (event) => {
    if (!$('#search-results').hidden && !event.target.closest('.search-wrap')) {
      $('#search-results').hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }
  });

  $('#bootstrap-link').href = BOOTSTRAP_ZIP;
  $('#copy-prompt').addEventListener('click', copyInstallPrompt);

  globalThis.addEventListener('popstate', () => bootFromLocation());
  globalThis.addEventListener('resize', () => {
    if (!state.drawerOpen) $('#drawer-backdrop').hidden = true;
    if (state.viewOptionsOpen) {
      $('#view-backdrop').hidden = !isMobile();
      placeViewOptions();
    }
  });
  try {
    globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      applyTheme();
      renderAll();
    });
  } catch {
    /* older browsers: the theme simply does not follow the system live */
  }

  document.addEventListener('keydown', (event) => {
    if (screens.graph.hidden) return;
    if (event.key === 'Escape') {
      if (!$('#search-results').hidden) {
        $('#search-results').hidden = true;
        return;
      }
      if (state.viewOptionsOpen) {
        closeViewOptions();
        $('#view-options-button').focus();
        return;
      }
      if (state.drawerOpen) {
        closeDrawer();
        return;
      }
      if (state.inspectorOpen) {
        closeInspector();
        return;
      }
      clearSelection();
    }
    if (event.key === '/' && document.activeElement !== $('#search-input')) {
      event.preventDefault();
      $('#search-input').focus();
    }
  });
}

async function copyInstallPrompt() {
  const status = $('#copy-status');
  const fallback = $('#prompt-fallback');
  const textarea = $('#prompt-text');
  status.textContent = 'Fetching the install prompt…';

  let text = null;
  try {
    text = await fetchText(INSTALL_PROMPT_URL, { what: 'CLAUDE_INSTALL_PROMPT.md' });
  } catch {
    text = null;
  }
  const finalText = text ?? FALLBACK_PROMPT;

  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(finalText);
      copied = true;
    }
  } catch {
    copied = false;
  }

  textarea.value = finalText;
  if (copied && text) {
    status.textContent = 'Install prompt copied to the clipboard.';
    fallback.hidden = true;
    return;
  }
  fallback.hidden = false;
  if (copied && !text) {
    status.textContent =
      'The canonical prompt could not be fetched. An ABRIDGED fallback (steps only, without the embedded protocol files) was copied and is shown below — fetch dist/CLAUDE_INSTALL_PROMPT.md from the repository for the full version.';
    return;
  }
  status.textContent = text
    ? 'Clipboard unavailable — copy the prompt below.'
    : 'The prompt could not be fetched and the clipboard is unavailable — copy the built-in prompt below.';
}

applyTheme();
renderVisualControls();
wire();
bootFromLocation();
