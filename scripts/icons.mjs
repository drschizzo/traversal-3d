// Génère les icônes de la PWA (web/public/icons/) : un plateau voxel en terrasses sous un ciel de crépuscule,
// une pièce rouge et une pièce bleue de part et d'autre. Écrit icon.svg, puis le rend en PNG avec Playwright.
// Usage : node scripts/icons.mjs
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const out = new URL('../web/public/icons/', import.meta.url);

// plateau 5 × 5 : hauteur de chaque case (i vers la droite-avant, j vers la gauche-avant)
const HEIGHTS = [
  [0, 0, 0, 0, 0],
  [0, 1, 2, 1, 0],
  [0, 2, 3, 2, 0],
  [0, 1, 2, 1, 0],
  [0, 0, 0, 0, 0],
];
const N = HEIGHTS.length;
const TOP = ['#5f9e42', '#a9a26c', '#b3ada6', '#f4f6f8']; // herbe, terre, roche, neige (thème Crépuscule)
const STRATA = '#7a5c3e';
const TEAMS = [{ main: '#c8323c', dark: '#5c1117' }, { main: '#2c68d6', dark: '#102c66' }];
const GOLD = '#ffd36b';

const A = 45;            // demi-largeur d'une case à l'écran
const H = 25;            // hauteur d'un niveau
const CX = 256, OY = 138; // sommet arrière du plateau
const BASE = -0.5;       // dessous des colonnes

const f = n => n.toFixed(1);
const poly = (pts, fill, extra = '') => `<polygon points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="${fill}"${extra}/>`;
const iso = (i, j, h) => [CX + (i - j) * A, OY + (i + j) * A / 2 - h * H];

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * k))));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

function plinth() {
  const m = 0.32, d = 1.5;
  const t = [iso(-m, -m, BASE), iso(N + m, -m, BASE), iso(N + m, N + m, BASE), iso(-m, N + m, BASE)];
  const down = p => [p[0], p[1] + d * H];
  let s = poly(t, '#2c2840');
  s += poly([t[1], t[2], down(t[2]), down(t[1])], '#1b1828');
  s += poly([t[3], t[2], down(t[2]), down(t[3])], '#24203a');
  // lignes d'arrivée : bleue du côté des rouges, rouge du côté des bleus
  const e = 0.14;
  s += poly([iso(-m + e, N + m - e, BASE), iso(N + m - e, N + m - e, BASE), iso(N + m - e, N + m - 2.2 * e, BASE), iso(-m + e, N + m - 2.2 * e, BASE)], '#5a8cf0');
  s += poly([iso(N + m - e, -m + e, BASE), iso(N + m - e, N + m - e, BASE), iso(N + m - 2.2 * e, N + m - e, BASE), iso(N + m - 2.2 * e, -m + e, BASE)], '#f0646a');
  return s;
}

function column(i, j) {
  const h = HEIGHTS[j][i], top = TOP[h];
  const [n, e, s, w] = [iso(i, j, h), iso(i + 1, j, h), iso(i + 1, j + 1, h), iso(i, j + 1, h)];
  const dy = (h - BASE) * H;
  const down = p => [p[0], p[1] + dy];
  const lip = p => [p[0], p[1] + Math.min(dy, H * 0.45)];
  let out = '';
  // flancs : strates sous une lèvre de la couleur du dessus
  out += poly([e, s, down(s), down(e)], shade(STRATA, 0.72));
  out += poly([w, s, down(s), down(w)], shade(STRATA, 0.95));
  out += poly([e, s, lip(s), lip(e)], shade(top, 0.62));
  out += poly([w, s, lip(s), lip(w)], shade(top, 0.8));
  // dessus : joint sombre puis carreau légèrement en retrait
  out += poly([n, e, s, w], shade(top, 0.7));
  const k = 0.1, c = iso(i + 0.5, j + 0.5, h);
  const inset = p => [p[0] + (c[0] - p[0]) * k, p[1] + (c[1] - p[1]) * k];
  out += poly([n, e, s, w].map(inset), top);
  out += `<polyline points="${[w, n, e].map(inset).map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="1.5"/>`;
  return out;
}

