#!/usr/bin/env node
// Post-process the CommonJS build so it can live side-by-side with the ESM
// build in `dist/`:
//
//   1. Rename every emitted `.js` to `.cjs` and move it under `dist/`,
//      preserving the directory layout.
//   2. Inside each `.cjs`, rewrite `require('./foo.js')` → `require('./foo.cjs')`
//      so Node resolves siblings to the CJS variant.
//   3. Copy each emitted `.d.ts` (from the ESM build) to a sibling `.d.cts`
//      so TypeScript consumers under `moduleResolution: "node"` find types.
//   4. Drop the staging `dist-cjs/` directory.
//
// Zero runtime deps; runs on Node 20+.

import { readdir, readFile, writeFile, mkdir, copyFile, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const stage = join(root, 'dist-cjs');
const dist = join(root, 'dist');

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function moveCjs() {
  let moved = 0;
  for await (const file of walk(stage)) {
    if (!file.endsWith('.js')) continue;
    const rel = relative(stage, file).replace(/\.js$/, '.cjs');
    const target = join(dist, rel);
    await ensureDir(dirname(target));

    let content = await readFile(file, 'utf8');
    // Sibling .js → .cjs rewrites. Anchored on the closing quote so we don't
    // touch paths that happen to embed ".js" elsewhere (e.g. inside a string
    // literal that's not a require).
    content = content.replace(/require\((['"])([^'"]+?)\.js\1\)/g, 'require($1$2.cjs$1)');
    await writeFile(target, content);
    moved++;
  }
  return moved;
}

async function copyDts() {
  let copied = 0;
  for await (const file of walk(dist)) {
    if (!file.endsWith('.d.ts')) continue;
    // Skip any .d.cts we already wrote on a previous run.
    const target = file.replace(/\.d\.ts$/, '.d.cts');
    if (file === target) continue;
    await copyFile(file, target);
    copied++;
  }
  return copied;
}

const moved = await moveCjs();
const copied = await copyDts();
if (await exists(stage)) {
  await rm(stage, { recursive: true, force: true });
}

console.log(`finalize: moved ${moved} .cjs file(s), wrote ${copied} .d.cts file(s)`);
