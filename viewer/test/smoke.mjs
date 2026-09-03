// Optional end-to-end smoke test: serves the repository root over HTTP, drives the built
// viewer in headless Chromium against the repository's own .vault-graph, and writes a
// screenshot. Requires a Playwright installation resolvable by Node (global install is fine:
// NODE_PATH=/opt/node22/lib/node_modules). Not part of `npm test`.
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

const failures = [];
const check = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) failures.push(msg); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
await page.goto(url);
await page.waitForSelector('#screen-graph:not([hidden])', { timeout: 15000 }).catch(() => {});

const visible = await page.evaluate(() => [...document.querySelectorAll('[id^="screen-"]')].filter((e) => !e.hidden).map((e) => e.id));
check(visible.includes('screen-graph'), `graph screen shown (visible: ${visible.join(',')})`);
const meta = await page.locator('#meta').innerText().catch(() => '');
check(/generated/i.test(meta), `meta shows generation date: ${meta.replace(/\s+/g, ' ').slice(0, 160)}`);
check(/39/.test(meta) && /64/.test(meta), 'meta shows 39 nodes / 64 edges');
const manifestDoc = await fetch(target).then((r) => r.json()).catch(() => ({}));
const shortCommit = String(manifestDoc?.source?.commit || '').slice(0, 7);
check(shortCommit.length === 7 && meta.includes(shortCommit), `meta shows source commit ${shortCommit || '(none in manifest)'}`);
const filters = await page.locator('#filters').innerText().catch(() => '');
check(/electronique/.test(filters) && /finance/.test(filters), 'filters discovered contexts electronique & finance');
check(/candidate/.test(filters), 'filters expose candidate status (relations)');
await page.fill('#search-input', 'résistance');
await page.waitForTimeout(400);
console.log('FILTERS>', filters.replace(/\s+/g, ' ').slice(0, 400));
const count = await page.locator('#search-count').innerText().catch(() => '');
check(/[2-9]/.test(count), `search "résistance" finds several nodes (${count.trim()})`);
check(consoleErrors.length === 0, `no console/page errors (${consoleErrors.slice(0, 3).join(' | ')})`);
await page.screenshot({ path: path.join(here, 'smoke.png') });
await browser.close();
server.close();
console.log(failures.length ? `\nSMOKE FAILED (${failures.length})` : '\nSMOKE OK');
process.exit(failures.length ? 1 : 0);
