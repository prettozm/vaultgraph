#!/usr/bin/env node
// Build = copy. The viewer is plain HTML + CSS + ES modules with zero runtime
// dependencies, so there is nothing to bundle, transpile or minify (CDC §42).
import { cp, rm, mkdir, readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

async function countFiles(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await countFiles(full);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      files += 1;
      bytes += (await stat(full)).size;
    }
  }
  return { files, bytes };
}

/** Stable short hash of every source file — becomes the cache-busting `?v=` and the build stamp. */
async function sourceHash(dir, hash = createHash('sha1')) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await sourceHash(full, hash);
    else hash.update(entry.name).update(await readFile(full));
  }
  return hash;
}

/** Append `?v=<build>` to every relative module/stylesheet reference so GitHub Pages' 10-minute
 *  cache can never serve a stale module next to a fresh one. Also stamps the build id on the page. */
async function stampAndBust(dir, build) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { await stampAndBust(full, build); continue; }
    if (!/\.(js|mjs|html)$/.test(entry.name)) continue;
    let text = await readFile(full, 'utf8');
    text = text
      .replace(/(from\s+['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g, `$1$2?v=${build}$3`)
      .replace(/(import\(\s*['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g, `$1$2?v=${build}$3`);
    if (entry.name.endsWith('.html')) {
      text = text
        .replace(/((?:src|href)=")(\.\/[^"?]+\.(?:js|css))(")/g, `$1$2?v=${build}$3`)
        .replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta name="vault-graph-build" content="${build}" />`);
    }
    await writeFile(full, text);
  }
}

async function main() {
  if (!existsSync(src)) {
    console.error(`build: missing source directory ${src}`);
    process.exit(1);
  }
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await cp(src, dist, { recursive: true });
  const build = (await sourceHash(src)).digest('hex').slice(0, 8);
  await stampAndBust(dist, build);

  const entry = path.join(dist, 'index.html');
  if (!existsSync(entry)) {
    console.error('build: dist/index.html was not produced');
    process.exit(1);
  }
  const { files, bytes } = await countFiles(dist);
  console.log(`build: copied ${files} file(s), ${(bytes / 1024).toFixed(1)} KiB -> ${path.relative(root, dist)}/`);
  console.log(`build: entry point dist/index.html (build ${build}, cache-busted)`);
}

main().catch((err) => {
  console.error('build: failed');
  console.error(err);
  process.exit(1);
});
