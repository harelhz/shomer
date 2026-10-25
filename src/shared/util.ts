/** Small utilities shared across the extension. */

/** Trailing-edge debounce. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Runs async tasks one at a time. Used for operations such as replacing the
 * dynamic rule set, where two overlapping calls could interleave badly.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

export function hostnameOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function isWebUrl(url: string | undefined): boolean {
  return typeof url === 'string' && /^https?:\/\//.test(url);
}

/** Match patterns covering a site and all its subdomains. */
export function sitePatterns(site: string): string[] {
  return [`*://${site}/*`, `*://*.${site}/*`];
}
