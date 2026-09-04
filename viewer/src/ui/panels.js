// Panels: stats strip (§11/§27/§28), filters drawer (§11), inspector (§14),
// legend (§19) and warnings. Everything is built with textContent — graph data
// is never interpreted as markup.
import { el, clear } from './dom.js';
import { formatSourceRef, formatCount } from '../lib/format.js';
import { colorFor, statusColor, shapeForType, isTentative } from '../lib/colors.js';
import { incidentEdges, PROVENANCE_WITH, PROVENANCE_WITHOUT } from '../lib/graph-model.js';

const FACET_LABELS = {
  type: 'Type',
  context: 'Context',
  status: 'Status',
  provenance: 'Provenance',
  relation: 'Relation',
  edgeStatus: 'Relation status',
};

const PROVENANCE_LABELS = {
  [PROVENANCE_WITH]: 'has sources',
  [PROVENANCE_WITHOUT]: 'no sources',
};

const SHAPE_LABELS = {
  circle: 'concept & others',
  square: 'source',
  diamond: 'decision',
  triangle: 'hypothese',
};

function field(label, valueNode) {
  return el('div', { class: 'field' }, [
    el('div', { class: 'field-label', text: label }),
    el('div', { class: 'field-value' }, [valueNode]),
  ]);
}

function textOrDash(value) {
  return document.createTextNode(value === null || value === undefined || value === '' ? '—' : String(value));
}

function typeSwatch(type) {
  return el('span', { class: 'swatch', style: `background:${colorFor(type)}` });
}

function statusTag(status, { dark = false } = {}) {
  const tentative = isTentative(status);
  return el('span', { class: `tag status${tentative ? ' tentative' : ''}` }, [
    el('span', { class: 'swatch', style: `background:${statusColor(status, { dark })}` }),
    el('span', { text: String(status) }),
  ]);
}

// --------------------------------------------------------------------------
// Stats strip
// --------------------------------------------------------------------------

/**
 * Counts + candidate/unresolved quick actions + active-filter chips.
 * Quick actions are always rendered (disabled at 0) so the vocabulary of the
 * graph stays visible even when a category is empty (§27, §28).
 */
export function renderStats(container, ctx) {
  const { nodeCount, edgeCount, visibleNodes, visibleEdges, quickActions, activeChips, onQuick, onRemoveChip } = ctx;
  clear(container);

  const filtered = visibleNodes !== nodeCount || visibleEdges !== edgeCount;
  container.append(
    el('span', { class: 'stat' }, [
      el('strong', { text: formatCount(filtered ? visibleNodes : nodeCount) }),
      document.createTextNode(filtered ? ` / ${formatCount(nodeCount)} nodes` : ' nodes'),
    ])
  );
  container.append(el('span', { class: 'stat-sep', text: '·' }));
  container.append(
    el('span', { class: 'stat' }, [
      el('strong', { text: formatCount(filtered ? visibleEdges : edgeCount) }),
      document.createTextNode(filtered ? ` / ${formatCount(edgeCount)} edges` : ' edges'),
    ])
  );

  for (const action of quickActions ?? []) {
    container.append(
      el(
        'button',
        {
          type: 'button',
          class: `quick-action ${action.kind}`,
          'aria-pressed': action.active ? 'true' : 'false',
          disabled: action.count === 0,
          title: action.title ?? '',
          onclick: () => onQuick?.(action),
        },
        [
          el('span', { class: 'dot' }),
          el('span', { text: `${action.label} (${formatCount(action.count)})` }),
        ]
      )
    );
  }

  for (const chip of activeChips ?? []) {
    container.append(
      el('span', { class: 'active-chip' }, [
        el('span', { text: chip.label }),
        el('button', {
          type: 'button',
          'aria-label': `Remove filter ${chip.label}`,
          text: '✕',
          onclick: () => onRemoveChip?.(chip),
        }),
      ])
    );
  }
}

// --------------------------------------------------------------------------
// Warnings, legend, filters
// --------------------------------------------------------------------------

export function renderWarnings(container, warnings) {
  clear(container);
  const list = (warnings ?? []).filter(Boolean);
  container.hidden = list.length === 0;
  if (!list.length) return;
  container.append(
    el('details', { class: 'warnings' }, [
      el('summary', { text: `${list.length} data note${list.length > 1 ? 's' : ''}` }),
      el('ul', {}, list.slice(0, 60).map((w) => el('li', { text: w }))),
    ])
  );
}

