import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { injectCompositeTheme } from './composite-theme.mjs';

export async function applyAppTheme({
  app, version, measurementId, distDir, themeFile, shellFile, analyticsFile,
}) {
  const indexPath = join(distDir, 'index.html');
  const html = await readFile(indexPath, 'utf8');

  await writeFile(indexPath, injectCompositeTheme(html, {
    appId: app.id,
    title: app.title,
    description: app.description,
    version,
    measurementId,
    href: './app-theme.css',
    shellHref: './app-shell.js',
    analyticsHref: './analytics.js',
    moreAppsHref: '../',
  }));
  await cp(themeFile, join(distDir, 'app-theme.css'));
  await cp(shellFile, join(distDir, 'app-shell.js'));
  await cp(analyticsFile, join(distDir, 'analytics.js'));
}
