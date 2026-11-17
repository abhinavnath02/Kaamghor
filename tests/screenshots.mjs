// Takes the app screenshots used on the landing page (web/get/shots/*.webp), in light and dark.
// Runs the local harness with demo data and drives Chrome (or Edge) headless over the DevTools protocol.
// Usage: node tests/screenshots.mjs        (set CHROME=path\to\chrome.exe if it isn't found)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'web', 'get', 'shots');
const PORT = 5179, DEBUG = 9339, W = 390, H = 844;
const BROWSERS = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) throw new Error('No Chrome found: set CHROME to its path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(root, 'tests', 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'kg-shots-'));
const browser = spawn(browserPath, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });

let ws, seq = 0;
const waiting = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function until(expression, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await evaluate(expression)) return; } catch (_) { /* page still loading */ }
    await sleep(200);
  }
  throw new Error('Timed out waiting for: ' + expression);
}
// Opens a page signed in and fully drawn (tabs showing, no loading placeholders). Retries once if
// the app came up signed out (the harness may still be writing the session when the page loads).
async function open(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // A change after # alone wouldn't reload the app, so always start from a blank page.
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(200);
    await send('Page.navigate', { url: `http://localhost:${PORT}${path}` });
    await sleep(600);
    try {
      await until(`!!(typeof S !== 'undefined' && S.profile && !document.querySelector('#tabs').hidden && !document.querySelector('main .skel'))`, 15000);
      await sleep(600);
      return;
    } catch (e) {
      const seen = await evaluate(`JSON.stringify({ session: localStorage.getItem('mock-session') && JSON.parse(localStorage.getItem('mock-session')).user.phone,
        main: document.querySelector('main').innerText.slice(0, 160), toast: document.querySelector('#toast').innerText })`).catch(() => '?');
      console.warn(`  ${path} not ready (try ${attempt + 1}): ${seen}`);
      if (attempt === 2) throw e;
    }
  }
}

// Demo data: a household, four workers, jobs in every state the screenshots show.
const SEED = `(async () => {
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const as = async (phone) => { await api.signOut(); return (await api.verifyPhoneCode(phone, '123456')).user; };
  const h = await as('+919876500001');
  await api.createProfile({ id: h.id, role: 'household', full_name: 'Priya Gogoi', area: 'town' });
  const job = async (service, area, d, days, need, rate, notes, ll) => {
    const r = await api.postJob({ household_id: h.id, service, area, job_date: day(d), days, workers_needed: need, rate, notes });
    if (ll) await api.setJobLocation(r.id, ll[0], ll[1], null);
    return r.id;
  };
  const clean = await job('clean', 'town', 1, 1, 1, 500, 'Two rooms and the kitchen. Please bring a mop.', [27.4935, 95.3527]);
  const paint = await job('paint', 'town', 2, 2, 2, 650, 'Outside wall of a single-storey house.', [27.4898, 95.3601]);
  await job('cook', 'hijuguri', 1, 0.5, 1, 450, 'Lunch for a family of five.', [27.5011, 95.3402]);
  await job('garden', 'borguri', 3, 1, 1, 450, null, [27.4848, 95.3335]);
  await job('care', 'town', 1, 3, 1, 600, 'Daytime care for my father after surgery.', [27.4967, 95.3489]);
  const people = [['+919876500011', 'Ramesh Das', ['clean', 'paint', 'helper'], 4.8, 23], ['+919876500012', 'Bina Saikia', ['clean', 'cook', 'care'], 4.9, 41],
    ['+919876500013', 'Pranjal Bora', ['paint', 'helper'], 4.6, 12], ['+919876500014', 'Anil Kurmi', ['clean', 'paint', 'cook', 'garden', 'care', 'helper'], 4.7, 18]];
  const ids = {};
  for (const [phone, name, skills, avg, n] of people) {
    const u = await as(phone);
    ids[name] = u.id;
    await api.createProfile({ id: u.id, role: 'worker', full_name: name, area: 'town' });
    await api.createWorker({ user_id: u.id, skills, upi_id: name.split(' ')[0].toLowerCase() + '@okaxis' });
    await __sql("update public.worker_profiles set verified = true, jobs_done = $2 where user_id = $1", [u.id, n]);
    await __sql("update public.profiles set rating_avg = $2, rating_count = $3 where id = $1", [u.id, avg, n]);
  }
  for (const name of ['Ramesh Das', 'Bina Saikia']) { await as(people.find((p) => p[1] === name)[0]); await api.apply(clean, ids[name]); }
  for (const name of ['Ramesh Das', 'Pranjal Bora', 'Anil Kurmi']) { await as(people.find((p) => p[1] === name)[0]); await api.apply(paint, ids[name]); }
  await as('+919876500001'); await api.hire(clean, ids['Ramesh Das']);
  await as('+919876500011'); await api.markArrived(clean);
  const [a] = await __sql("select id from public.assignments where job_id = $1", [clean]);
  await as('+919876500001'); await api.confirmArrival(a.id);
  localStorage.setItem('onlyMyArea', '0');
  return { clean, paint };
})()`;

