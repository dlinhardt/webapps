import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import test from 'node:test';
import { repoRoot } from '../scripts/lib/apps-registry.mjs';

const MONOREPO = 'https://github.com/neurodesk/webapps';

// Historical repositories from which the browser apps were imported. These
// are provenance, not the current home of the app source. User-facing source,
// issue, and release links must point at this monorepo instead.
const LEGACY_APP_REPOSITORIES = new Map(Object.entries({
  'neurodesk/musclemap-webapp': 'musclemap',
  'neurodesk/vesselboost-webapp': 'vesselboost',
  'neurodesk/spinalcordtoolbox-webapp': 'spinalcordtoolbox',
  'neurodesk/lesion-network-mapping-webapp': 'calmar',
  'neurodesk/calmar-webapp': 'calmar',
  'astewartau/qsmbly': 'qsmbly',
  'astewartau/prostate': 'seedseg',
  'astewartau/seedseg': 'seedseg',
  'astewartau/dicompare-web': 'dicompare',
  'niivue/deface': 'deface',
  'thomshaw92/easy-mp2rage-t1-map': 'easy-mp2rage',
  'niivue/niivue-niimath': 'niimath',
  'thomshaw92/dicom2vid': 'dicom2vid',
  'neurolabusc/browserqc': 'browserqc',
}));

const SOURCE_EXTENSIONS = new Set(['.cff', '.css', '.html', '.js', '.md', '.toml', '.ts', '.tsx']);
const SKIP_DIRECTORIES = new Set([
  '.git', '.turbo', 'dist', 'legacy-ci', 'node_modules', 'niivue', 'test',
  'test-results', 'tests', 'vendor',
]);

async function browserSourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await browserSourceFiles(path));
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

test('app-facing GitHub links use the monorepo as the current source home', async () => {
  const stale = [];
  const repositoryUrls = [
    /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/gi,
    /https:\/\/api\.github\.com\/repos\/([\w.-]+)\/([\w.-]+)/gi,
  ];

  for (const path of await browserSourceFiles(join(repoRoot, 'apps'))) {
    const source = await readFile(path, 'utf8');
    for (const repositoryUrl of repositoryUrls) {
      for (const match of source.matchAll(repositoryUrl)) {
        const repository = `${match[1]}/${match[2]}`.toLowerCase();
        const app = LEGACY_APP_REPOSITORIES.get(repository);
        if (!app) continue;
        stale.push({
          file: relative(repoRoot, path),
          url: match[0],
          replacement: `${MONOREPO}/tree/main/apps/${app}`,
        });
      }
    }
  }

  assert.deepEqual(stale, [], `Legacy app repositories remain:\n${stale
    .map(({ file, url, replacement }) => `- ${file}: ${url} -> ${replacement}`)
    .join('\n')}`);
});
