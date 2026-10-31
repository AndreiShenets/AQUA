import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadArtifact } from '@electron/get';
import extract from '@electron-internal/extract-zip';

const root = fileURLToPath(new URL('../..', import.meta.url));
const { devDependencies } = JSON.parse(
  await fs.readFile(path.join(root, 'package.json'), 'utf8')
);
const version = devDependencies.electron;
assert.match(
  version,
  /^\d+\.\d+\.\d+$/,
  'Pin Electron to an exact version so its driver stays in sync'
);
const directory = path.join(
  root,
  '.erb/chromedriver',
  `${process.platform}-${process.arch}`
);
// @electron/get verifies the archive against Electron's published checksums.
const archive = await downloadArtifact({
  version,
  artifactName: 'chromedriver',
});
await fs.mkdir(directory, { recursive: true });
await extract(archive, { dir: directory });
const binary = path.join(
  directory,
  process.platform === 'win32' ? 'chromedriver.exe' : 'chromedriver'
);
await fs.access(binary);
if (process.platform !== 'win32') {
  await fs.chmod(binary, 0o755);
}
console.log(`Installed ChromeDriver matching Electron ${version}`);
