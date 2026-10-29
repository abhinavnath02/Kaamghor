// Serves the app with the local harness instead of real Supabase. Usage: node serve.mjs, then open http://localhost:5173
// Pass --real to serve web/ exactly as it will be deployed (no harness).
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const real = process.argv.includes('--real');
const PORT = Number(process.env.PORT || (real ? 5174 : 5173));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.sql': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.json': 'application/json' };
const CDN = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>';

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') path = '/index.html';
  // The harness asks which SQL files exist, so new migrations are applied automatically.
  if (!real && path === '/__mock/sql-list') {
    const names = (await readdir(join(root, 'sql'))).filter((n) => n.endsWith('.sql')).sort();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(names));
    return;
  }
  let file;
  if (!real && path.startsWith('/node_modules/')) file = join(root, 'tests', path);
  else if (!real && path.startsWith('/sql/')) file = join(root, path);
  else if (!real && path.startsWith('/__mock/')) file = join(root, 'tests', 'harness', path.slice(8));
  else file = join(root, 'web', path);
  if (!normalize(file).startsWith(normalize(root))) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(file);
    if (!real && path === '/index.html') body = body.toString().replace(CDN, '<script src="/__mock/mock-supabase.js"></script>');
    // The harness reloads code often, so it skips the caching service worker.
    if (!real && path === '/sw.js') body = 'self.addEventListener("install",()=>self.skipWaiting());';
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => console.log(`Kaamghor ${real ? '(real build)' : '(local harness)'} on http://localhost:${PORT}`));