/** The five sentences that make the visual encoding readable without a manual (v0.3). */
const READING_ITEMS = [
  { glyph: 'degree', text: 'Brighter · bigger = more relations' },
  { glyph: 'halo', text: 'Warm halo = selected / hovered' },
  { glyph: 'dashed', text: 'Dashed = candidate (proposed, not a fact)' },
  { glyph: 'dimmed', text: 'Dimmed = outside focus' },
  { glyph: 'shelves', text: 'Shelves = layers of the current projection' },
];

/**
 * Legend: shapes, types, statuses and how to read the constellation — never
 * colour alone (§19).
 * @param {HTMLElement} container
 * @param {{typeFacet?:Array, statusFacet?:Array, dark?:boolean,
 *          statusFirst?:boolean, collapsed?:boolean, onToggle?:Function}} ctx
 */
export function renderLegend(container, ctx) {
  const {
    typeFacet = [],
    statusFacet = [],
    dark = false,
    statusFirst = false,
    collapsed = false,
    onToggle = null,
  } = ctx ?? {};
  clear(container);
  container.classList.toggle('is-collapsed', Boolean(collapsed));
  const groups = [];

  // Mobile affordance: the legend can be folded away so the graph keeps the screen.
  if (onToggle) {
    container.append(
      el('button', {
        type: 'button',
        class: 'legend-toggle',
        'aria-expanded': collapsed ? 'false' : 'true',
        'aria-controls': container.id || null,
        'aria-label': collapsed ? 'Show the legend' : 'Hide the legend',
        title: collapsed ? 'Show the legend' : 'Hide the legend',
        // The callback receives the next *open* state, not the current one.
        onclick: () => onToggle(collapsed),
      }, [
        el('span', { class: 'legend-toggle-text', text: 'Legend' }),
        el('span', { class: 'legend-chevron', 'aria-hidden': 'true', text: collapsed ? '⌃' : '⌄' }),
      ])
    );
  }

  const shapes = [...new Set((typeFacet.length ? typeFacet : []).map((t) => shapeForType(t.value)))];
  const shapeList = shapes.length > 1 ? shapes : ['circle'];
  groups.push(
    el('div', { class: 'legend-group' }, [
      el('span', { class: 'legend-title', text: 'Shape' }),
      ...shapeList.map((shape) =>
        el('span', { class: 'legend-item' }, [
          el('span', { class: `glyph ${shape}` }),
          el('span', { text: SHAPE_LABELS[shape] ?? shape }),
        ])
      ),
    ])
  );

  if (typeFacet.length) {
    groups.push(
      el('div', { class: 'legend-group' }, [
        el('span', { class: 'legend-title', text: 'Type' }),
        ...typeFacet.slice(0, 12).map((entry) =>
          el('span', { class: 'legend-item' }, [typeSwatch(entry.value), el('span', { text: entry.value })])
        ),
      ])
    );
  }

  if (statusFacet.length) {
    const statusGroup = el('div', { class: 'legend-group' }, [
      el('span', { class: 'legend-title', text: 'Status' }),
      ...statusFacet.slice(0, 8).map((entry) =>
        el('span', { class: 'legend-item' }, [
          el('span', {
            class: isTentative(entry.value) ? 'glyph dashed' : 'swatch',
            style: isTentative(entry.value)
              ? `border-color:${statusColor(entry.value, { dark })}`
              : `background:${statusColor(entry.value, { dark })}`,
          }),
          el('span', { text: entry.value }),
        ])
      ),
    ]);
    // When the current 3D projection colours by status, status is what the
    // picture is actually saying: it leads the legend instead of trailing it.
    if (statusFirst) groups.unshift(statusGroup);
    else groups.push(statusGroup);
  }

  groups.push(
    el('div', { class: 'legend-group' }, [
      el('span', { class: 'legend-title', text: 'Relation' }),
      el('span', { class: 'legend-item', text: '— confirmed / explicit' }),
      el('span', { class: 'legend-item', text: '- - candidate or unsourced' }),
    ])
  );

  groups.push(
    el('div', { class: 'legend-group legend-reading' }, [
      el('span', { class: 'legend-title', text: 'Reading' }),
      ...READING_ITEMS.map((item) =>
        el('span', { class: 'legend-item' }, [
          el('span', { class: `glyph ${item.glyph}`, 'aria-hidden': 'true' }),
          el('span', { text: item.text }),
        ])
      ),
      el('span', { class: 'legend-item legend-aside', text: 'Motion is ambient only — it carries no information.' }),
    ])
  );

  container.append(el('div', { class: 'legend' }, groups));
}

