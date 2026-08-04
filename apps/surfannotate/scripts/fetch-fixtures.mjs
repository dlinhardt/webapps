#!/usr/bin/env node
// Download the surface fixtures the e2e suite needs.
//
// These are real cortical surfaces, so they are far too large to commit and
// would breach the artifact budget if they ever reached dist/. They live in
// test/fixtures/, which is gitignored, and are fetched on demand — the same
// pattern spinalcordtoolbox uses for its Hugging Face fixtures.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Node's global fetch ignores http_proxy/https_proxy unless NODE_USE_ENV_PROXY
// is set, and that has to be in place before the runtime starts. Re-exec once
// when a proxy is configured but the flag is not, so the script works the same
// on a developer laptop and behind a corporate proxy.
if ((process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy ||
     process.env.HTTP_PROXY) && !process.env.NODE_USE_ENV_PROXY) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' }
  });
  process.exit(result.status ?? 1);
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', 'test', 'fixtures');

// NiiVue's demo assets: BSD-2-Clause, same licence as NiiVue itself.
const BASE = 'https://niivue.com/demos/images';
const FILES = [
  { name: 'lh.pial', minBytes: 5_000_000 },   // FreeSurfer binary, 163,842 vertices
  { name: 'lh.curv', minBytes: 600_000 }      // per-vertex curvature overlay
];

const RETRIES = 3;

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw new Error(`${url}: ${lastError.message}`);
}

await mkdir(fixtureDir, { recursive: true });

for (const file of FILES) {
  const target = join(fixtureDir, file.name);
  if (await exists(target) && !process.env.SURFANNOTATE_FIXTURE_FORCE) {
    console.log(`have ${file.name}`);
    continue;
  }
  console.log(`fetching ${file.name}…`);
  const data = await fetchWithRetry(`${BASE}/${file.name}`);
  if (data.length < file.minBytes) {
    throw new Error(`${file.name} is ${data.length} bytes, expected at least ${file.minBytes} — ` +
      'the download probably returned an error page');
  }
  await writeFile(target, data);
  console.log(`  ${file.name}: ${data.length.toLocaleString()} bytes`);
}
