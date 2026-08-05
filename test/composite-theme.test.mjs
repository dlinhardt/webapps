import assert from 'node:assert/strict';
import test from 'node:test';
import { injectCompositeTheme } from '../scripts/lib/composite-theme.mjs';

const document = '<!doctype html><html lang="en"><head><title>Example</title></head><body></body></html>';
const metadata = {
  appId: 'example-app',
  title: 'Example App',
  description: 'A short explanation.',
  version: '1.2.3',
  measurementId: 'G-4Z9774J59Y',
};

test('injects the hosted app identity, theme, and shared top-bar contract', () => {
  const themed = injectCompositeTheme(document, metadata);

  assert.match(themed, /<html data-neurodesk-app="example-app" data-neurodesk-theme="dark" lang="en">/);
  assert.match(themed, /<script src="\.\.\/theme\.js" data-neurodesk-theme-controller><\/script>/);
  assert.match(themed, /<link rel="stylesheet" href="\.\.\/app-theme\.css" data-neurodesk-app-theme>/);
  assert.match(themed, /src="\.\.\/app-shell\.js" data-neurodesk-app-shell/);
  assert.match(themed, /data-app-title="Example App"/);
  assert.match(themed, /data-app-description="A short explanation\."/);
  assert.match(themed, /data-app-version="1\.2\.3"/);
  assert.match(themed, /data-ga4-measurement-id="G-4Z9774J59Y"/);
  assert.match(themed, /data-analytics-href="\.\.\/analytics\.js"/);
  assert.match(themed, /data-source-href="https:\/\/github\.com\/neurodesk\/webapps\/tree\/main\/apps\/example-app"/);
});

test('theme injection is idempotent', () => {
  const themed = injectCompositeTheme(document, metadata);
  const repeated = injectCompositeTheme(themed, metadata);

  assert.equal(repeated, themed);
  assert.equal((repeated.match(/data-neurodesk-app-theme/g) ?? []).length, 1);
  assert.equal((repeated.match(/data-neurodesk-theme-controller/g) ?? []).length, 1);
  assert.equal((repeated.match(/data-neurodesk-app-shell/g) ?? []).length, 1);
  assert.equal((repeated.match(/data-neurodesk-theme="/g) ?? []).length, 1);
});

test('adds the controller to an app that already has the shared stylesheet', () => {
  const legacy = document.replace(
    '</head>',
    '<link rel="stylesheet" href="../app-theme.css" data-neurodesk-app-theme></head>',
  );
  const themed = injectCompositeTheme(legacy, metadata);

  assert.match(themed, /data-neurodesk-theme-controller/);
  assert.equal((themed.match(/data-neurodesk-app-theme/g) ?? []).length, 1);
});

test('rejects invalid app ids and incomplete documents', () => {
  assert.throws(() => injectCompositeTheme(document, { ...metadata, appId: 'Not Valid' }), /Invalid app id/);
  assert.throws(() => injectCompositeTheme(document, { ...metadata, title: '' }), /title must be a non-empty string/);
  assert.throws(() => injectCompositeTheme('<html><body></body></html>', metadata), /missing <\/head>/);
});
