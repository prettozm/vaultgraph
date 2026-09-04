// Optional end-to-end smoke test: serves the repository root over HTTP, drives the built
// viewer in headless Chromium against the repository's own .vault-graph on a desktop and a
// mobile viewport, and writes one screenshot per viewport. Requires a Playwright installation
// resolvable by Node (global install is fine: NODE_PATH=/opt/node22/lib/node_modules).
// Not part of `npm test`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jsonl': 'application/x-ndjson', '.yaml': 'text/yaml', '.md': 'text/markdown' };

const server = http.createServer((req, res) => {
  const p = path.join(repoRoot, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(repoRoot) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const target = process.argv[2] || `${base}/.vault-graph/manifest.json`;
const url = `${base}/viewer/dist/index.html?manifest=${encodeURIComponent(target)}`;
const manifestDoc = await fetch(target).then((r) => r.json()).catch(() => ({}));
const shortCommit = String(manifestDoc?.source?.commit || '').slice(0, 7);
const has3D = fs.existsSync(path.join(here, '..', 'dist', 'ui', 'graph-view-3d.js'));

const failures = [];
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) failures.push(msg); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function open(viewport, { colorScheme, query = '' } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(url + query);
  await page.waitForSelector('#screen-graph:not([hidden])', { timeout: 15000 }).catch(() => {});
  return { page, consoleErrors };
}

/** A real touch context (a phone), not just a narrow window. */
async function openTouch(viewport, { colorScheme = 'dark', query = '' } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(url + query);
  await page.waitForSelector('#screen-graph:not([hidden])', { timeout: 15000 }).catch(() => {});
  return { page, context, consoleErrors };
}

/** One `data-visual` control, wherever it lives (popover row or 3D quick row). */
const visualControl = (page, key, value) =>
  page.locator(value === undefined ? `[data-visual="${key}"]` : `[data-visual="${key}"][data-value="${value}"]`);

/** The persisted visual preferences, as the page itself stored them. */
const storedVisual = (page) =>
  page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('vault-graph.prefs.v1'))?.visual ?? null;
    } catch {
      return null;
    }
  });

