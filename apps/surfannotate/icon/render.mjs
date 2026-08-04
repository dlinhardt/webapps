// Render the favicons from icon/surfannotate.svg.
//
//   node icon/render.mjs
//
// The PNGs in public/ are what the browser actually loads — the SVG is not
// shipped. It is ~46 kB gzipped against 1.4 kB for the 32px PNG a tab uses,
// which is a poor trade for an icon drawn at 16px, and the rasterised versions
// are indistinguishable at every size a browser asks for.
//
// Rendering happens in a browser because the artwork is one 187 kB path and
// there is no image toolchain in this repo. Playwright is already a dev
// dependency for the e2e suite.

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SIZES = [32, 48, 180, 256];

const svg = readFileSync(join(here, 'surfannotate.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

const rendered = await page.evaluate(async ({ source, sizes }) => {
  const image = new Image();
  image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(source)));
  await image.decode();
  const out = {};
  for (const size of sizes) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    // The SVG's viewBox is already square and tight to the painted bounds, so
    // this neither stretches nor letterboxes.
    ctx.drawImage(image, 0, 0, size, size);
    out[size] = canvas.toDataURL('image/png').split(',')[1];
  }
  return out;
}, { source: svg, sizes: SIZES });

await browser.close();

for (const size of SIZES) {
  const bytes = Buffer.from(rendered[size], 'base64');
  const path = join(here, '..', 'public', `favicon-${size}.png`);
  writeFileSync(path, bytes);
  console.log(`favicon-${size}.png  ${bytes.length} bytes`);
}
