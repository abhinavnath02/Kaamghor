// Renders the PNG app icons from the logo SVGs with headless Chrome (or Edge), over the DevTools protocol:
//   web/icon-192.png, web/icon-512.png            from web/assets/logo/c-square.svg
//   web/partner/icon-192.png, icon-512.png        from web/assets/logo/c-square-partner.svg
// Run node tests/make-logo.mjs first. Usage: node tests/render-icons.mjs (set CHROME=... if not found)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const browserPath = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => existsSync(p));
if (!browserPath) throw new Error('No Chrome found: set CHROME to its path');

const DEBUG = 9341;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'kg-icons-'));
const browser = spawn(browserPath, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

let ws, seq = 0;
const waiting = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()).find((t) => t.type === 'page'); } catch (_) { await sleep(200); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); const w = msg.id && waiting.get(msg.id); if (!w) return; waiting.delete(msg.id); msg.error ? w.reject(new Error(msg.error.message)) : w.resolve(msg.result); };
  await new Promise((r) => { ws.onopen = r; });
  await send('Page.enable');

  for (const [svg, dir] of [['c-square.svg', ''], ['c-square-partner.svg', 'partner/']]) {
    const data = 'data:image/svg+xml;base64,' + readFileSync(join(root, 'web', 'assets', 'logo', svg)).toString('base64');
    for (const size of [192, 512]) {
      await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
      const html = `<!doctype html><body style="margin:0"><img src="${data}" style="display:block;width:${size}px;height:${size}px">`;
      await send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
      await sleep(700);
      const { data: png } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
      writeFileSync(join(root, 'web', dir, `icon-${size}.png`), Buffer.from(png, 'base64'));
      console.log(`web/${dir}icon-${size}.png`);
    }
  }
} finally {
  try { ws && ws.close(); } catch (_) { /* closed */ }
  browser.kill();
  await sleep(400);
  try { rmSync(profile, { recursive: true, force: true }); } catch (_) { /* Chrome may still hold files */ }
}