// ---------------------------------------------------------------- desktop
{
  const { page, consoleErrors } = await open({ width: 1280, height: 800 });
  const visible = await page.evaluate(() => [...document.querySelectorAll('[id^="screen-"]')].filter((e) => !e.hidden).map((e) => e.id));
  check(visible.includes('screen-graph'), `desktop: graph screen shown (visible: ${visible.join(',')})`);

  const header = await page.locator('.appbar').innerText().catch(() => '');
  check(/generated/i.test(header), `desktop: header shows the generation date (${header.replace(/\s+/g, ' ').slice(0, 120)})`);
  check(/fetched/i.test(await page.locator('#topbar-fetched').innerText().catch(() => '')), 'desktop: fetched date stays visible but secondary');
  check(shortCommit.length === 7 && header.includes(shortCommit), `desktop: header shows source commit ${shortCommit || '(none in manifest)'}`);
  const stats = await page.locator('#stats').innerText().catch(() => '');
  check(/39/.test(stats) && /64/.test(stats), `desktop: stats show 39 nodes / 64 edges (${stats.replace(/\s+/g, ' ').slice(0, 120)})`);
  check(/Candidates/.test(stats) && /Unresolved/.test(stats), 'desktop: candidate & unresolved shortcuts are present');

  // Filters drawer opens and closes.
  await page.click('#filters-button');
  await page.waitForTimeout(150);
  check(await page.locator('#filters-drawer').isVisible(), 'desktop: filters drawer opens');
  const filters = await page.locator('#filters').innerText().catch(() => '');
  check(/electronique/.test(filters) && /finance/.test(filters), 'desktop: filters discovered contexts electronique & finance');
  check(/candidate/.test(filters), 'desktop: filters expose candidate status (relations)');
  await page.click('#filters-close');
  await page.waitForTimeout(150);
  check(!(await page.locator('#filters-drawer').isVisible()), 'desktop: filters drawer closes');

  // Search centres, selects and opens the inspector.
  await page.fill('#search-input', 'résistance');
  await page.waitForTimeout(400);
  const results = await page.locator('#search-results li').count();
  check(results >= 2, `desktop: search "résistance" suggests several nodes (${results})`);
  await page.locator('#search-results button').first().click();
  await page.waitForTimeout(200);
  check(await page.locator('#inspector-panel').isVisible(), 'desktop: picking a search result opens the inspector');
  const inspector = await page.locator('#inspector').innerText().catch(() => '');
  check(/sources/i.test(inspector) && /relations/i.test(inspector) && /metadata/i.test(inspector), 'desktop: inspector shows Sources, Relations & Metadata sections');
  check(await page.locator('.focus-group [data-hops="1"]').isEnabled(), 'desktop: Focus is enabled once a node is selected');
  await page.click('.focus-group [data-hops="1"]');
  await page.waitForTimeout(120);

  // Candidates quick action → inspector shows a candidate relation.
  await page.click('.quick-action.candidate');
  await page.waitForTimeout(250);
  const candidateInspector = await page.locator('#inspector').innerText().catch(() => '');
  check(/Relation/i.test(candidateInspector) && /candidate/i.test(candidateInspector), `desktop: Candidates opens a candidate relation (${candidateInspector.replace(/\s+/g, ' ').slice(0, 100)})`);

  // 3D (only when Lot G's module is present in dist/).
  if (has3D) {
    await page.click('#view-3d');
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /Unresolved/ }).click();
    await page.waitForTimeout(400);
    const inspUnres = await page.locator('#inspector').innerText().catch(() => '');
    check(/levain|isol|Recette/i.test(inspUnres), `desktop: Unresolved opens the explained orphan (${inspUnres.replace(/\s+/g, ' ').slice(0, 80)})`);
    const vcUnres = await page.locator('#visible-count').innerText().catch(() => '');
    check(/^1 \//.test(vcUnres.trim()), `desktop: Unresolved keeps the explicit orphan visible (${vcUnres.trim()})`);
    await page.getByRole('button', { name: /Candidates/ }).click();
    await page.waitForTimeout(300);
    check(await page.locator('#graph-canvas-3d').isVisible(), 'desktop: 3D canvas visible after toggling 3D');
    await page.waitForTimeout(700); await page.screenshot({ path: new URL('./smoke-3d-context.png', import.meta.url).pathname });

    // ---- View settings (v0.3): the whole constellation, unfiltered.
    await page.getByRole('button', { name: /Candidates/ }).click();
    await page.waitForTimeout(250);
    await page.click('#view-options-button');
    await page.waitForTimeout(150);
    check(await page.locator('#view-options').isVisible(), 'desktop: View popover opens');
    check(
      (await page.getAttribute('#view-options-button', 'aria-expanded')) === 'true',
      'desktop: the View button reports its expanded state'
    );
    await visualControl(page, 'animation').first().click();
    await page.waitForTimeout(120);
    check(
      (await visualControl(page, 'animation').first().getAttribute('aria-checked')) === 'false',
      'desktop: Ambient motion switches off'
    );
    await visualControl(page, 'labels', 'all').first().click();
    await visualControl(page, 'edges').first().click();
    await visualControl(page, 'glow', 'high').first().click();
    await page.waitForTimeout(200);
    check(
      (await visualControl(page, 'labels', 'all').first().getAttribute('aria-pressed')) === 'true' &&
        (await visualControl(page, 'glow', 'high').first().getAttribute('aria-pressed')) === 'true',
      'desktop: Labels=All and Glow=High are reflected in the controls'
    );

    // Layers: set from the popover, then from the 3D quick row that mirrors it.
    check(await page.locator('#layers-quick').isVisible(), 'desktop: the 3D Layers quick control is shown in 3D');
    await page.locator('#view-options [data-visual="layers"][data-value="expanded"]').click();
    await page.waitForTimeout(150);
    await page.click('#view-options-close');
    await page.waitForTimeout(150);
    check(await page.locator('#view-options').isHidden(), 'desktop: View popover closes');
    check(await page.locator('#graph-canvas-3d').isVisible(), 'desktop: 3D canvas survives the visual options');
    await page.waitForTimeout(700);
    await page.screenshot({ path: new URL('./smoke-3d-expanded.png', import.meta.url).pathname });

    await page.locator('#layers-quick [data-visual="layers"][data-value="flat"]').click();
    await page.waitForTimeout(700);
    check(await page.locator('#graph-canvas-3d').isVisible(), 'desktop: 3D canvas stays visible on Layers=Flat');
    await page.screenshot({ path: new URL('./smoke-3d-flat.png', import.meta.url).pathname });

    const visualPrefs = await storedVisual(page);
    check(
      visualPrefs?.animation === false &&
        visualPrefs?.labels === 'all' &&
        visualPrefs?.edges === false &&
        visualPrefs?.glow === 'high' &&
        visualPrefs?.layers === 'flat',
      `desktop: visual options persisted to localStorage (${JSON.stringify(visualPrefs)})`
    );
    check(
      /labels=all/.test(page.url()) && /layers=flat/.test(page.url()),
      `desktop: non-default visual options reach the shareable URL (${page.url().split('?')[1] ?? ''})`
    );

    // Escape closes the popover rather than the selection underneath it.
    await page.click('#view-options-button');
    await page.waitForTimeout(120);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check(await page.locator('#view-options').isHidden(), 'desktop: Escape closes the View popover');

    // Put the constellation back the way the rest of the run expects it.
    await page.click('#view-options-button');
    await page.waitForTimeout(120);
    await page.click('#view-options-reset');
    await page.waitForTimeout(200);
    check(
      (await storedVisual(page))?.glow === 'medium',
      'desktop: "Reset view settings" restores the defaults'
    );
    await page.click('#view-options-close');
    await page.waitForTimeout(150);
    const options = await page.locator('#projection-select option').count();
    check(options > 0, `desktop: projection selector lists ${options} projections`);
    const enabled = await page.$$eval('#projection-select option:not([disabled])', (o) => o.map((x) => x.value));
    if (enabled.length > 1) {
      await page.selectOption('#projection-select', enabled[1]);
      await page.waitForTimeout(250);
      check(await page.locator('#graph-canvas-3d').isVisible(), `desktop: projection switched to ${enabled[1]}`);
      await page.waitForTimeout(700); await page.screenshot({ path: new URL('./smoke-3d-time.png', import.meta.url).pathname });
      for (const id of enabled.slice(2)) { await page.selectOption('#projection-select', id); await page.waitForTimeout(700); check(await page.locator('#graph-canvas-3d').isVisible(), `desktop: projection switched to ${id}`); await page.screenshot({ path: new URL(`./smoke-3d-${id}.png`, import.meta.url).pathname }); }
    }
    await page.click('#view-2d');
    await page.waitForTimeout(200);
    check(await page.locator('#graph-canvas').isVisible(), 'desktop: back to 2D');
  } else {
    console.log('SKIP  desktop: 3D module not built yet (viewer/dist/ui/graph-view-3d.js)');
  }

  check(consoleErrors.length === 0, `desktop: no console/page errors (${consoleErrors.slice(0, 3).join(' | ')})`);
  await page.screenshot({ path: path.join(here, 'smoke-desktop.png') });
  await page.close();
}

