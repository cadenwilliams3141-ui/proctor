// Tiny static server for looking at dist/ locally:  node page/serve.mjs  ->  http://localhost:4317/preview.html
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary' };
createServer(async (req, res) => {
  const path = basename(decodeURIComponent(new URL(req.url, 'http://x').pathname)) || 'preview.html';
  try {
    const body = await readFile(join(dist, path));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(4317, '127.0.0.1', () => console.log('http://localhost:4317/preview.html'));
