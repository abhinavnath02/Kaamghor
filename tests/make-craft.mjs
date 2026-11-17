// Draws the craft artwork in web/assets/: the japi (Assam's bamboo hat, seen face-on as it hangs on
// a wall) and the ten service icons as hand block prints. Usage: node tests/make-craft.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../web/assets/', import.meta.url);
mkdirSync(new URL('tools/', OUT), { recursive: true });
const RED = '#b3172e', GOLD = '#c87326', CREAM = '#f3ecdf';
const f = (n) => +n.toFixed(2);

// ---------- japi ----------
{
  const C = 100, parts = [];
  const ring = (r, w, color) => parts.push(`<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}"/>`);
  // Woven bamboo: fine rings in two straw tones.
  parts.push(`<circle cx="${C}" cy="${C}" r="97" fill="#d9b277"/>`);
  for (let r = 95; r > 8; r -= 2.2) ring(r, 1.1, r % 4.4 < 2.2 ? '#c99d5e' : '#e4c38c');
  // Spokes of the frame.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    parts.push(`<path d="M${f(C + Math.cos(a) * 12)} ${f(C + Math.sin(a) * 12)}L${f(C + Math.cos(a) * 95)} ${f(C + Math.sin(a) * 95)}" stroke="#b98a4f" stroke-width=".8" opacity=".55"/>`);
  }
  // The decorated band: red cloth with gold and green triangles, between black cane rings.
  ring(70, 26, RED);
  ring(83.5, 2.4, '#2b1a12'); ring(56.5, 2.4, '#2b1a12');
  const tri = (n, r1, r2, color, off = 0) => {
    for (let i = 0; i < n; i++) {
      const a = ((i + off) / n) * Math.PI * 2, w = Math.PI / n * 0.8;
      parts.push(`<path d="M${f(C + Math.cos(a - w) * r1)} ${f(C + Math.sin(a - w) * r1)}L${f(C + Math.cos(a) * r2)} ${f(C + Math.sin(a) * r2)}L${f(C + Math.cos(a + w) * r1)} ${f(C + Math.sin(a + w) * r1)}Z" fill="${color}"/>`);
    }
  };
  tri(28, 81.5, 72, GOLD); tri(28, 58.5, 68, '#1f6b3a', 0.5);
  for (let i = 0; i < 28; i++) {
    const a = ((i + 0.5) / 28) * Math.PI * 2;
    parts.push(`<circle cx="${f(C + Math.cos(a) * 77)}" cy="${f(C + Math.sin(a) * 77)}" r="1.6" fill="${CREAM}"/>`);
  }
  // Rim and the crown.
  ring(96, 3, '#7a4e22');
  parts.push(`<circle cx="${C}" cy="${C}" r="14" fill="${RED}"/><circle cx="${C}" cy="${C}" r="14" fill="none" stroke="#2b1a12" stroke-width="2.4"/>`);
  tri(12, 13, 6, GOLD);
  parts.push(`<circle cx="${C}" cy="${C}" r="4" fill="#2b1a12"/>`);
  writeFileSync(new URL('japi.svg', OUT), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">${parts.join('')}</svg>\n`);
}

