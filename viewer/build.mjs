#!/usr/bin/env node
// Build = copy. The viewer is plain HTML + CSS + ES modules with zero runtime
// dependencies, so there is nothing to bundle, transpile or minify (CDC §42).
import { cp, rm, mkdir, readdir, stat } from 'node:fs/promises';
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

async function main() {
  if (!existsSync(src)) {
    console.error(`build: missing source directory ${src}`);
    process.exit(1);
  }
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await cp(src, dist, { recursive: true });

  const entry = path.join(dist, 'index.html');
  if (!existsSync(entry)) {
    console.error('build: dist/index.html was not produced');
    process.exit(1);
  }
  const { files, bytes } = await countFiles(dist);
  console.log(`build: copied ${files} file(s), ${(bytes / 1024).toFixed(1)} KiB -> ${path.relative(root, dist)}/`);
  console.log('build: entry point dist/index.html');
}

main().catch((err) => {
  console.error('build: failed');
  console.error(err);
  process.exit(1);
});
