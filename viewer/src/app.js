// Vault Graph viewer — application shell.
//
// The viewer never builds a graph: it reads one that a repository already
// exposes under .vault-graph/ and projects it (CDC §1, §26).
import { $ } from './ui/dom.js';
import { createGraphView } from './ui/graph-view.js';
import { renderMeta, renderFilters, renderInspector, renderWarnings, renderLegend } from './ui/panels.js';
import { readParams, classifyInput, buildAppUrl } from './lib/params.js';
import { resolveTarget, loadVaultGraph, countMismatch, fetchText, LoadError } from './lib/loader.js';
import {
  buildGraph,
  discoverFilterValues,
  discoverEdgeValues,
  applyFilters,
  searchNodes,
  PROVENANCE_WITHOUT,
} from './lib/graph-model.js';
import { createSimulation } from './lib/layout.js';
import { blobUrl } from './lib/github.js';
import { makeAuthFetch } from './lib/auth-fetch.js';
import { formatCount } from './lib/format.js';

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
  loadToken: 0,
};

function showScreen(name) {
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
  if (name !== 'graph') state.view?.stop();
}

// --------------------------------------------------------------------------
// Loading
// --------------------------------------------------------------------------

function setLoading(message, detail = '') {
  $('#loading-message').textContent = message;
  $('#loading-detail').textContent = detail;
  showScreen('loading');
}

function describeError(err) {
  if (!(err instanceof LoadError)) return { message: String(err?.message ?? err), detail: '' };
  const detail = [err.details?.url, err.details?.status ? `HTTP ${err.details.status}` : null]
    .filter(Boolean)
    .join(' — ');
  switch (err.code) {
    case 'network':
      return {
        message: 'Network error: the file could not be reached. Check your connection, then retry.',
        detail,
      };
    case 'not-found':
      return { message: `A file referenced by the manifest is missing: ${err.details?.what ?? 'file'}.`, detail };
    case 'http':
      return { message: err.message, detail };
    case 'parse':
      return { message: err.message, detail };
    case 'format':
      return { message: err.message, detail };
    default:
      return { message: err.message, detail };
  }
}

function showIncompatible(target) {
  $('#incompatible-target').textContent = target ?? '';
  $('#copy-status').textContent = '';
  $('#prompt-fallback').hidden = true;
  showScreen('incompatible');
}

function showError(err) {
  const { message, detail } = describeError(err);
  $('#error-message').textContent = message;
  $('#error-detail').textContent = detail;
  showScreen('error');
}

async function load(target, { refresh = false } = {}) {
  const token = ++state.loadToken;
  state.target = target;
  const keepUi = refresh && state.graph;

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
    // A missing manifest means "this repository has no Vault Graph" (§20);
    // any other failure is a real error the user should see (§20 note).
    if (err instanceof LoadError && err.code === 'not-found' && err.details?.what === 'manifest.json') {
      showIncompatible(resolved.manifestUrl);
    } else {
      showError(err);
    }
    return;
  }
  if (token !== state.loadToken) return;

  payload.warnings.unshift(...resolved.notes);
  state.payload = payload;
  installGraph(payload, { keepUi });
}

// --------------------------------------------------------------------------
// Graph installation & rendering
// --------------------------------------------------------------------------

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
      onClearSelection: () => {
        state.selection = null;
        state.view.setSelection(null);
        renderInspectorPanel();
      },
    });
  }

  showScreen('graph');
  $('#topbar-repo').textContent = state.repo
    ? `${state.repo.owner}/${state.repo.repo}${state.repo.ref ? ` @ ${state.repo.ref}` : ''}`
    : payload.manifestUrl;

  state.view.setData({ graph, sim: state.sim, matches: state.matches });
  applyAndRender({ recenter: true });
  state.view.start();
  renderMetaPanel();
}

function intersectSelection(previous, facetValues) {
  const next = new Set();
  if (!previous) return next;
  const available = new Set(facetValues.map((v) => v.value));
  for (const value of previous) if (available.has(value)) next.add(value);
  return next;
}

function sourceLinker() {
  if (!state.repo) return null;
  const ref = state.payload?.meta?.commit ?? state.repo.ref;
  const { owner, repo } = state.repo;
  return (source) =>
    blobUrl({
      owner,
      repo,
      ref,
      file: source.file,
      lineStart: source.line_start,
      lineEnd: source.line_end,
    });
}

function renderMetaPanel() {
  const { payload, graph } = state;
  renderMeta($('#meta'), {
    repo: state.repo,
    meta: payload.meta,
    summary: payload.summary,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    mismatches: payload.summaryAvailable ? countMismatch(payload.summary, graph) : [],
    fetchedAt: payload.fetchedAt,
    manifestUrl: payload.manifestUrl,
  });
  renderWarnings($('#warnings'), [...payload.warnings, ...graph.issues]);
  renderLegend($('#legend'), state.facets.type);
}

function quickFilters() {
  const out = [];
  for (const entry of state.facets.status) {
    const lower = entry.value.toLowerCase();
    if (lower !== 'candidate' && lower !== 'unresolved') continue;
    out.push({
      key: 'status',
      value: entry.value,
      label: entry.value,
      count: entry.count,
      active: state.filters.status.has(entry.value),
      title: `Show only nodes with status "${entry.value}"`,
    });
  }
  for (const entry of state.facets.edgeStatus ?? []) {
    const lower = entry.value.toLowerCase();
    if (lower !== 'candidate' && lower !== 'unresolved') continue;
    out.push({
      key: 'edgeStatus',
      value: entry.value,
      label: `${entry.value} relations`,
      count: entry.count,
      active: state.filters.edgeStatus.has(entry.value),
      title: `Show only relations with status "${entry.value}"`,
    });
  }
  const noSources = state.facets.provenance.find((p) => p.value === PROVENANCE_WITHOUT);
  if (noSources) {
    out.push({
      key: 'provenance',
      value: PROVENANCE_WITHOUT,
      label: 'no sources',
      count: noSources.count,
      active: state.filters.provenance.has(PROVENANCE_WITHOUT),
      title: 'Show only nodes with no recorded provenance',
    });
  }
  return out;
}