// ---------------------------------------------------------------- mobile
{
  const viewport = { width: 390, height: 844 };
  const { page, consoleErrors } = await open(viewport);
  const visible = await page.evaluate(() => [...document.querySelectorAll('[id^="screen-"]')].filter((e) => !e.hidden).map((e) => e.id));
  check(visible.includes('screen-graph'), `mobile: graph screen shown (visible: ${visible.join(',')})`);

  const box = await page.locator('#graph-canvas').boundingBox();
  check(Boolean(box), 'mobile: graph canvas is laid out');
  if (box) {
    const topRatio = box.y / viewport.height;
    const heightRatio = box.height / viewport.height;
    check(topRatio < 0.45, `mobile: canvas starts above 45% of the viewport (top ${(topRatio * 100).toFixed(1)}%)`);
    check(heightRatio >= 0.55, `mobile: canvas keeps at least 55% of the viewport (height ${(heightRatio * 100).toFixed(1)}%)`);
  }
  check(await page.locator('#filters-drawer').isHidden(), 'mobile: filters are collapsed by default');

  await page.click('#filters-button');
  await page.waitForTimeout(200);
  check(await page.locator('#filters-drawer').isVisible(), 'mobile: filters open as a bottom sheet');
  check(await page.locator('#drawer-backdrop').isVisible(), 'mobile: the bottom sheet has a backdrop');
  await page.click('#filters-close');
  await page.waitForTimeout(200);
  check(await page.locator('#filters-drawer').isHidden(), 'mobile: filters sheet closes');

  // View settings reuse the bottom-sheet pattern (v0.3).
  await page.click('#view-options-button');
  await page.waitForTimeout(200);
  check(await page.locator('#view-options').isVisible(), 'mobile: View opens as a bottom sheet');
  check(await page.locator('#view-backdrop').isVisible(), 'mobile: the View sheet has a backdrop');
  await page.click('#view-options-close');
  await page.waitForTimeout(200);
  check(await page.locator('#view-options').isHidden(), 'mobile: View sheet closes');

  await page.click('.quick-action.candidate');
  await page.waitForTimeout(300);
  const inspector = await page.locator('#inspector').innerText().catch(() => '');
  check(/candidate/i.test(inspector), `mobile: Candidates opens a candidate relation (${inspector.replace(/\s+/g, ' ').slice(0, 90)})`);
  check(await page.locator('#inspector-panel').isVisible(), 'mobile: inspector opens as a sheet');
  await page.click('#inspector-close');
  await page.waitForTimeout(150);
  check(await page.locator('#inspector-panel').isHidden(), 'mobile: inspector closes and gives the graph back');

  check(consoleErrors.length === 0, `mobile: no console/page errors (${consoleErrors.slice(0, 3).join(' | ')})`);
  await page.screenshot({ path: path.join(here, 'smoke-mobile.png') });
  await page.close();
}

