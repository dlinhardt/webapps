import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyAppTheme } from '../scripts/lib/app-theme-dist.mjs';

test('adds the shared theme to a standalone app distribution', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'neurodesk-app-theme-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const distDir = join(root, 'dist');
  const themeFile = join(root, 'theme.css');
  const themeScriptFile = join(root, 'theme.js');
  const shellFile = join(root, 'app-shell.js');
  const analyticsFile = join(root, 'analytics.js');
  await mkdir(distDir);
  await writeFile(
    join(distDir, 'index.html'),
    '<!doctype html><html lang="en"><head><title>App</title></head><body></body></html>',
  );
  await writeFile(themeFile, ':root { --neurodesk-primary: #6aa329; }');
  await writeFile(themeScriptFile, '/* shared theme controller */');
  await writeFile(shellFile, '/* shared app shell */');
  await writeFile(analyticsFile, '/* page-view analytics */');

  await applyAppTheme({
    app: {
      id: 'example-app',
      title: 'Example App',
      description: 'An example scientific app.',
    },
    version: '1.2.3',
    measurementId: 'G-4Z9774J59Y',
    distDir,
    themeFile,
    themeScriptFile,
    shellFile,
    analyticsFile,
  });

  const html = await readFile(join(distDir, 'index.html'), 'utf8');
  assert.match(html, /<html data-neurodesk-app="example-app" data-neurodesk-theme="dark" lang="en">/);
  assert.match(html, /href="\.\/app-theme\.css" data-neurodesk-app-theme/);
  assert.match(html, /src="\.\/theme\.js" data-neurodesk-theme-controller/);
  assert.match(html, /src="\.\/app-shell\.js" data-neurodesk-app-shell/);
  assert.match(html, /data-app-title="Example App"/);
  assert.match(html, /data-ga4-measurement-id="G-4Z9774J59Y"/);
  assert.equal(
    await readFile(join(distDir, 'app-theme.css'), 'utf8'),
    ':root { --neurodesk-primary: #6aa329; }',
  );
  assert.equal(await readFile(join(distDir, 'theme.js'), 'utf8'), '/* shared theme controller */');
  assert.equal(await readFile(join(distDir, 'app-shell.js'), 'utf8'), '/* shared app shell */');
  assert.equal(await readFile(join(distDir, 'analytics.js'), 'utf8'), '/* page-view analytics */');
});