// pièce : cône à cinq pans sur un socle, repère doré au sommet et aux pieds
function piece(i, j, team, rot) {
  const { main, dark } = TEAMS[team];
  const [x, y] = iso(i + 0.5, j + 0.5, HEIGHTS[j][i]);
  const r = A * 0.6, h = 92, sy = 0.5;
  let s = `<ellipse cx="${f(x)}" cy="${f(y + 4)}" rx="${f(A * 0.76)}" ry="${f(A * 0.38)}" fill="#000" opacity="0.35"/>`;
  s += `<ellipse cx="${f(x)}" cy="${f(y + 2)}" rx="${f(A * 0.68)}" ry="${f(A * 0.34)}" fill="${shade(dark, 0.8)}"/>`;
  s += `<ellipse cx="${f(x)}" cy="${f(y - 2)}" rx="${f(A * 0.68)}" ry="${f(A * 0.34)}" fill="${dark}"/>`;
  const by = y - 4, apex = [x, by - h];
  const pts = Array.from({ length: 5 }, (_, k) => {
    const t = rot + k * 2 * Math.PI / 5;
    return [x + r * Math.cos(t), by + r * sy * Math.sin(t)];
  });
  const light = 2.4; // lumière venant de l'avant-gauche
  const faces = pts.map((p, k) => {
    const q = pts[(k + 1) % 5], mid = rot + (k + 0.5) * 2 * Math.PI / 5;
    return { p, q, mid };
  }).filter(fc => Math.sin(fc.mid) > -0.15).sort((a, b) => Math.sin(a.mid) - Math.sin(b.mid));
  for (const fc of faces) {
    const k = 0.78 + 0.5 * Math.cos(fc.mid - light);
    s += poly([fc.p, fc.q, apex], shade(main, k), ` stroke="${shade(main, k)}" stroke-width="0.6" stroke-linejoin="round"`);
  }
  const pip = ([px, py], rad) => `<circle cx="${f(px)}" cy="${f(py)}" r="${rad}" fill="url(#gold)"/>`;
  for (const p of pts) if (p[1] > by - 1) s += pip(p, 3.6);
  s += pip(apex, 7);
  return s;
}

function scene() {
  const cells = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) cells.push([i, j]);
  cells.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);
  return plinth() + cells.map(([i, j]) => column(i, j)).join('') + piece(1, 4, 0, -1.2) + piece(4, 1, 1, 0.4);
}

const SPARKS = [[78, 92, 2.4], [430, 70, 1.8], [462, 168, 2.6], [58, 230, 1.6], [120, 40, 1.4], [372, 30, 2], [470, 400, 1.6], [40, 420, 2]];

function svg({ scale = 1 } = {}) {
  const t = `translate(256 270) scale(${scale}) translate(-256 -270)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
  <radialGradient id="sky" cx="0.5" cy="0.32" r="0.8">
    <stop offset="0" stop-color="#4a3772"/><stop offset="0.5" stop-color="#241c42"/><stop offset="1" stop-color="#0c0f22"/>
  </radialGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#ff9a5a" stop-opacity="0.45"/><stop offset="1" stop-color="#ff9a5a" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="gold" cx="0.35" cy="0.3" r="0.75">
    <stop offset="0" stop-color="#fff6d8"/><stop offset="0.45" stop-color="${GOLD}"/><stop offset="1" stop-color="#9a6a10"/>
  </radialGradient>
</defs>
<rect width="512" height="512" fill="url(#sky)"/>
<ellipse cx="256" cy="250" rx="250" ry="150" fill="url(#glow)"/>
${SPARKS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffe0a8" opacity="0.8"/>`).join('')}
<g transform="${t}">${scene()}</g>
</svg>`;
}

const regular = svg({ scale: 0.94 });
const maskable = svg({ scale: 0.76 }); // zone sûre : 80 % du carré
writeFileSync(new URL('icon.svg', out), regular);

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, src, size] of [['icon-512.png', regular, 512], ['icon-192.png', regular, 192], ['apple-touch-icon.png', regular, 180], ['icon-maskable-512.png', maskable, 512]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${src}`);
  await page.screenshot({ path: new URL(name, out).pathname, omitBackground: false });
}
await browser.close();