// ---------------------------------------------------------------- touch (v0.3.2)
// The three regressions the human hit on a phone: an edge could not be tapped,
// the theme switch had a third state and drifted off the header, and the day
// theme was a different product. Everything below is driven with a finger.
{
  const viewport = { width: 390, height: 844 };
  const { page, context, consoleErrors } = await openTouch(viewport, { colorScheme: 'dark', query: '&view=2d' });
  await page.waitForTimeout(900); // let the layout settle and a few frames land

  const hookReady = await page.evaluate(() => Boolean(globalThis.__vaultGraph?.screenPointOnEdge));
  check(hookReady, 'touch: the __vaultGraph test hook is exposed');
  const inspectorText = () => page.locator('#inspector').innerText().catch(() => '');
  /** What the inspector is actually showing: its kind line and its title. */
  const inspectorHead = () =>
    page.evaluate(() => ({
      kind: document.querySelector('#inspector .inspector-kind')?.textContent?.trim() ?? '',
      title: document.querySelector('#inspector .inspector-title')?.textContent?.trim() ?? '',
    }));
  const canvasBox = async (sel) => (await page.locator(sel).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };

  /**
   * Wait until the force layout has stopped moving. Ambient drift never
   * stops (±3 px over 9–17 s ⇒ well under a pixel per sample), so "stable"
   * means no star moved more than 2 px between two samples 250 ms apart.
   * Without this the tap chases a node that is still being simulated.
   */
  async function waitForStableLayout(tries = 40) {
    const sample = () =>
      page.evaluate(() => {
        const vg = globalThis.__vaultGraph;
        return vg.visibleNodeIds().map((id) => vg.screenPointOfNode(id));
      });
    let previous = await sample();
    for (let i = 0; i < tries; i += 1) {
      await page.waitForTimeout(250);
      const next = await sample();
      const worst = next.reduce((m, p, k) => {
        const q = previous[k];
        return p && q ? Math.max(m, Math.hypot(p.x - q.x, p.y - q.y)) : m;
      }, 0);
      previous = next;
      if (worst <= 2) return true;
    }
    return false;
  }

  /** A node whose star sits comfortably inside the canvas. */
  const pickNodeTarget = async (box) =>
    page.evaluate(({ box }) => {
      const vg = globalThis.__vaultGraph;
      const inside = (p) => p && p.x > box.x + 24 && p.x < box.x + box.width - 24 && p.y > box.y + 24 && p.y < box.y + box.height - 24;
      for (const id of vg.visibleNodeIds()) {
        const p = vg.screenPointOfNode(id);
        if (inside(p)) return { id, point: p, label: vg.labelOf(id) };
      }
      return null;
    }, { box });

  /**
   * An edge whose midpoint is ≥ 30 px from *every* node on screen: proof the
   * tap resolved against the segment and not against a star next to it.
   */
  const pickEdgeTarget = async (box) =>
    page.evaluate(({ box }) => {
      const vg = globalThis.__vaultGraph;
      const nodes = vg.visibleNodeIds().map((id) => vg.screenPointOfNode(id)).filter(Boolean);
      const inside = (p) => p && p.x > box.x + 24 && p.x < box.x + box.width - 24 && p.y > box.y + 24 && p.y < box.y + box.height - 24;
      for (const id of vg.visibleEdgeIds()) {
        const p = vg.screenPointOnEdge(id, 0.5);
        if (!inside(p)) continue;
        const clearance = Math.min(...nodes.map((n) => Math.hypot(n.x - p.x, n.y - p.y)));
        if (clearance >= 30) return { id, point: p, relation: vg.relationOf(id), clearance: Math.round(clearance) };
      }
      return null;
    }, { box });

  /** One finger tap on a node, then on a lone edge, in whichever view is mounted. */
  async function tapNodeThenEdge(mode, selector) {
    const box = await canvasBox(selector);
    check(
      (await page.evaluate(() => globalThis.__vaultGraph.activeView())) === mode,
      `touch/${mode}: the hook reports the mounted renderer`
    );
    check(await waitForStableLayout(), `touch/${mode}: the layout settles, so a tap lands where it was aimed`);

    const node = await pickNodeTarget(box);
    check(Boolean(node), `touch/${mode}: found a node to tap`);
    if (node) {
      await page.touchscreen.tap(node.point.x, node.point.y);
      await page.waitForTimeout(350);
      // The inspector title is uppercased by CSS, so compare case-insensitively.
      const head = await inspectorHead();
      const text = (await inspectorText()).toLocaleLowerCase();
      check(
        /node/i.test(head.kind) &&
          head.title.toLocaleLowerCase() === node.label.toLocaleLowerCase() &&
          text.includes(node.label.toLocaleLowerCase()),
        `touch/${mode}: tapping the star opens "${node.label}" — inspector shows ${head.kind || '(nothing)'} "${head.title}"`
      );
      await page.click('#inspector-close').catch(() => {});
      await page.waitForTimeout(250);
    }

    // The inspector is a bottom sheet on a phone: it must be out of the way, or
    // the next "tap on the canvas" lands on the sheet instead.
    check(
      await page.locator('#inspector-panel').isHidden(),
      `touch/${mode}: the inspector sheet is closed before the next tap`
    );
    const edge = await pickEdgeTarget(box);
    check(Boolean(edge), `touch/${mode}: found an edge whose midpoint is ≥ 30 px from every node`);
    if (edge) {
      await page.touchscreen.tap(edge.point.x, edge.point.y);
      await page.waitForTimeout(350);
      check((await page.evaluate(() => globalThis.__vaultGraph.selectedId())) === edge.id, `touch/${mode}: the selected edge is the tapped one (${edge.id})`);
      // Strict: the inspector must be showing *that relation*, not a node that
      // happens to list it among its own relations.
      const near = await page.evaluate(({ point }) => {
        const vg = globalThis.__vaultGraph;
        let best = null;
        for (const id of vg.visibleNodeIds()) {
          const p = vg.screenPointOfNode(id);
          if (!p) continue;
          const d = Math.hypot(p.x - point.x, p.y - point.y);
          if (!best || d < best.d) best = { id, d: Math.round(d), label: vg.labelOf(id) };
        }
        return best;
      }, { point: edge.point });
      const head = await inspectorHead();
      const text = (await inspectorText()).toLocaleLowerCase();
      check(
        /relation/i.test(head.kind) &&
          head.title.toLocaleLowerCase() === edge.relation.toLocaleLowerCase() &&
          text.includes(edge.relation.toLocaleLowerCase()),
        `touch/${mode}: tapping edge ${edge.id} (relation "${edge.relation}", ${edge.clearance} px clear of every node) opens it` +
          ` — inspector shows ${head.kind || '(nothing)'} "${head.title}"; nearest star after the tap: ${near?.label} at ${near?.d} px`
      );
      await page.click('#inspector-close').catch(() => {});
      await page.waitForTimeout(200);
    }
    return edge;
  }

  const edge2d = await tapNodeThenEdge('2d', '#graph-canvas');

  // ---- the theme switch: two states, always inside the header.
  const readTheme = () =>
    page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      bgTop: getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg-top').trim(),
      pressed: document.querySelector('#theme-toggle')?.getAttribute('aria-pressed'),
      label: document.querySelector('#theme-toggle')?.getAttribute('aria-label'),
    }));
  const before = await readTheme();
  check(before.theme === 'dark' && before.pressed === 'true', `touch: starts in night mode (${before.theme}, aria-pressed=${before.pressed})`);
  check(/day/i.test(before.label ?? ''), `touch: the switch names the next state ("${before.label}")`);

  const toggleBox = await page.locator('#theme-toggle').boundingBox();
  check(Boolean(toggleBox), 'touch: the theme switch is laid out');
  if (toggleBox) {
    check(
      toggleBox.x + toggleBox.width <= viewport.width,
      `touch: the switch stays inside 390 px (right edge ${Math.round(toggleBox.x + toggleBox.width)})`
    );
    check(
      toggleBox.width >= 40 && toggleBox.height >= 40,
      `touch: the switch is a real target (${Math.round(toggleBox.width)}×${Math.round(toggleBox.height)})`
    );
  }

  await page.tap('#theme-toggle');
  await page.waitForTimeout(400);
  const light = await readTheme();
  check(light.theme === 'light', `touch: one tap flips to day mode (${light.theme})`);
  check(light.bgTop !== before.bgTop && light.bgTop === '#f7f9fd', `touch: the canvas ground follows the theme (${light.bgTop})`);
  check(light.pressed === 'false' && /night/i.test(light.label ?? ''), `touch: the switch reports day mode ("${light.label}")`);
  const lightBox = await page.locator('#theme-toggle').boundingBox();
  check(
    lightBox && lightBox.x + lightBox.width <= viewport.width,
    `touch: the switch is still inside 390 px in day mode (right edge ${Math.round((lightBox?.x ?? 0) + (lightBox?.width ?? 0))})`
  );

  await page.tap('#theme-toggle');
  await page.waitForTimeout(400);
  const backToDark = await readTheme();
  check(backToDark.theme === 'dark', `touch: a second tap goes back to night mode (${backToDark.theme})`);
  check(backToDark.bgTop === before.bgTop, `touch: the night ground is restored (${backToDark.bgTop})`);

  // ---- the same two taps in 3D, on the projected segments.
  if (has3D) {
    await page.tap('#view-3d');
    await page.waitForTimeout(900);
    check(await page.locator('#graph-canvas-3d').isVisible(), 'touch: 3D canvas is mounted');
    await tapNodeThenEdge('3d', '#graph-canvas-3d');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(here, 'smoke-touch-dark-3d.png') });
    await page.tap('#view-2d');
    await page.waitForTimeout(500);
  } else {
    console.log('SKIP  touch: 3D module not built yet (viewer/dist/ui/graph-view-3d.js)');
    await page.screenshot({ path: path.join(here, 'smoke-touch-dark-3d.png') });
  }

  // ---- the day hero shot: same constellation, inverted luminance, no selection.
  await page.tap('#theme-toggle');
  await page.waitForTimeout(300);
  await page.goto(url + '&view=2d'); // a fresh load also proves the inline bootstrap stamps day
  await page.waitForSelector('#screen-graph:not([hidden])', { timeout: 15000 }).catch(() => {});
  const booted = await page.evaluate(() => document.documentElement.dataset.theme);
  check(booted === 'light', `touch: the stored theme is stamped before paint on reload (${booted})`);
  await page.waitForTimeout(1200);
  check(await page.locator('#graph-canvas').isVisible(), 'touch: the day 2D canvas renders');
  await page.screenshot({ path: path.join(here, 'smoke-touch-light-2d.png') });

  check(consoleErrors.length === 0, `touch: no console/page errors (${consoleErrors.slice(0, 3).join(' | ')})`);
  if (edge2d) console.log(`      touch: 2D edge tapped = ${edge2d.id} ("${edge2d.relation}")`);
  await page.close();
  await context.close();
}

