/**
 * Zips dist/<browser> into artifacts/shomer-<browser>-<version>.zip, ready for
 * the Chrome Web Store and addons.mozilla.org.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { buildDate } from './build-date';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };

function collect(dir: string, base: string, out: Record<string, Uint8Array>): void {
  for (const name of readdirSync(dir).sort()) {
    // Chrome writes an index cache into unpacked extensions it has loaded.
    if (name === '_metadata') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collect(path, base, out);
    else out[relative(base, path).split('\\').join('/')] = readFileSync(path);
  }
}

mkdirSync(join(ROOT, 'artifacts'), { recursive: true });
for (const browser of ['chrome', 'firefox']) {
  const dir = join(ROOT, 'dist', browser);
  const files: Record<string, Uint8Array> = {};
  collect(dir, dir, files);
  const zip = zipSync(files, { level: 9, mtime: buildDate() });
  const target = join(ROOT, 'artifacts', `shomer-${browser}-${version}.zip`);
  writeFileSync(target, zip);
  console.log(`${relative(ROOT, target)}  ${(zip.length / 1024 / 1024).toFixed(2)} MiB`);
}
