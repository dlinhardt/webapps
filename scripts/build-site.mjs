#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadAppsRegistry, repoRoot } from './lib/apps-registry.mjs';
import { renderLandingPage } from './lib/landing-page.mjs';
import { assembleRuntimeAssetStore } from './lib/runtime-assets.mjs';

const registry = await loadAppsRegistry();
const siteDist = join(repoRoot, 'dist');
await rm(siteDist, { recursive: true, force: true });
await mkdir(siteDist, { recursive: true });

for (const app of registry.apps) {
  const source = join(repoRoot, 'apps', app.id, 'dist');
  const destination = join(siteDist, app.path);
  await cp(source, destination, { recursive: true });
}

await assembleRuntimeAssetStore({ repoRoot, siteDist, registry });

await writeFile(join(siteDist, 'index.html'), renderLandingPage(registry));
await cp(join(repoRoot, 'site', 'landing.css'), join(siteDist, 'landing.css'));
await cp(join(repoRoot, 'site', 'landing.js'), join(siteDist, 'landing.js'));
await writeFile(join(siteDist, '.nojekyll'), '');
await writeFile(join(siteDist, '_headers'), `/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: credentialless\n  X-Content-Type-Options: nosniff\n`);
console.log(`Assembled ${registry.apps.length} apps at ${siteDist}`);
