import assert from 'node:assert/strict';
import test from 'node:test';
import { injectCompositeTheme } from '../scripts/lib/composite-theme.mjs';

const document = '<!doctype html><html lang="en"><head><title>Example</title></head><body></body></html>';

test('injects the hosted app identity and theme stylesheet', () => {
  const themed = injectCompositeTheme(document, { appId: 'example-app' });

  assert.match(themed, /<html data-neurodesk-app="example-app" lang="en">/);
  assert.match(themed, /<link rel="stylesheet" href="\.\.\/app-theme\.css" data-neurodesk-app-theme>/);
});

test('theme injection is idempotent', () => {
  const themed = injectCompositeTheme(document, { appId: 'example-app' });
  const repeated = injectCompositeTheme(themed, { appId: 'example-app' });

  assert.equal(repeated, themed);
  assert.equal((repeated.match(/data-neurodesk-app-theme/g) ?? []).length, 1);
});

test('rejects invalid app ids and incomplete documents', () => {
  assert.throws(() => injectCompositeTheme(document, { appId: 'Not Valid' }), /Invalid app id/);
  assert.throws(() => injectCompositeTheme('<html><body></body></html>', { appId: 'example' }), /missing <\/head>/);
});
