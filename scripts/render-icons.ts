/**
 * Renders src/icons/icon.svg into the PNG sizes the manifest needs.
 * Run once after changing the SVG: `npm run icons` (requires Playwright).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(ROOT, 'src/icons/icon.svg'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: join(ROOT, `src/icons/icon-${size}.png`), omitBackground: true });
}
await browser.close();
console.log('Icons rendered.');