/** Filter panel. Values and counts are discovered from the graph (§23, §26). */
export function renderFilters(container, ctx) {
  const { facets, filters, onToggle, onReset } = ctx;
  clear(container);

  for (const facetKey of ['type', 'context', 'status', 'provenance', 'relation', 'edgeStatus']) {
    const values = facets[facetKey];
    if (!values || !values.length) continue;
    const selected = filters[facetKey] ?? new Set();
    container.append(
      el('section', { class: 'facet' }, [
        el('div', { class: 'facet-head' }, [
          el('h3', { text: FACET_LABELS[facetKey] ?? facetKey }),
          selected.size
            ? el('button', { type: 'button', class: 'link-button', text: 'clear', onclick: () => onReset(facetKey) })
            : null,
        ]),
        el(
          'div',
          { class: 'chips' },
          values.map((entry) => {
            const active = selected.has(entry.value);
            const label = facetKey === 'provenance' ? PROVENANCE_LABELS[entry.value] ?? entry.value : entry.value;
            return el(
              'button',
              {
                type: 'button',
                class: `chip${active ? ' active' : ''}`,
                'aria-pressed': active ? 'true' : 'false',
                onclick: () => onToggle(facetKey, entry.value),
              },
              [
                facetKey === 'type' ? typeSwatch(entry.value) : null,
                el('span', { text: label }),
                el('span', { class: 'chip-count', text: String(entry.count) }),
              ]
            );
          })
        ),
      ])
    );
  }
}

// --------------------------------------------------------------------------
// Search results
// --------------------------------------------------------------------------

/** Suggestion list under the search field (§12). */
export function renderSearchResults(container, ctx) {
  const { nodes = [], query = '', onPick } = ctx ?? {};
  clear(container);
  if (!query.trim()) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  if (!nodes.length) {
    container.append(el('li', { class: 'search-empty', text: 'No node matches this search.' }));
    return;
  }
  for (const node of nodes) {
    container.append(
      el('li', { role: 'option' }, [
        el('button', { type: 'button', onclick: () => onPick?.(node.id) }, [
          typeSwatch(node.type),
          el('span', { class: 'r-label', text: node.label }),
          el('span', { class: 'r-meta', text: `${node.type} · ${node.context}` }),
        ]),
      ])
    );
  }
}

// --------------------------------------------------------------------------
// Inspector (§14)
// --------------------------------------------------------------------------

function sourceItem(source, linkFor) {
  const label = formatSourceRef(source);
  const href = linkFor ? linkFor(source) : null;
  const main = href
    ? el('a', { class: 'mono', href, target: '_blank', rel: 'noreferrer noopener', text: label })
    : el('span', { class: 'mono', text: label });
  return el('li', {}, [main, source.heading ? el('span', { class: 'muted', text: ` — ${source.heading}` }) : null]);
}

function sourcesBlock(item, linkFor) {
  if (!item.sources.length) return el('p', { class: 'note warn', text: 'No source recorded for this item.' });
  return el('ul', { class: 'sources' }, item.sources.map((s) => sourceItem(s, linkFor)));
}

function edgeRow(graph, edge, direction, onNavigate, onSelectEdge, dark) {
  const otherId = direction === 'out' ? edge.to : edge.from;
  const other = graph.nodeById.get(otherId);
  return el('li', { class: 'edge-row' }, [
    el('button', {
      type: 'button',
      class: 'link-button relation',
      text: edge.relation,
      title: `Select relation ${edge.id}`,
      onclick: () => onSelectEdge(edge.id),
    }),
    el('span', { class: 'arrow', text: direction === 'out' ? '→' : '←' }),
    el('button', {
      type: 'button',
      class: 'link-button node-link',
      text: other ? other.label : otherId,
      onclick: () => onNavigate(otherId),
    }),
    statusTag(edge.status, { dark }),
    edge.sources.length ? null : el('span', { class: 'tag warn', text: 'no source' }),
  ]);
}

function nodeCard(role, node, id, onNavigate, dark) {
  return el('button', { type: 'button', class: 'node-card', onclick: () => onNavigate(id) }, [
    el('div', { class: 'card-role', text: role }),
    el('div', { class: 'card-label', text: node ? node.label : id }),
    node
      ? el('div', { class: 'tag-row' }, [
          el('span', { class: 'tag' }, [typeSwatch(node.type), el('span', { text: node.type })]),
          el('span', { class: 'tag', text: node.context }),
          statusTag(node.status, { dark }),
        ])
      : el('div', { class: 'mono muted small wrap', text: id }),
  ]);
}

function details(title, body, open = false) {
  return el('details', open ? { open: true } : {}, [el('summary', { text: title }), body]);
}

