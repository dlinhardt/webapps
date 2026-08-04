import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('standalone theme is applied after tests and before auditing and packaging', () => {
  const browserTest = workflow.indexOf('- name: Test shared runtime in a browser');
  const applyTheme = workflow.indexOf('- name: Apply Neurodesk app theme');
  const auditArtifact = workflow.indexOf('- name: Enforce standalone artifact budgets');
  const packageBundle = workflow.indexOf('- name: Package standalone app bundle');

  assert.ok(browserTest >= 0, 'browser test step is missing');
  assert.ok(browserTest < applyTheme, 'browser tests can overwrite the themed distribution');
  assert.ok(applyTheme < auditArtifact, 'the themed artifact must be audited');
  assert.ok(auditArtifact < packageBundle, 'the audited artifact must be the packaged artifact');
});