const SHOTS = [
  // name, phone to sign in with, page, script to run first, how far down the page (a heading to start at)
  ['home-post', '+919876500001', '/#post'],
  ['home-hire', '+919876500001', '/#job/PAINT', null, 'Applied'],
  ['home-track', '+919876500001', '/#job/CLEAN'],
  ['work-find', '+919876500014', '/partner/#find'],
  ['work-map', '+919876500014', '/partner/#find', `S.findView = 'map'; refresh();`],
  ['work-job', '+919876500011', '/partner/#wjob/CLEAN'],
];
// Scroll so the heading that starts with this text sits just under the app header.
const scrollTo = (heading) => heading
  ? `(() => { const h = [...document.querySelectorAll('main h2')].find((e) => e.textContent.startsWith(${JSON.stringify(heading)}));
      scrollTo(0, h ? h.getBoundingClientRect().top + scrollY - 140 : 0); return true; })()`
  : 'scrollTo(0, 0), true';

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()).find((t) => t.type === 'page'); } catch (_) { await sleep(200); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const w = msg.id && waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if (msg.error) w.reject(new Error(msg.error.message)); else w.resolve(msg.result);
  };
  await new Promise((r) => { ws.onopen = r; });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });

  await send('Page.navigate', { url: `http://localhost:${PORT}/` });
  await until("typeof api !== 'undefined' && !!window.__sql", 60000);
  await sleep(1500);
  const ids = await evaluate(SEED);
  await sleep(2000); // let the harness finish saving the demo data
  if (process.env.DEBUG_SHOTS) console.log(await evaluate(`(async () => { await api.signOut(); const u = (await api.verifyPhoneCode('+919876500011', '123456')).user;
    return JSON.stringify({ work: (await api.myWork(u.id)).map((a) => [a.status, !!a.jobs]) }); })()`));
  mkdirSync(out, { recursive: true });

  for (const scheme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    for (const [name, phone, page, extra, heading] of SHOTS) {
      await evaluate(`(async () => { await api.signOut(); await api.verifyPhoneCode('${phone}', '123456'); })()`);
      await open(page.replace('PAINT', ids.paint).replace('CLEAN', ids.clean));
      if (extra) { await evaluate(extra); await sleep(300); }
      await sleep(name === 'work-map' ? 4000 : 1200);
      await evaluate(`document.querySelectorAll('#toast > *').forEach((e) => e.remove()); true`);
      await evaluate(scrollTo(heading));
      await sleep(400);
      const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 82 });
      const file = join(out, `${name}-${scheme}.webp`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      console.log('web/get/shots/' + `${name}-${scheme}.webp`);
    }
  }
} finally {
  try { ws && ws.close(); } catch (_) { /* closed */ }
  browser.kill(); server.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch (_) { /* Chrome may still hold files */ }
}
