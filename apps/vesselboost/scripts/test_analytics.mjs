import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');

assert.match(html, /The Neurodesk hosting layer records page views only/);
assert.match(html, /Do Not Track or Global Privacy Control/);
assert.match(html, /does not send custom events/);
assert.doesNotMatch(
  html,
  /googletagmanager\.com\/gtag\/js|gtag\(['"]config['"]/,
  'app source leaves analytics bootstrap to the shared hosting shell',
);
assert.doesNotMatch(html, /cloudflareinsights|data-cf-beacon|Cloudflare Web Analytics/i);

console.log('Analytics and privacy checks passed.');
