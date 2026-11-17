// Draws the craft artwork in web/assets/: the japi (Assam's bamboo hat, seen face-on as it hangs on
// a wall) and the ten service icons as bold stamped shapes. Usage: node tests/make-craft.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../web/assets/', import.meta.url);
mkdirSync(new URL('tools/', OUT), { recursive: true });
const RED = '#b3172e', GOLD = '#c87326', CREAM = '#f3ecdf';
const f = (n) => +n.toFixed(2);

// ---------- japi: a plain straw disc, a few woven rings, one red band with gold teeth ----------
{
  const C = 100, parts = [];
  const ring = (r, w, color) => parts.push(`<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}"/>`);
  parts.push(`<circle cx="${C}" cy="${C}" r="96" fill="#dcb57a"/>`);
  for (const r of [90, 46, 36, 26]) ring(r, 1.6, '#c4985a');
  ring(68, 30, RED);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2, w = Math.PI / 20 * 0.62;
    const p = (ang, r) => `${f(C + Math.cos(ang) * r)} ${f(C + Math.sin(ang) * r)}`;
    parts.push(`<path d="M${p(a - w, 83)}L${p(a, 69)}L${p(a + w, 83)}Z" fill="${GOLD}"/>`);
  }
  ring(96, 4, '#9c6a33');
  parts.push(`<circle cx="${C}" cy="${C}" r="12" fill="${RED}"/>`);
  writeFileSync(new URL('japi.svg', OUT), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">${parts.join('')}</svg>\n`);
}

// ---------- service icons ----------
// Bold one-colour shapes; details are cut out of them (the mask), like a carved stamp.
// A faint wobble on the edges keeps them from looking machine-drawn. No speckle.
const wobble = `<filter id="w" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".5" numOctaves="1" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1" xChannelSelector="R" yChannelSelector="G"/></filter>`;
function icon(name, shapes, cuts = '') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><defs>${wobble}<mask id="m"><rect width="64" height="64" fill="#fff"/><g fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${cuts}</g></mask></defs><g filter="url(#w)"><g mask="url(#m)" fill="${RED}">${shapes}</g></g></svg>\n`;
  writeFileSync(new URL(`tools/${name}.svg`, OUT), svg);
}

// Cleaning: a phool jhadu, the grass broom, tied at the top.
icon('clean', `<rect x="27" y="4" width="10" height="20" rx="4"/><rect x="23" y="22" width="18" height="7" rx="3"/><path d="M24 29h16l13 25c1 3-1 5-4 5H15c-3 0-5-2-4-5z"/>`,
  `<path d="M28 35l-6 18M32 35v19M36 35l6 18"/>`);
// Cooking: a handi with its lid, steam rising.
icon('cook', `<rect x="8" y="27" width="48" height="7" rx="3.5"/><path d="M12 34h40c0 13-8 23-20 23S12 47 12 34z"/><path d="M17 27c1-6 7-10 15-10s14 4 15 10z"/><rect x="28" y="12" width="8" height="7" rx="3"/><path d="M22 3c-3 3 3 5 0 8M42 3c-3 3 3 5 0 8" fill="none" stroke="${RED}" stroke-width="3" stroke-linecap="round"/>`,
  `<path d="M19 41c2 6 6 9 11 10"/>`);
// Gardening: a seedling in a clay pot.
icon('garden', `<rect x="30" y="17" width="4" height="21" rx="2"/><path d="M32 29C30 19 23 14 12 14c0 10 8 16 20 15z"/><path d="M32 24c2-9 9-14 20-14 0 10-8 15-20 14z"/><rect x="11" y="35" width="42" height="8" rx="3"/><path d="M15 43h34l-4 15c-.5 2-2 3-4 3H23c-2 0-3.5-1-4-3z"/>`,
  `<path d="M18 18c4 3 8 6 12 9M47 14c-4 2-8 5-12 8"/>`);
// Painting: a wide paintbrush.
icon('paint', `<rect x="27" y="3" width="10" height="24" rx="5"/><rect x="21" y="25" width="22" height="10" rx="3"/><path d="M20 35h24v12c0 7-5 12-12 13-7-1-12-6-12-13z"/>`,
  `<path d="M22 30h20M27 40v9M32 40v13M37 40v9"/>`);
// Helper: a tied sack, the load carried for a move or a shop.
icon('helper', `<path d="M21 5h22l-4 10H25z"/><rect x="22" y="14" width="20" height="7" rx="3"/><path d="M25 21h14c10 7 16 15 16 24 0 9-9 15-23 15S9 54 9 45c0-9 6-17 16-24z"/>`,
  `<path d="M24 17.5h16"/>`);
// Plumbing: a tap with a drop falling.
icon('plumb', `<rect x="3" y="18" width="10" height="20" rx="3"/><path d="M13 22h27c9 0 15 6 15 15v5H44v-5c0-2-2-4-4-4H13z"/><rect x="26" y="11" width="7" height="12"/><rect x="16" y="5" width="27" height="8" rx="4"/><path d="M49.5 47c3 4 4.5 6.5 4.5 8.5a4.5 4.5 0 0 1-9 0c0-2 1.5-4.5 4.5-8.5z"/>`,
  `<path d="M17 27.5h20"/>`);
// Electrical: a bulb.
icon('elec', `<path d="M32 3c11 0 19 8 19 19 0 7-4 11-7 15-2 2.5-3 5-3 8H23c0-3-1-5.5-3-8-3-4-7-8-7-15C13 11 21 3 32 3z"/><rect x="22" y="47" width="20" height="5" rx="2.5"/><rect x="24" y="54" width="16" height="5" rx="2.5"/>`,
  `<path d="M27 37l5-9 5 9M21 19c1-4 4-7 8-8"/>`);
// Caretaker: an open hand, seen from the side, holding up a heart.
icon('care', `<path d="M34 8c-3-6-14-6-14 3 0 8 8 12 14 17 6-5 14-9 14-17 0-9-11-9-14-3z"/><path d="M4 40h8l14 0c3 0 5 2 5 4.5S29 49 26 49H18h17l14-9c2.5-1.5 5.5-.5 6 2 .3 1.5-.3 3-1.5 4L39 57c-1.5 1-3 1.5-5 1.5H12l-8-3z"/>`,
  `<path d="M24 14c0-3 2-5 5-5"/><path d="M12 40v17"/>`);
// Healthcare: a first-aid box.
icon('health', `<path d="M23 16v-5c0-2 2-4 4-4h10c2 0 4 2 4 4v5" fill="none" stroke="${RED}" stroke-width="5"/><rect x="5" y="16" width="54" height="42" rx="7"/>`,
  `<path d="M32 27v20M22 37h20" stroke-width="7"/>`);
// Anything else: a toolbox.
icon('other', `<path d="M23 16v-5c0-2 2-4 4-4h10c2 0 4 2 4 4v5" fill="none" stroke="${RED}" stroke-width="5"/><rect x="5" y="16" width="54" height="42" rx="5"/>`,
  `<path d="M5 31h54"/><rect x="27" y="27" width="10" height="8" rx="2" stroke-width="3"/>`);

console.log('web/assets/japi.svg, web/assets/tools/*.svg');
