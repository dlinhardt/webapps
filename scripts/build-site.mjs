#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadAppsRegistry, repoRoot } from './lib/apps-registry.mjs';
import { injectCompositeTheme } from './lib/composite-theme.mjs';
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

  const indexPath = join(destination, 'index.html');
  const indexHtml = await readFile(indexPath, 'utf8');
  const appPackage = JSON.parse(await readFile(join(repoRoot, 'apps', app.id, 'package.json'), 'utf8'));
  await writeFile(indexPath, injectCompositeTheme(indexHtml, {
    appId: app.id,
    title: app.title,
    description: app.description,
    version: appPackage.version,
    measurementId: registry.site.analytics.measurement_id,
  }));
}

await assembleRuntimeAssetStore({ repoRoot, siteDist, registry });

await writeFile(join(siteDist, 'index.html'), renderLandingPage(registry));
await cp(join(repoRoot, 'site', 'landing.css'), join(siteDist, 'landing.css'));
await cp(join(repoRoot, 'site', 'landing.js'), join(siteDist, 'landing.js'));
await cp(join(repoRoot, 'site', 'neurodesk-logo.svg'), join(siteDist, 'neurodesk-logo.svg'));
await cp(join(repoRoot, 'site', 'app-theme.css'), join(siteDist, 'app-theme.css'));
await cp(join(repoRoot, 'site', 'app-shell.js'), join(siteDist, 'app-shell.js'));
await cp(join(repoRoot, 'packages', 'analytics', 'src', 'index.js'), join(siteDist, 'analytics.js'));
await cp(join(repoRoot, 'site', 'analytics.json'), join(siteDist, 'analytics.json'));
await writeFile(join(siteDist, '.nojekyll'), '');
await writeFile(join(siteDist, '_headers'), `/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: credentialless\n  X-Content-Type-Options: nosniff\n`);
console.log(`Assembled ${registry.apps.length} apps at ${siteDist}`);
