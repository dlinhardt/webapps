import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const css = await readFile(new URL('../site/app-theme.css', import.meta.url), 'utf8');

function token(name) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  assert.ok(match, `missing concrete --${name} token`);
  return match[1].toLowerCase();
}

function luminance(hex) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

test('hosted theme uses the official Neurodesk designer-guide palette', () => {
  assert.equal(token('nd-brand-primary'), '#6aa329');
  assert.equal(token('nd-brand-menu'), '#0c0e0a');
  assert.equal(token('nd-brand-selection'), '#161c10');
  assert.equal(token('nd-brand-accent-background'), '#1e2a16');
  assert.equal(token('nd-brand-selected'), '#4f7b38');
  assert.equal(token('nd-brand-hover'), '#b7d886');
  assert.equal(token('nd-brand-unselected'), '#e6f1d6');
  assert.equal(token('nd-brand-pale'), '#f0f7e7');
});

test('core UI pairings meet WCAG AA text contrast', () => {
  assert.ok(contrast(token('nd-brand-text'), token('nd-brand-surface')) >= 4.5);
  assert.ok(contrast(token('nd-brand-text-muted'), token('nd-brand-surface')) >= 7);
  assert.ok(contrast(token('nd-brand-action-text'), token('nd-brand-primary')) >= 4.5);
  assert.ok(contrast(token('nd-brand-menu-text'), token('nd-brand-menu')) >= 4.5);
  assert.ok(contrast(token('nd-brand-selected'), token('nd-brand-surface')) >= 4.5);
  assert.ok(contrast(token('nd-brand-selected'), token('nd-brand-pale')) >= 4.5);
  assert.ok(contrast(token('nd-brand-console-text'), token('nd-brand-console-surface')) >= 7);
  assert.ok(contrast(token('nd-brand-console-time'), token('nd-brand-console-surface')) >= 4.5);
});

test('disabled controls keep full opacity and readable text', () => {
  assert.match(css, /\[data-neurodesk-app\] :is\([^}]*:disabled[^}]*\)\s*\{[^}]*opacity:\s*1/s);
});