// ---------- service icons as block prints ----------
// Solid shapes printed in one ink; details are carved out (the mask) like cuts in a wooden block.
// The filter roughens the edges and leaves the small gaps a hand print has.
const print = (seed) => `<filter id="p" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="${seed}" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" xChannelSelector="R" yChannelSelector="G" result="d"/>
<feTurbulence type="fractalNoise" baseFrequency=".2" numOctaves="2" seed="${seed + 9}" result="s"/>
<feColorMatrix in="s" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -24 16.2" result="k"/>
<feComposite in="d" in2="k" operator="in"/></filter>`;
function icon(name, seed, shapes, cuts = '') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><defs>${print(seed)}<mask id="m"><rect width="64" height="64" fill="#fff"/><g fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${cuts}</g></mask></defs><g filter="url(#p)"><g mask="url(#m)" fill="${RED}">${shapes}</g></g></svg>\n`;
  writeFileSync(new URL(`tools/${name}.svg`, OUT), svg);
}

// Cleaning: a phool jhadu, the grass broom, tied at the top.
icon('clean', 3, `<path d="M28 6h8l1 16h-10z"/><rect x="25" y="20" width="14" height="6" rx="1.5"/><path d="M25.5 26h13l13 30c-6 3-33 3-39 0z"/>`,
  `<path d="M26 23h12"/><path d="M29 31l-6 23M33 31l-1.5 24M37 31l4 23M31 9v11"/>`);
// Cooking: a handi with its lid, steam rising.
icon('cook', 5, `<path d="M14 30h36c0 16-7 25-18 25s-18-9-18-25z"/><rect x="10" y="27" width="44" height="5" rx="2.5"/><path d="M20 27c0-6 5-9 12-9s12 3 12 9z"/><rect x="29" y="14" width="6" height="5" rx="2"/><path d="M22 5c-3 3 3 5 0 8M42 5c-3 3 3 5 0 8" fill="none" stroke="${RED}" stroke-width="2.6" stroke-linecap="round"/>`,
  `<path d="M18 40c4 6 9 9 14 9"/>`);
// Gardening: a seedling in a clay pot.
icon('garden', 7, `<rect x="30" y="16" width="4" height="22" rx="2"/><path d="M32 28c-2-10-10-15-21-15 0 10 9 16 21 15z"/><path d="M32 23c2-9 9-14 19-14 0 9-8 15-19 14z"/><rect x="12" y="34" width="40" height="7" rx="2"/><path d="M16 41h32l-4 18H20z"/>`,
  `<path d="M15 16c5 3 10 7 15 10M47 12c-4 3-9 6-13 9"/><path d="M20 50h24"/>`);
// Painting: a wide brush with a dripping tip.
icon('paint', 11, `<rect x="28" y="4" width="8" height="24" rx="3"/><rect x="22" y="27" width="20" height="9" rx="2"/><path d="M20 36h24v14c0 2-2 4-4 4h-2v6c0 2-4 2-4 0v-6h-8c-2 0-4-2-4-4z"/>`,
  `<path d="M22 32h20M26 40v10M32 40v10M38 40v10"/>`);
// Helper: a tied sack, the load carried for a move or a shop.
icon('helper', 13, `<path d="M24 8h16l-3 10h-10z"/><rect x="22" y="17" width="20" height="5" rx="2"/><path d="M26 22h12c10 6 16 14 16 22 0 10-9 14-22 14S10 54 10 44c0-8 6-16 16-22z"/>`,
  `<path d="M24 19.5h16"/><path d="M20 38c4 4 20 4 24 0M18 47c6 4 22 4 28 0"/>`);
// Plumbing: a tap with a drop falling.
icon('plumb', 17, `<rect x="4" y="18" width="9" height="20" rx="2"/><path d="M13 22h27c9 0 15 6 15 15v5H44v-5c0-2-2-4-4-4H13z"/><rect x="26" y="11" width="6" height="12"/><rect x="17" y="6" width="24" height="7" rx="3.5"/><path d="M49.5 47c3 4 4.5 6.5 4.5 8.5a4.5 4.5 0 0 1-9 0c0-2 1.5-4.5 4.5-8.5z"/>`,
  `<path d="M17 27.5h20"/>`);
// Electrical: a bulb with its filament.
icon('elec', 19, `<path d="M32 4c11 0 19 8 19 18 0 7-4 11-7 15-2 3-3 5-3 8H23c0-3-1-5-3-8-3-4-7-8-7-15C13 12 21 4 32 4z"/><rect x="22" y="47" width="20" height="5" rx="2"/><rect x="24" y="53" width="16" height="5" rx="2"/><rect x="28" y="58" width="8" height="4" rx="2"/>`,
  `<path d="M26 38l3-12 3 6 3-6 3 12M22 14c2-4 5-6 9-7"/>`);
// Caretaker: two hands holding a heart.
icon('care', 23, `<path d="M32 30c-3-6-14-6-14 3 0 7 9 12 14 16 5-4 14-9 14-16 0-9-11-9-14-3z"/><path d="M4 44c6-1 12 1 17 5l9 6v5H12L4 54zM60 44c-6-1-12 1-17 5l-9 6v5h18l8-6z"/>`,
  `<path d="M24 33c0-3 2-5 5-5"/><path d="M14 52l6 3M50 52l-6 3"/>`);
// Healthcare: a first-aid box.
icon('health', 29, `<rect x="22" y="8" width="20" height="10" rx="3" fill="none" stroke="${RED}" stroke-width="4"/><rect x="6" y="16" width="52" height="40" rx="6"/>`,
  `<path d="M32 26v20M22 36h20" stroke-width="6"/>`);
// Anything else: a toolbox.
icon('other', 31, `<path d="M24 16v-5c0-2 2-3 3-3h10c1 0 3 1 3 3v5" fill="none" stroke="${RED}" stroke-width="4"/><rect x="6" y="16" width="52" height="14" rx="3"/><rect x="6" y="32" width="52" height="24" rx="3"/><rect x="27" y="26" width="10" height="10" rx="2"/>`,
  `<path d="M6 31h52"/><path d="M30 30h4"/>`);

console.log('web/assets/japi.svg, web/assets/tools/*.svg');
