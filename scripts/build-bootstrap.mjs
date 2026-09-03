#!/usr/bin/env node
// Builds dist/vault-graph-bootstrap.zip from template/.vault-graph/ using a
// zero-dependency, byte-for-byte deterministic ZIP writer (local file
// headers + central directory + EOCD, CRC-32, deflate via zlib).
//
// Usage:
//   node scripts/build-bootstrap.mjs               build dist/vault-graph-bootstrap.zip
//   node scripts/build-bootstrap.mjs --out <path>   build to a custom path
//   node scripts/build-bootstrap.mjs --check        build in memory and diff
//                                                    against the committed zip;
//                                                    exit 1 if different, write nothing
//
// Exit 0 on success, 1 on failure (missing source dir, or --check mismatch).

import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "./lib/common.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "template", ".vault-graph");
const defaultOut = path.join(repoRoot, "dist", "vault-graph-bootstrap.zip");

const args = process.argv.slice(2);
const checkMode = args.includes("--check");
let outPath = defaultOut;
const outIdx = args.indexOf("--out");
if (outIdx !== -1) {
  const val = args[outIdx + 1];
  if (!val) {
    console.error("--out requires a path argument");
    process.exit(1);
  }
  outPath = path.resolve(process.cwd(), val);
}

if (!existsSync(sourceDir)) {
  console.error(`FAIL source directory not found: ${sourceDir}`);
  process.exit(1);
}

// --- Fixed DOS date/time: 2026-01-01 00:00:00 --------------------------------
const FIXED_DOS_DATE = (((2026 - 1980) << 9) | (1 << 5) | 1) & 0xffff;
const FIXED_DOS_TIME = 0x0000;

// --- CRC-32 ------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// --- Collect files under sourceDir, sorted, forward-slash relative paths ----
function collectFiles(dir, baseDir, acc) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, baseDir, acc);
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, full).split(path.sep).join("/");
      acc.push({ full, rel });
    }
  }
  return acc;
}

const files = collectFiles(sourceDir, sourceDir, []).sort((a, b) =>
  a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0,
);

// --- Build the ZIP buffer deterministically ----------------------------------
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = (3 << 8) | 20; // host: unix (3)
const UNIX_MODE_0644 = 0o100644; // regular file, rw-r--r--
const EXTERNAL_ATTR = (UNIX_MODE_0644 << 16) >>> 0;

function buildZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const zipEntryName = `.vault-graph/${entry.rel}`;
    const nameBuf = Buffer.from(zipEntryName, "utf8");
    const data = readFileSync(entry.full);
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const method = useDeflate ? 8 : 0;
    const storedData = useDeflate ? deflated : data;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(VERSION_NEEDED, 4);
    localHeader.writeUInt16LE(0, 6); // general purpose bit flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(FIXED_DOS_TIME, 10);
    localHeader.writeUInt16LE(FIXED_DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(storedData.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuf, storedData);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(VERSION_MADE_BY, 4);
    centralHeader.writeUInt16LE(VERSION_NEEDED, 6);
    centralHeader.writeUInt16LE(0, 8); // general purpose bit flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(FIXED_DOS_TIME, 12);
    centralHeader.writeUInt16LE(FIXED_DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(storedData.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(EXTERNAL_ATTR, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + storedData.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const centralDirOffset = offset;
  const centralDirSize = centralDirBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

const zipBuffer = buildZipBuffer(files);
const digest = sha256Hex(zipBuffer);

if (checkMode) {
  if (!existsSync(defaultOut)) {
    console.error(`FAIL committed zip not found: ${defaultOut}`);
    process.exit(1);
  }
  const committed = readFileSync(defaultOut);
  const committedDigest = sha256Hex(committed);
  if (committedDigest !== digest) {
    console.error("FAIL committed dist/vault-graph-bootstrap.zip does not match a fresh build");
    console.error(`  committed sha256: ${committedDigest}`);
    console.error(`  fresh sha256:     ${digest}`);
    process.exit(1);
  }
  console.log(`OK dist/vault-graph-bootstrap.zip matches a fresh build (sha256 ${digest})`);
  process.exit(0);
}

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, zipBuffer);

console.log(`wrote ${outPath}`);
console.log(`sha256 ${digest}`);
console.log(`entries (${files.length}):`);
for (const f of files) {
  console.log(`  .vault-graph/${f.rel}`);
}
