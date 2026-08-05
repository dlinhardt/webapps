import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { loadAppsRegistry, repoRoot } from '../scripts/lib/apps-registry.mjs';
import { validateAssetManifest } from '../scripts/lib/scientific-assets.mjs';

test('catalog contains every app workspace without a repeated inventory', async () => {
  const registry = await loadAppsRegistry();
  const workspaceIds = [];
  for (const entry of await readdir(join(repoRoot, 'apps'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      await access(join(repoRoot, 'apps', entry.name, 'package.json'));
      workspaceIds.push(entry.name);
    } catch {}
  }
  assert.deepEqual(registry.apps.map(({ id }) => id).sort(), workspaceIds.sort());
});

test('every catalog entry has a workspace and declared manifest', async () => {
  const registry = await loadAppsRegistry();
  for (const app of registry.apps) {
    await access(join(repoRoot, 'apps', app.id, 'package.json'));
    if (app.model_manifest) await access(join(repoRoot, app.model_manifest));
  }
});

test('every app has searchable category metadata', async () => {
  const registry = await loadAppsRegistry();
  const categoryIds = new Set(registry.site.categories.map(({ id }) => id));
  assert.equal(categoryIds.size, registry.site.categories.length);
  for (const app of registry.apps) {
    assert.ok(categoryIds.has(app.category), `${app.id} must use a declared category`);
    assert.ok(app.keywords.length >= 3, `${app.id} must provide useful search keywords`);
  }
});

test('BrowserQC scientific assets are pinned to Hugging Face and not embedded', async () => {
  const manifest = JSON.parse(
    await readFile(join(repoRoot, 'models', 'browserqc.manifest.json'), 'utf8'),
  );
  const source = await readFile(join(repoRoot, 'apps', 'browserqc', 'src', 'main.ts'), 'utf8');

  assert.match(manifest.revision, /^[0-9a-f]{40}$/);
  assert.ok(manifest.base_url.includes(`/resolve/${manifest.revision}/browserqc/`));
  assert.ok(source.includes(manifest.base_url));

  for (const asset of manifest.assets) {
    await assert.rejects(
      access(join(repoRoot, 'apps', 'browserqc', 'public', asset.filename)),
      `${asset.filename} must be fetched from Hugging Face`,
    );
  }
});

test('QSMbly example data stays outside the static release artifact', async () => {
  const packageJson = JSON.parse(
    await readFile(join(repoRoot, 'apps', 'qsmbly', 'package.json'), 'utf8'),
  );
  assert.ok(!packageJson.neurodeskWebapp.static.include.includes('data'));
});

test('CI app-test matrix covers the complete catalog', async () => {
  const workflow = parse(await readFile(join(repoRoot, '.github/workflows/ci.yml'), 'utf8'));
  assert.equal(workflow.jobs['app-tests'].needs, 'app-plan');
  assert.match(workflow.jobs['app-tests'].if, /has_apps/);
  assert.match(workflow.jobs['app-tests'].strategy.matrix, /fromJSON\(needs\.app-plan\.outputs\.apps\)/);
});

test('release workflow runs each app\'s declared release test script', async () => {
  const registry = await loadAppsRegistry();
  for (const app of registry.apps) {
    const packageJson = JSON.parse(
      await readFile(join(repoRoot, 'apps', app.id, 'package.json'), 'utf8'),
    );
    const releaseTest = app.ci.release_test ?? 'test';
    assert.ok(packageJson.scripts?.[releaseTest], `${app.id} must define ${releaseTest}`);
  }

  const workflow = parse(await readFile(join(repoRoot, '.github/workflows/release.yml'), 'utf8'));
  const step = workflow.jobs.verify.steps.find(({ name }) => name === 'Test app');
  assert.equal(step.env.RELEASE_TEST, '${{ matrix.release_test }}');
  assert.match(step.run, /run \"\$RELEASE_TEST\"/);
});

test('SpinalCordToolbox routine releases exclude generated batch parity and worker inference', async () => {
  const packageJson = JSON.parse(
    await readFile(join(repoRoot, 'apps', 'spinalcordtoolbox', 'package.json'), 'utf8'),
  );
  const releaseTest = packageJson.scripts['test:release'];
  assert.match(releaseTest, /test:vertebrae:unit/);
  assert.match(releaseTest, /test:batch:webapp/);
  assert.doesNotMatch(releaseTest, /test:fixtures(?:\s|$)/);
  assert.doesNotMatch(releaseTest, /test:inference:e2e/);
  assert.doesNotMatch(releaseTest, /test:worker:protocol/);
});

test('every declared scientific asset manifest satisfies its selected schema', async () => {
  const registry = await loadAppsRegistry();
  const errors = [];
  for (const app of registry.apps) {
    for (const error of await validateAssetManifest(repoRoot, app)) errors.push(`${app.id}: ${error}`);
  }
  assert.deepEqual(errors, []);
});

test('pnpm is the only workspace lockfile authority', async () => {
  const found = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name === 'package-lock.json') found.push(path.slice(repoRoot.length + 1));
    }
  }
  await visit(repoRoot);
  assert.deepEqual(found, []);
});
