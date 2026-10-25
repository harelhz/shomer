/**
 * The timestamp embedded in builds. It comes from `SOURCE_DATE_EPOCH` (the
 * reproducible-builds convention) or the `releaseDate` in package.json — never
 * from the clock — so building the same source twice gives identical files.
 * Store reviewers rely on this to verify the uploaded package.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function buildDate(): Date {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) return new Date(Number(epoch) * 1000);
  const { releaseDate } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { releaseDate?: string };
  return releaseDate ? new Date(releaseDate) : new Date(0);
}
