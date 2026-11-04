#!/usr/bin/env node
// Serve dist-site/ locally (after `npm run build:site`): http://localhost:4180/
// A minimal static server with the MIME types the apps need (application/wasm for the orbital
// core, so WebAssembly.instantiateStreaming works). Usage: node scripts/preview-site.mjs [port]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist-site');
const port = Number(process.argv[2] ?? process.env.PORT ?? 4180);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.gz': 'application/gzip', '.pdf': 'application/pdf',
};

if (!existsSync(root)) {
  console.error('dist-site/ not found. Build it first: npm run build:site');
  process.exit(1);
}

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let path = normalize(join(root, url));
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  if (existsSync(path) && statSync(path).isDirectory()) {
    if (!url.endsWith('/')) { res.writeHead(301, { Location: `${url}/` }).end(); return; }
    path = join(path, 'index.html');
  }
  if (!existsSync(path)) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
}).listen(port, () => console.log(`EduPhysics site: http://localhost:${port}/`));
