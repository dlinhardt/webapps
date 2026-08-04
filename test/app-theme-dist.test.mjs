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
  await mkdir(distDir);
  await writeFile(
    join(distDir, 'index.html'),
    '<!doctype html><html lang="en"><head><title>App</title></head><body></body></html>',
  );
  await writeFile(themeFile, ':root { --neurodesk-primary: #6aa329; }');

  await applyAppTheme({ appId: 'example-app', distDir, themeFile });

  const html = await readFile(join(distDir, 'index.html'), 'utf8');
  assert.match(html, /<html data-neurodesk-app="example-app" lang="en">/);
  assert.match(html, /href="\.\/app-theme\.css" data-neurodesk-app-theme/);
  assert.equal(
    await readFile(join(distDir, 'app-theme.css'), 'utf8'),
    ':root { --neurodesk-primary: #6aa329; }',
  );
});
