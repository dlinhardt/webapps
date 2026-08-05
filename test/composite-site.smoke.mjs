#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium } from '@playwright/test';
import { loadAppsRegistry, repoRoot } from '../scripts/lib/apps-registry.mjs';

const dist = join(repoRoot, 'dist');
const registry = await loadAppsRegistry();
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
]);

function resolveRequest(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = normalize(decoded).replace(/^[/\\]+/, '');
  if (relative.startsWith('..')) return null;
  return join(dist, relative);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    let path = resolveRequest(url.pathname);
    if (!path) {
      response.writeHead(400).end('Bad request');
      return;
    }

    let metadata;
    try {
      metadata = await stat(path);
    } catch {
      response.writeHead(404).end('Not found');
      return;
    }

    if (metadata.isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        response.writeHead(308, { location: `${url.pathname}/${url.search}` }).end();
        return;
      }
      path = join(path, 'index.html');
      metadata = await stat(path);
    }

    response.writeHead(200, {
      'content-length': metadata.size,
      'content-type': mimeTypes.get(extname(path)) ?? 'application/octet-stream',
      'cross-origin-embedder-policy': 'credentialless',
      'cross-origin-opener-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(path).pipe(response);
  } catch (error) {
    response.writeHead(500).end(error.message);
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const failures = [];

try {
  const privacyContext = await browser.newContext();
  await privacyContext.addInitScript(() => {
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });
  });
  const privacyPage = await privacyContext.newPage();
  let blockedGoogleRequests = 0;
  privacyPage.on('request', (request) => {
    if (/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/.test(request.url())) {
      blockedGoogleRequests += 1;
    }
  });
  await privacyPage.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await privacyPage.waitForTimeout(100);
  if (await privacyPage.locator('script[data-neurodesk-ga4]').count()) {
    failures.push('Do Not Track still injected the GA4 loader');
  }
  if (blockedGoogleRequests) failures.push(`Do Not Track allowed ${blockedGoogleRequests} Google analytics requests`);
  if (await privacyPage.evaluate(() => Boolean(window.dataLayer))) failures.push('Do Not Track still created dataLayer');
  await privacyContext.close();

  const landing = await browser.newPage();
  await landing.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/,
    (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await landing.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  const cards = await landing.locator('a.app-card').count();
  const landingText = await landing.locator('body').innerText();
  if (cards !== registry.apps.length) failures.push(`landing page has ${cards} app cards, expected ${registry.apps.length}`);
  if (landingText.includes('Models and large scientific assets are delivered from Hugging Face')) {
    failures.push('landing page still contains the removed scientific-assets message');
  }
  const landingGa = await landing.locator('script[data-neurodesk-ga4="G-4Z9774J59Y"]').count();
  if (landingGa !== 1) failures.push(`landing page has ${landingGa} shared GA4 loaders, expected 1`);
  const landingEvents = await landing.evaluate(() => (window.dataLayer ?? []).map((entry) => entry[0]));
  if (landingEvents.filter((name) => name === 'js').length !== 1
      || landingEvents.filter((name) => name === 'config').length !== 1
      || landingEvents.includes('event')) {
    failures.push(`landing analytics calls are out of contract: ${landingEvents.join(',')}`);
  }
  if (!(await landing.locator('#analytics').isVisible())) failures.push('landing analytics section is not visible');

  await landing.locator('#app-search').fill('DICOM');
  const dicomMatches = await landing.locator('[data-app-card]:not([hidden])').count();
  if (dicomMatches !== 2) failures.push(`landing search found ${dicomMatches} DICOM apps, expected 2`);

  await landing.locator('#clear-search').click();
  await landing.locator('[data-category-filter="quality-annotation"]').click();
  const qualityMatches = await landing.locator('[data-app-card]:not([hidden])').count();
  if (qualityMatches !== 2) failures.push(`quality category has ${qualityMatches} visible apps, expected 2`);

  await landing.locator('[data-category-filter="all"]').click();
  await landing.locator('#app-search').fill('no-such-neurodesk-app');
  if (!(await landing.locator('#no-results').isVisible())) failures.push('landing search does not show its empty state');
  await landing.locator('#reset-filters').click();
  const resetMatches = await landing.locator('[data-app-card]:not([hidden])').count();
  if (resetMatches !== registry.apps.length) failures.push(`landing reset shows ${resetMatches} apps, expected ${registry.apps.length}`);
  await landing.close();

  for (const app of registry.apps) {
    const page = await browser.newPage();
    await page.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/,
      (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    const pageErrors = [];
    const responseErrors = [];
    const subpathLeaks = [];
    let returningHome = false;

    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin === origin && response.status() >= 400) {
        responseErrors.push(`${response.status()} ${url.pathname}`);
      }
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== origin || url.pathname === `/favicon.ico`) return;
      if (url.pathname.startsWith('/_runtime/')) return;
      if (url.pathname === '/app-theme.css') return;
      if (url.pathname === '/app-shell.js') return;
      if (url.pathname === '/analytics.js') return;
      if (returningHome && url.pathname === '/') return;
      if (url.pathname !== `/${app.path}/` && !url.pathname.startsWith(`/${app.path}/`)) {
        subpathLeaks.push(url.pathname);
      }
    });

    const response = await page.goto(`${origin}/${app.path}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(app.id === 'seedseg' ? 4_000 : 1_000);
    const title = await page.title();
    const bodyText = await page.locator('body').innerText();
    const themeLinks = await page.locator('link[data-neurodesk-app-theme]').count();
    const shellScripts = await page.locator('script[data-neurodesk-app-shell]').count();
    const analyticsScripts = await page.locator('script[data-neurodesk-ga4="G-4Z9774J59Y"]').count();
    const visibleTopBars = page.locator('.nd-app-bar:visible');
    const topBarRows = await page.evaluate(() => [...new Set([...document.querySelectorAll('.nd-app-bar')]
      .filter((bar) => bar.getBoundingClientRect().height > 0)
      .map((bar) => Math.round(bar.getBoundingClientRect().top)))]);
    const themeState = await page.evaluate(() => ({
      appId: document.documentElement.dataset.neurodeskApp,
      brandPrimary: getComputedStyle(document.documentElement).getPropertyValue('--nd-brand-primary').trim(),
    }));

    if (!response?.ok()) failures.push(`${app.id}: document returned ${response?.status() ?? 'no response'}`);
    if (!title.trim()) failures.push(`${app.id}: empty document title`);
    if (!bodyText.trim()) failures.push(`${app.id}: empty rendered body`);
    if (themeLinks !== 1) failures.push(`${app.id}: found ${themeLinks} hosted theme links, expected 1`);
    if (shellScripts !== 1) failures.push(`${app.id}: found ${shellScripts} shared app-shell scripts, expected 1`);
    if (analyticsScripts !== 1) failures.push(`${app.id}: found ${analyticsScripts} shared GA4 loaders, expected 1`);
    const analyticsCalls = await page.evaluate(() => (window.dataLayer ?? []).map((entry) => entry[0]));
    if (analyticsCalls.filter((name) => name === 'js').length !== 1
        || analyticsCalls.filter((name) => name === 'config').length !== 1
        || analyticsCalls.includes('event')) {
      failures.push(`${app.id}: analytics calls are out of contract: ${analyticsCalls.join(',')}`);
    }
    if (await visibleTopBars.count() < 1) failures.push(`${app.id}: no shared top bar is visible`);
    else {
      if (topBarRows.length !== 1) failures.push(`${app.id}: rendered top bars occupy multiple rows: ${topBarRows.join(', ')}`);
      const topBar = visibleTopBars.first();
      const identity = await topBar.locator('.nd-app-bar__identity').innerText();
      const actions = await topBar.locator('.nd-app-bar__navigation').innerText();
      const githubHref = await topBar.locator('a[title="View this app on GitHub"]').getAttribute('href');
      if (!identity.includes(app.title)) failures.push(`${app.id}: top bar is missing the app name`);
      if (!identity.includes(app.description)) failures.push(`${app.id}: top bar is missing the short explanation`);
      if (!/v\d+\.\d+/.test(identity)) failures.push(`${app.id}: top bar is missing a version`);
      if (actions.replace(/\s+/g, ' ').trim() !== 'About Cite Privacy More Apps GitHub') {
        failures.push(`${app.id}: top-bar actions are out of contract: ${actions.replace(/\s+/g, ' ').trim()}`);
      }
      if (githubHref !== `https://github.com/neurodesk/webapps/tree/main/apps/${app.id}`) {
        failures.push(`${app.id}: top-bar GitHub link is ${githubHref ?? 'missing'}`);
      }
    }
    if (themeState.appId !== app.id) failures.push(`${app.id}: document theme identity is ${themeState.appId ?? 'missing'}`);
    if (themeState.brandPrimary !== '#6aa329') failures.push(`${app.id}: Neurodesk brand tokens were not applied`);
    if (pageErrors.length) failures.push(`${app.id}: page errors: ${[...new Set(pageErrors)].join(' | ')}`);
    if (responseErrors.length) failures.push(`${app.id}: failed same-origin responses: ${[...new Set(responseErrors)].join(' | ')}`);
    if (subpathLeaks.length) failures.push(`${app.id}: assets escaped app subpath: ${[...new Set(subpathLeaks)].join(', ')}`);
    if (app.id === 'seedseg') {
      const consoleText = await page.locator('#consoleOutput').innerText();
      if (!consoleText.includes('ONNX Runtime ready')) failures.push(`seedseg: worker did not initialize: ${consoleText.trim()}`);
    }

    const moreApps = page.locator('[title="More Neurodesk web apps"]:visible').first();
    if (await moreApps.count() !== 1) {
      failures.push(`${app.id}: More Apps link is missing`);
    } else {
      returningHome = true;
      await Promise.all([
        page.waitForURL(`${origin}/`),
        moreApps.click(),
      ]);
      if (await page.title() !== 'Neurodesk Webapps') {
        failures.push(`${app.id}: More Apps did not render the composite start page`);
      }
    }

    console.log(`PASS /${app.path}/ — ${title}`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

if (failures.length) throw new Error(`Composite-site smoke failures:\n- ${failures.join('\n- ')}`);
console.log(`Composite-site smoke passed for all ${registry.apps.length} webapps.`);
