/**
 * Test server for the end-to-end suite. Chromium is started with
 * `--host-resolver-rules=MAP * 127.0.0.1`, so every hostname — including real
 * ad domains like pagead2.googlesyndication.com — resolves to this server, and
 * the real compiled filter lists can be exercised without internet access.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export interface TestServer {
  port: number;
  url(host: string, path: string): string;
  close(): Promise<void>;
}

function handle(req: IncomingMessage, res: ServerResponse, port: number): void {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const host = url.hostname;

  if (url.pathname === '/headers') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(req.headers));
    return;
  }
  if (url.pathname === '/media/photo.gif') {
    // A tracker: sets a unique identifier cookie on every response.
    res.writeHead(200, {
      'content-type': 'image/gif',
      'set-cookie': `uid=${randomBytes(16).toString('hex')}; Path=/; SameSite=None`,
      'cache-control': 'no-store',
    });
    res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
    return;
  }
  if (url.pathname.endsWith('.js')) {
    // Every script just records that it ran: window.__ran['host/path'] = true
    const key = `${host}${url.pathname}`;
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    res.end(`(window.__ran = window.__ran || {})[${JSON.stringify(key)}] = true;`);
    return;
  }
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!/^[\w.-]+\.html$/.test(file)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const html = readFileSync(join(FIXTURES, file), 'utf8').replaceAll('{{PORT}}', String(port));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  } catch {
    res.writeHead(404).end();
  }
}

export async function startServer(): Promise<TestServer> {
  let port = 0;
  const server: Server = createServer((req, res) => handle(req, res, port));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    url: (host, path) => `http://${host}:${port}${path}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
