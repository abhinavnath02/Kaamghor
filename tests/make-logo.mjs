// Logo concepts in web/assets/logo/: the Kaamghor K mark brought into the gamosa.
// The K is traced onto a thread grid and woven as floats of red yarn with real shading.
//   A  woven K on cotton          B  cream K woven into a red panel          C  the solid K on a folded gamosa end
// Usage: node tests/make-logo.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = new URL('../web/assets/logo/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const RED = '#b3172e', RED_D = '#8f1024', GOLD = '#c87326', CREAM = '#f8f2e6', INK = '#2b1a12';

// The K mark (from web/logo.svg): two straight-edged loops in an 849 x 599 box.
const D = 'M340 0 135 279 105 325 101 324 101 18 0 18 0 598 101 598 101 452 215 301 219 302 222 309 340 597 454 598 292 210 294 204 379 87 553 123 741 596 849 596 633 59Z M395 119 333 202 329 212 487 595 711 596 525 150Z';
const loops = D.split('M').slice(1).map((p) => { const n = p.replace('Z', '').trim().split(/\s+/).map(Number); const pts = []; for (let i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]]); return pts; });
const inside = (x, y) => {
  let c = false;
  for (const l of loops) for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
    const [xi, yi] = l[i], [xj, yj] = l[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

// Trace onto the grid: a cell is thread if most of it falls inside the mark.
const COLS = 26, CELL = 849 / COLS, ROWS = Math.round(599 / CELL);
const on = [];
for (let r = 0; r < ROWS; r++) {
  on.push([]);
  for (let c = 0; c < COLS; c++) {
    let hits = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) if (inside((c + (sx + .5) / 3) * CELL, (r + (sy + .5) / 3) * CELL)) hits++;
    on[r].push(hits >= 5);
  }
}

// Woven: each run of thread in a row is a float, laid as a doubled strand with twist, sheen and shadow.
const U = 10; // one thread cell, in SVG units
function weave(color, dark, id) {
  let shadow = '', body = '';
  on.forEach((row, r) => {
    let c = 0;
    while (c < COLS) {
      if (!row[c]) { c++; continue; }
      const s = c; while (c < COLS && row[c]) c++;
      const x0 = s * U + .3, x1 = c * U - .3, y = r * U;
      for (const [y0, y1] of [[y + .5, y + 4.7], [y + 5.3, y + 9.5]]) {
        const h = y1 - y0;
        shadow += `<rect x="${x0 + .4}" y="${y0 + .7}" width="${x1 - x0}" height="${h}" rx="${h / 2}"/>`;
        body += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${h}" rx="${h / 2}"/>`;
      }
    }
  });
  return `<defs>
<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>
<pattern id="${id}t" width="2.2" height="4.2" patternUnits="userSpaceOnUse" patternTransform="skewX(-35)"><rect width=".55" height="4.2" fill="#000" fill-opacity=".22"/></pattern>
<clipPath id="${id}c">${body}</clipPath></defs>
<g fill="#000" fill-opacity=".22">${shadow}</g>
<g clip-path="url(#${id}c)"><rect width="${COLS * U}" height="${ROWS * U}" fill="${color}"/><rect width="${COLS * U}" height="${ROWS * U}" fill="url(#${id}t)"/><rect width="${COLS * U}" height="${ROWS * U}" fill="url(#${id}g)"/></g>`;
}

const cloth = readFileSync(new URL('../web/assets/gamosa-cloth.svg', import.meta.url), 'utf8');
const clothData = 'data:image/svg+xml;base64,' + Buffer.from(cloth).toString('base64');
const border = readFileSync(new URL('../web/assets/gamosa-border.svg', import.meta.url), 'utf8');
const borderData = 'data:image/svg+xml;base64,' + Buffer.from(border).toString('base64');
const [, bw, bh] = border.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);   // one repeat of the border
const BH = 132;                                                                     // border height in the icon

const W = COLS * U, H = ROWS * U;
const save = (name, svg) => { writeFileSync(new URL(name, OUT), svg); console.log('web/assets/logo/' + name); };

