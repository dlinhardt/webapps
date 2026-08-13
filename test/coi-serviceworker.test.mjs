import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { repoRoot } from '../scripts/lib/apps-registry.mjs';

const source = await readFile(
  join(repoRoot, 'packages', 'runtime-support', 'src', 'coi-serviceworker.js'),
  'utf8',
);

test('recovers when an update reload happens before the worker controls the page', async () => {
  const storage = new Map([['coiReloadedBySelf', 'updatefound']]);
  let registrations = 0;
  let reloads = 0;
  const registration = {
    active: { state: 'activated' },
    addEventListener() {},
  };
  const serviceWorker = {
    controller: null,
    register: async () => {
      registrations++;
      return registration;
    },
  };
  const window = {
    crossOriginIsolated: false,
    isSecureContext: true,
    document: {
      currentScript: { src: 'https://example.test/app/coi-serviceworker.js' },
    },
    location: {
      reload() {
        reloads++;
      },
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, value),
    },
  };

  vm.runInNewContext(source, {
    console: { error() {}, log() {}, warn() {} },
    navigator: { serviceWorker },
    window,
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(registrations, 1);
  assert.equal(reloads, 1);
  assert.equal(storage.get('coiReloadedBySelf'), 'notcontrolling');
});
