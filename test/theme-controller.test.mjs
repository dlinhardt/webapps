import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const controller = await readFile(new URL('../site/theme.js', import.meta.url), 'utf8');
const markup = `<!doctype html>
<html data-neurodesk-theme="dark"><body>
  <button data-neurodesk-theme-toggle><span data-neurodesk-theme-label>Light</span></button>
</body></html>`;

function createDocument(storedTheme) {
  const dom = new JSDOM(markup, { runScripts: 'outside-only', url: 'https://neurodesk.test/' });
  if (storedTheme) dom.window.localStorage.setItem('neurodesk-theme', storedTheme);
  dom.window.eval(controller);
  return dom;
}

test('theme controller defaults to dark and switches to light', () => {
  const dom = createDocument();
  const { document, localStorage, NeurodeskTheme } = dom.window;
  const toggle = document.querySelector('[data-neurodesk-theme-toggle]');

  assert.equal(NeurodeskTheme.get(), 'dark');
  assert.equal(toggle.textContent.trim(), 'Light');
  assert.equal(toggle.getAttribute('aria-label'), 'Use light theme');

  toggle.click();

  assert.equal(document.documentElement.dataset.neurodeskTheme, 'light');
  assert.equal(document.documentElement.style.colorScheme, 'light');
  assert.equal(localStorage.getItem('neurodesk-theme'), 'light');
  assert.equal(toggle.textContent.trim(), 'Dark');
  assert.equal(toggle.getAttribute('aria-label'), 'Use dark theme');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  dom.window.close();
});

test('theme controller restores a stored preference and syncs late-mounted controls', async () => {
  const dom = createDocument('light');
  const toggle = dom.window.document.querySelector('[data-neurodesk-theme-toggle]');

  assert.equal(dom.window.NeurodeskTheme.get(), 'light');
  assert.equal(toggle.textContent.trim(), 'Dark');

  const lateToggle = dom.window.document.createElement('button');
  lateToggle.dataset.neurodeskThemeToggle = '';
  lateToggle.innerHTML = '<span data-neurodesk-theme-label>Light</span>';
  dom.window.document.body.append(lateToggle);
  await new Promise((resolve) => dom.window.queueMicrotask(resolve));

  assert.equal(lateToggle.textContent.trim(), 'Dark');
  assert.equal(lateToggle.getAttribute('aria-label'), 'Use dark theme');
  dom.window.close();
});