// The woven K alone, transparent: for headers and print.
save('k-woven.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${W + 2} ${H + 2}">${weave(RED, RED_D, 'a')}</svg>\n`);
save('k-woven-cream.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${W + 2} ${H + 2}">${weave(CREAM, '#d9cdb8', 'b')}</svg>\n`);

// App-icon tiles (512 square). The K sits a little above centre, like a motif on cloth.
const S = 512, kw = 330, kh = kw * H / W, kx = (S - kw) / 2, ky = (S - kh) / 2 - 18;
const placeK = (inner) => `<svg x="${kx}" y="${ky}" width="${kw}" height="${kh}" viewBox="-1 -1 ${W + 2} ${H + 2}">${inner}</svg>`;

// A: woven K on cotton, with a thin trim of gold thread and the ladder below.
save('a-icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"><defs><clipPath id="r"><rect width="${S}" height="${S}" rx="112"/></clipPath></defs>
<g clip-path="url(#r)"><rect width="${S}" height="${S}" fill="${CREAM}"/><image href="${clothData}" width="${S}" height="${S}" preserveAspectRatio="none"/>
${placeK(weave(RED, RED_D, 'a'))}
<rect y="424" width="${S}" height="6" fill="${GOLD}"/><rect y="436" width="${S}" height="6" fill="${GOLD}"/>
${Array.from({ length: 32 }, (_, i) => `<rect x="${i * 16 + 4}" y="452" width="8" height="8" fill="${RED}"/>`).join('')}
<rect y="470" width="${S}" height="6" fill="${GOLD}"/></g></svg>\n`);

// B: a red gamosa panel with the K woven in cream thread.
save('b-icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"><defs><clipPath id="r"><rect width="${S}" height="${S}" rx="112"/></clipPath></defs>
<g clip-path="url(#r)"><rect width="${S}" height="${S}" fill="${RED}"/>
<rect y="34" width="${S}" height="5" fill="${GOLD}"/><rect y="473" width="${S}" height="5" fill="${GOLD}"/>
${placeK(weave(CREAM, '#d9cdb8', 'b'))}</g></svg>\n`);

// C (chosen): the solid K mark on cream cotton, with a folded gamosa end (its red border) along the bottom.
// Kaamghor's K is red; Kaamghor Partner's is gold. Rounded tiles for favicons; square, full-bleed ones
// for the PNG app icons (phones apply their own mask).
function cIcon(kColor, rounded) {
  const clip = rounded ? `<defs><clipPath id="r"><rect width="${S}" height="${S}" rx="112"/></clipPath></defs>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">${clip}
<g${rounded ? ' clip-path="url(#r)"' : ''}><rect width="${S}" height="${S}" fill="${CREAM}"/><image href="${clothData}" width="${S}" height="${S}" preserveAspectRatio="none"/>
<svg x="${kx + 10}" y="${ky - 22}" width="${kw - 20}" height="${(kw - 20) * 599 / 849}" viewBox="0 0 849 599"><path fill="${kColor}" fill-rule="evenodd" d="${D}"/></svg>
<rect y="380" width="${S}" height="${BH}" fill="url(#band)"/></g>
<defs><pattern id="band" width="${BH * bw / bh}" height="${BH}" patternUnits="userSpaceOnUse" y="380" x="${(S / 2) % (BH * bw / bh)}"><image href="${borderData}" width="${BH * bw / bh}" height="${BH}"/></pattern></defs></svg>\n`;
}
save('c-icon.svg', cIcon(RED, true));
save('c-icon-partner.svg', cIcon(GOLD, true));
save('c-square.svg', cIcon(RED, false));
save('c-square-partner.svg', cIcon(GOLD, false));
// The chosen logo is the apps' icon: favicons for both apps. PNGs: node tests/render-icons.mjs
writeFileSync(new URL('../web/icon.svg', import.meta.url), cIcon(RED, true));
writeFileSync(new URL('../web/partner/icon.svg', import.meta.url), cIcon(GOLD, true));
console.log('web/icon.svg, web/partner/icon.svg');
