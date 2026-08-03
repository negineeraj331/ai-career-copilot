#!/usr/bin/env node
/**
 * Enforces the initial-JS budget from docs/00 (250 KB gzipped).
 *
 * "Initial" means what a first-time visitor downloads before anything renders:
 * the entry chunk plus everything it statically imports. Lazy route chunks are
 * reported but not counted — they are exactly what code splitting is for, and
 * counting them would penalise the split that keeps the number low.
 *
 * Fails the build. A performance budget nobody enforces is a wish.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BUDGET_KB = 250;
const DIST = 'apps/web/dist';
const ASSETS = join(DIST, 'assets');

if (!existsSync(ASSETS)) {
  console.error(`No build output at ${ASSETS}. Run \`pnpm build\` first.`);
  process.exit(1);
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');

/**
 * The entry is whatever index.html loads as a module, plus every chunk it
 * modulepreloads — that preload list IS the static import graph, which is why
 * it is the right definition of "initial" rather than guessing by filename.
 */
const entry = [...html.matchAll(/<script[^>]+src="\/assets\/([^"]+)"/g)].map((m) => m[1]);
const preloaded = [
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+)"/g),
].map((m) => m[1]);

const initial = [...new Set([...entry, ...preloaded])].filter((f) => f.endsWith('.js'));

if (initial.length === 0) {
  console.error('Could not identify any initial chunk from index.html — check the build output.');
  process.exit(1);
}

const gzipOf = (file) => gzipSync(readFileSync(join(ASSETS, file))).length;

let total = 0;
console.log('Initial JS (gzipped):');
for (const file of initial.sort()) {
  const size = gzipOf(file);
  total += size;
  console.log(`  ${(size / 1024).toFixed(1).padStart(7)} KB  ${file}`);
}

const lazy = readdirSync(ASSETS)
  .filter((f) => f.endsWith('.js') && !initial.includes(f))
  .map((f) => ({ file: f, size: gzipOf(f) }))
  .sort((a, b) => b.size - a.size);

if (lazy.length > 0) {
  console.log('\nLazy chunks (not counted — this is code splitting working):');
  for (const { file, size } of lazy.slice(0, 8)) {
    console.log(`  ${(size / 1024).toFixed(1).padStart(7)} KB  ${file}`);
  }
}

const totalKb = total / 1024;
const pct = ((totalKb / BUDGET_KB) * 100).toFixed(0);
console.log(`\nTotal initial JS: ${totalKb.toFixed(1)} KB of ${BUDGET_KB} KB budget (${pct}%)`);

if (totalKb > BUDGET_KB) {
  console.error(`::error::Initial JS is ${totalKb.toFixed(1)} KB, over the ${BUDGET_KB} KB budget`);
  process.exit(1);
}

console.log('Within budget.');