function renderFilterPanel() {
  renderFilters($('#filters'), {
    facets: state.facets,
    filters: state.filters,
    quickFilters: quickFilters(),
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
    onQuick: (q) => {
      const set = state.filters[q.key];
      if (set.has(q.value)) set.delete(q.value);
      else set.add(q.value);
      applyAndRender();
    },
  });
}

function renderInspectorPanel() {
  renderInspector($('#inspector'), {
    graph: state.graph,
    selection: state.selection,
    linkFor: sourceLinker(),
    onNavigate: (id) => selectNode(id, { focus: true }),
    onSelectEdge: (id) => selectEdge(id),
    emptyHint: 'Click a node or a relation in the graph, or search by label.',
  });
}

function applyAndRender({ recenter = false } = {}) {
  const { visibleNodeIds, visibleEdgeIds } = applyFilters(state.graph, state.filters);
  state.view.setVisible(visibleNodeIds, visibleEdgeIds);
  state.view.setSelection(state.selection);
  state.view.setMatches(state.matches);
  if (recenter) state.view.recenter();

  const badge = $('#visible-count');
  const total = state.graph.nodes.length;
  const totalEdges = state.graph.edges.length;
  badge.textContent = total
    ? `${formatCount(visibleNodeIds.size)} / ${formatCount(total)} nodes · ${formatCount(visibleEdgeIds.size)} / ${formatCount(totalEdges)} edges`
    : 'This Vault Graph is empty — no nodes have been generated yet.';

  renderFilterPanel();
  renderInspectorPanel();
}

function selectNode(id, { focus = false } = {}) {
  state.selection = { kind: 'node', id };
  state.view.setSelection(state.selection);
  if (focus) state.view.focusNode(id);
  renderInspectorPanel();
}

function selectEdge(id) {
  state.selection = { kind: 'edge', id };
  state.view.setSelection(state.selection);
  renderInspectorPanel();
}

// --------------------------------------------------------------------------
// Search
// --------------------------------------------------------------------------

function runSearch(query) {
  const ids = searchNodes(state.graph?.nodes ?? [], query);
  state.matches = new Set(ids);
  const count = $('#search-count');
  count.textContent = query.trim() ? `${ids.length} match${ids.length === 1 ? '' : 'es'}` : '';
  state.view?.setMatches(state.matches);
  if (ids.length) {
    const { visibleNodeIds } = applyFilters(state.graph, state.filters);
    const first = ids.find((id) => visibleNodeIds.has(id)) ?? ids[0];
    state.view?.focusNode(first);
  }
}

// --------------------------------------------------------------------------
// Navigation & wiring
// --------------------------------------------------------------------------

function goHome({ push = true } = {}) {
  state.loadToken += 1;
  state.view?.stop();
  if (push) pushUrl(new URL(location.href.split('?')[0]).toString());
  $('#home-error').hidden = true;
  showScreen('home');
  $('#repo-input').focus();
}

function pushUrl(url) {
  try {
    history.pushState({}, '', url);
  } catch {
    /* file:// or restricted context — the app still works, just not bookmarkable */
  }
}

function targetFromParams(params) {
  if (params.manifest) {
    const classified = classifyInput(params.manifest, location.href);
    if (classified.kind === 'manifest') return classified;
    // Tolerate a manifest= value that is not literally named manifest.json.
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

function bootFromLocation({ push = false } = {}) {
  const params = readParams(location.search);
  const target = targetFromParams(params);
  if (!target) {
    showScreen('home');
    $('#repo-input').focus();
    return;
  }
  if (push) pushUrl(buildAppUrl(location.href, target));
  load(target);
}

function wire() {
  const tokenInput = $('#token-input');
  if (tokenInput) tokenInput.value = getToken();

  $('#home-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (tokenInput) setToken(tokenInput.value.trim());
    const value = $('#repo-input').value;
    const classified = classifyInput(value, location.href);
    const errorNode = $('#home-error');
    if (classified.kind === 'invalid') {
      errorNode.textContent = classified.reason;
      errorNode.hidden = false;
      return;
    }
    errorNode.hidden = true;
    pushUrl(buildAppUrl(location.href, classified));
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

  $('#recenter-button').addEventListener('click', () => state.view?.recenter());
  $('#zoom-in').addEventListener('click', () => state.view?.zoomBy(1.25));
  $('#zoom-out').addEventListener('click', () => state.view?.zoomBy(0.8));

  let searchTimer = 0;
  $('#search-input').addEventListener('input', (event) => {
    const value = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(value), 120);
  });

  $('#bootstrap-link').href = BOOTSTRAP_ZIP;
  $('#copy-prompt').addEventListener('click', copyInstallPrompt);

  globalThis.addEventListener('popstate', () => bootFromLocation());

  document.addEventListener('keydown', (event) => {
    if (screens.graph.hidden) return;
    if (event.key === 'Escape') {
      state.selection = null;
      state.view?.setSelection(null);
      renderInspectorPanel();
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

wire();
bootFromLocation();