// ------------------------------------------------ dark hero shot (v0.3)
// The identity of the viewer is judged on this one: night ground, luminous
// nodes, chrome that recedes. Nothing is asserted about pixels — only that the
// dark theme renders the 3D Context projection without errors.
{
  const { page, consoleErrors } = await open(
    { width: 1280, height: 800 },
    { colorScheme: 'dark', query: has3D ? '&view=3d&projection=context' : '' }
  );
  const theme = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim()
  );
  check(theme === '#070a14', `dark: the canvas ground is the night token (${theme || 'unset'})`);
  const wrap = await page.evaluate(() => getComputedStyle(document.querySelector('.canvas-wrap')).backgroundColor);
  check(wrap === 'rgb(7, 10, 20)', `dark: .canvas-wrap matches --canvas-bg, so there is no flash (${wrap})`);
  if (has3D) {
    await page.waitForTimeout(900);
    check(await page.locator('#graph-canvas-3d').isVisible(), 'dark: 3D Context projection renders');
  }
  check(consoleErrors.length === 0, `dark: no console/page errors (${consoleErrors.slice(0, 3).join(' | ')})`);
  await page.screenshot({ path: path.join(here, 'smoke-dark.png') });
  await page.close();
}

await browser.close();
server.close();
console.log(failures.length ? `\nSMOKE FAILED (${failures.length})` : '\nSMOKE OK');
process.exit(failures.length ? 1 : 0);
