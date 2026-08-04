import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { injectCompositeTheme } from './composite-theme.mjs';

export async function applyAppTheme({ appId, distDir, themeFile }) {
  const indexPath = join(distDir, 'index.html');
  const html = await readFile(indexPath, 'utf8');

  await writeFile(indexPath, injectCompositeTheme(html, {
    appId,
    href: './app-theme.css',
  }));
  await cp(themeFile, join(distDir, 'app-theme.css'));
}
