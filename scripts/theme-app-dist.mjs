#!/usr/bin/env node
import { join } from 'node:path';
import { findApp, loadAppsRegistry, repoRoot } from './lib/apps-registry.mjs';
import { applyAppTheme } from './lib/app-theme-dist.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const appId = option('--app');
if (!appId) throw new Error('Usage: node scripts/theme-app-dist.mjs --app <app-id>');

const registry = await loadAppsRegistry();
findApp(registry, appId);

await applyAppTheme({
  appId,
  distDir: join(repoRoot, 'apps', appId, 'dist'),
  themeFile: join(repoRoot, 'site', 'app-theme.css'),
});

console.log(`Applied the Neurodesk theme to the ${appId} standalone bundle`);
