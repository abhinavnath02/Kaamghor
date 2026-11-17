// Draws the gamosa artwork in web/assets/ as SVG: the woven red border of an Assamese gamosa.
// Everything sits on a weaving grid (1 unit = 1 thread block), so edges step like real weaving
// instead of curving. Usage: node tests/make-gamosa.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../web/assets/', import.meta.url);
mkdirSync(OUT, { recursive: true });

export const RED = '#b3172e', GOLD = '#c87326', CREAM = '#f3ecdf';
const T = 24; // motif repeat, in threads

// ---------- the motif ----------
// Like the cloth: mostly red. An eight-pointed star (a square and a diamond laid over each other),
// its points split by cream lines and outlined in cream; where four repeats meet, a cream diamond
// ring around a red dot. true = red thread, false = cream.
function motif(x, y) {
  const c = (T - 1) / 2, dx = Math.abs(x - c), dy = Math.abs(y - c);
  const ex = Math.min(x + 0.5, T - x - 0.5), ey = Math.min(y + 0.5, T - y - 0.5);
  const corner = ex + ey;                             // steps from the nearest corner
  if (corner <= 2) return true;                       // red dot
  if (corner <= 4) return false;                      // cream diamond ring
  const m = dx + dy, sq = Math.max(dx, dy);
  const star = (r) => sq <= r || m <= r * 1.42;
  if (star(5.5)) {
    if (sq <= 0.5) return true;                       // red centre
    if (m <= 3) return false;                         // cream eye
    if (Math.abs(dx - dy) <= 0.5) return false;       // cream lines between the points
    if (dx <= 0.5 || dy <= 0.5) return false;
    return true;
  }
  if (star(6.6)) return false;                        // cream outline round the star
  return true;                                        // red ground
}

// Turns a grid of filled cells into one compact path (one rect run per row).
function cells(w, h, on, ox = 0, oy = 0) {
  let d = '';
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!on(x, y)) { x++; continue; }
      const s = x;
      while (x < w && on(x, y)) x++;
      d += `M${s + ox} ${y + oy}h${x - s}v1h${s - x}z`;
    }
  }
  return d;
}

// ---------- the border bands either side of the panel ----------
// Each band is a list of rows; a row is drawn across `w` threads.
const line = (color) => ({ h: 1, draw: (w, y) => `<rect y="${y}" width="${w}" height="1" fill="${color}"/>` });
const gap = (h) => ({ h, draw: () => '' });
// A ladder: small red squares between two gold threads.
const ladder = { h: 5, draw: (w, y) => `<rect y="${y}" width="${w}" height="1" fill="${GOLD}"/><path fill="${RED}" d="${cells(w, 1, (x) => x % 4 < 2, 0, y + 2)}"/><rect y="${y + 4}" width="${w}" height="1" fill="${GOLD}"/>` };
// Teeth: stepped red triangles pointing into the panel.
const teeth = (down) => ({ h: 4, draw: (w, y) => `<path fill="${RED}" d="${cells(w, 4, (x, r) => { const k = x % 8, row = down ? r : 3 - r; return Math.abs(k - 3.5) <= row + 0.5; }, 0, y)}"/>` });
const panel = (rows) => ({ h: rows * T, draw: (w, y) => `<rect y="${y}" width="${w}" height="${rows * T}" fill="${CREAM}"/><path fill="${RED}" d="${cells(w, rows * T, (x, r) => motif(x % T, r % T), 0, y)}"/>` });

function stack(w, parts) {
  let y = 0, body = '';
  for (const p of parts) { body += p.draw(w, y); y += p.h; }
  return { h: y, body };
}

function svg(w, h, body, extra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 4}" height="${h * 4}" shape-rendering="crispEdges"${extra}>${body}</svg>\n`;
}

// 1. The full border, one motif wide: repeat it sideways (CSS background repeat-x).
const outer = [gap(2), line(GOLD), gap(1), line(GOLD), gap(2), ladder, gap(2), line(GOLD), gap(1)];
const full = stack(T * 2, [...outer, teeth(true), gap(1), panel(2), gap(1), teeth(false), ...[...outer].reverse()]);
writeFileSync(new URL('gamosa-border.svg', OUT), svg(T * 2, full.h, `<rect width="${T * 2}" height="${full.h}" fill="${CREAM}"/>${full.body}`));

// 2. A thin trim: gold threads and the ladder only, for dividers and edges of small things.
const trim = stack(8, [line(GOLD), gap(1), ladder, gap(1), line(GOLD)]);
writeFileSync(new URL('gamosa-trim.svg', OUT), svg(8, trim.h, `<rect width="8" height="${trim.h}" fill="${CREAM}"/>${trim.body}`));

// 3. The motif on its own, to fill any area (CSS background repeat).
writeFileSync(new URL('gamosa-motif.svg', OUT), svg(T, T, `<rect width="${T}" height="${T}" fill="${CREAM}"/><path fill="${RED}" d="${cells(T, T, motif)}"/>`));

// 4. A transparent motif in one colour (currentColor), for icons and watermarks.
writeFileSync(new URL('gamosa-flower.svg', OUT), svg(T, T, `<path fill="${RED}" d="${cells(T, T, (x, y) => {
  const c = (T - 1) / 2, dx = Math.abs(x - c), dy = Math.abs(y - c);
  return (Math.max(dx, dy) <= 5.5 || dx + dy <= 5.5 * 1.42) && motif(x, y); // just the star
})}"/>`));

// 5. The end of a gamosa as one illustration: cloth, border panel two motifs deep, fringe.
{
  const W = T * 6, panelRows = 2;
  const parts = [gap(30), ...outer, teeth(true), gap(1), panel(panelRows), gap(1), teeth(false), ...[...outer].reverse(), gap(10)];
  const s = stack(W, parts);
  let fringe = '';
  for (let x = 1; x < W; x += 3) {
    const len = 12 + ((x * 7) % 5);
    fringe += `<path d="M${x + 0.5} ${s.h}v${len}" stroke="#ddd0b9" stroke-width="1.2" stroke-linecap="round"/>`;
  }
  // A faint weave on the plain cloth.
  const weave = `<pattern id="w" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="${CREAM}"/><rect y="2" width="3" height=".4" fill="#7a4e22" opacity=".03"/><rect x="1" width=".4" height="3" fill="#7a4e22" opacity=".02"/></pattern>`;
  writeFileSync(new URL('gamosa-end.svg', OUT), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${s.h + 18}" width="${W * 4}" height="${(s.h + 18) * 4}">
<defs>${weave}</defs><rect width="${W}" height="${s.h}" fill="url(#w)"/><g shape-rendering="crispEdges">${s.body}</g>${fringe}</svg>\n`);
}

console.log('web/assets/gamosa-border.svg, gamosa-trim.svg, gamosa-motif.svg, gamosa-flower.svg, gamosa-end.svg');
