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

async function open(viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector('#screen-graph:not([hidden])', { timeout: 15000 }).catch(() => {});
  return { page, consoleErrors };
}

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

await browser.close();
server.close();
console.log(failures.length ? `\nSMOKE FAILED (${failures.length})` : '\nSMOKE OK');
process.exit(failures.length ? 1 : 0);