/** Node / edge inspector: meaning first, technical ids last (§14). */
export function renderInspector(container, ctx) {
  const { graph, selection, linkFor, onNavigate, onSelectEdge, emptyHint, dark = false } = ctx;
  clear(container);

  if (!selection) {
    container.append(el('p', { class: 'muted', text: emptyHint ?? 'Select a node or a relation.' }));
    return;
  }

  if (selection.kind === 'node') {
    const node = graph.nodeById.get(selection.id);
    if (!node) {
      container.append(el('p', { class: 'muted', text: 'This node is no longer in the graph.' }));
      return;
    }
    const { incoming, outgoing } = incidentEdges(graph, node.id);

    container.append(el('p', { class: 'inspector-kind', text: 'Node' }));
    container.append(el('h2', { class: 'inspector-title', text: node.label }));
    container.append(
      el('div', { class: 'tag-row' }, [
        el('span', { class: 'tag' }, [typeSwatch(node.type), el('span', { text: node.type })]),
        el('span', { class: 'tag', text: node.context }),
        statusTag(node.status, { dark }),
      ])
    );
    container.append(
      el('div', { class: 'counts-row' }, [
        el('div', { class: 'count-block' }, [
          el('span', { class: 'count-value', text: String(node.sources.length) }),
          el('span', { class: 'count-label', text: 'Sources' }),
        ]),
        el('div', { class: 'count-block' }, [
          el('span', { class: 'count-value', text: String(outgoing.length) }),
          el('span', { class: 'count-label', text: 'Outgoing' }),
        ]),
        el('div', { class: 'count-block' }, [
          el('span', { class: 'count-value', text: String(incoming.length) }),
          el('span', { class: 'count-label', text: 'Incoming' }),
        ]),
      ])
    );

    container.append(details(`Sources (${node.sources.length})`, sourcesBlock(node, linkFor), true));

    const relations = el('div', {}, [
      el('p', { class: 'subhead', text: `Outgoing (${outgoing.length})` }),
      outgoing.length
        ? el('ul', { class: 'edges' }, outgoing.map((e) => edgeRow(graph, e, 'out', onNavigate, onSelectEdge, dark)))
        : el('p', { class: 'muted small', text: 'None.' }),
      el('p', { class: 'subhead', text: `Incoming (${incoming.length})` }),
      incoming.length
        ? el('ul', { class: 'edges' }, incoming.map((e) => edgeRow(graph, e, 'in', onNavigate, onSelectEdge, dark)))
        : el('p', { class: 'muted small', text: 'None.' }),
      !incoming.length && !outgoing.length
        ? el('p', {
            class: node.reason ? 'note' : 'note warn',
            text: node.reason
              ? 'Isolated node — a reason is recorded in Metadata.'
              : 'Isolated node with no recorded reason (CDC §14: zero unexplained orphans).',
          })
        : null,
    ]);
    container.append(details(`Relations (${incoming.length + outgoing.length})`, relations, true));

    const metadata = el('div', {}, [
      field('Id', el('span', { class: 'mono wrap', text: node.id })),
      node.aliases.length ? field('Aliases', textOrDash(node.aliases.join(', '))) : null,
      node.reason ? field('Reason', textOrDash(node.reason)) : null,
    ]);
    container.append(details('Metadata', metadata));
    return;
  }

  const edge = graph.edgeById.get(selection.id);
  if (!edge) {
    container.append(el('p', { class: 'muted', text: 'This relation is no longer in the graph.' }));
    return;
  }
  const from = graph.nodeById.get(edge.from);
  const to = graph.nodeById.get(edge.to);
  container.append(el('p', { class: 'inspector-kind', text: 'Relation' }));
  container.append(el('h2', { class: 'inspector-title', text: edge.relation }));
  container.append(el('div', { class: 'tag-row' }, [statusTag(edge.status, { dark })]));
  if (isTentative(edge.status)) {
    container.append(
      el('p', {
        class: 'note warn',
        text: 'Proposed relation — not a confirmed fact. It is shown so it can be reviewed, never as an established link.',
      })
    );
  }
  container.append(nodeCard('From', from, edge.from, onNavigate, dark));
  container.append(nodeCard('To', to, edge.to, onNavigate, dark));
  container.append(details(`Sources (${edge.sources.length})`, sourcesBlock(edge, linkFor), true));
  container.append(
    details(
      'Metadata',
      el('div', {}, [
        field('Id', el('span', { class: 'mono wrap', text: edge.id })),
        edge.raw?.reason ? field('Reason', textOrDash(edge.raw.reason)) : null,
      ])
    )
  );
}
