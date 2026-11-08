// A static server for the browser tests: serves one built folder on 127.0.0.1 with the hub's headers (the CSP of
// tools/csp.mjs, nosniff, no referrer, no store). Loopback only; a path outside the folder is a 404.
//
//   node tools/serve.mjs <folder> <port>

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { POLICY } from './csp.mjs';

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

const root = resolve(process.argv[2] ?? 'dist-fake');
const port = Number(process.argv[3] ?? '4317');
if (!Number.isInteger(port) || port <= 0) throw new Error(`bad port: ${process.argv[3]}`);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  const headers = {
    'Content-Security-Policy': POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  if (request.method !== 'GET' || (file !== root && !file.startsWith(root + sep))) {
    response.writeHead(404, headers).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    response.writeHead(404, headers).end();
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}/`);
});
