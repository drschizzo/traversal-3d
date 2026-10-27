// Générateur de terrain : un monde est entièrement déterminé par (mode, graine).
// Porté à l'identique en Rust (engine/src/game.rs) ; tests/parity.test.js vérifie que les deux concordent.
import { N, NC, TERRAINS } from './constants.js';
import { idx, NEIGH } from './board.js';

/** @param {number} a @returns {() => number} */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = () => (Math.random() * 2 ** 32) >>> 0;
/** @type {(mode: unknown) => mode is string} */
export const isTerrain = mode => typeof mode === 'string' && TERRAINS.includes(mode);
/** @type {(seed: unknown) => seed is number} */
export const isSeed = seed => typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32;

/** @param {() => number} rng @param {number} scale @returns {(x: number, y: number) => number} */
function valueNoise(rng, scale) {
  const G = 16, grid = Array.from({ length: G * G }, () => rng());
  /** @type {(i: number, j: number) => number} */
  const g = (i, j) => grid[(((j % G) + G) % G) * G + (((i % G) + G) % G)];
  const s = (/** @type {number} */ t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / scale, fy = y / scale, x0 = Math.floor(fx), y0 = Math.floor(fy);
    const u = s(fx - x0), v = s(fy - y0);
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** @returns {Int8Array} hauteurs de 0 à 8, case par case */
export function generateTerrain(mode = 'random', seed = randomSeed()) {
  const rng = mulberry32(seed);
  const nA = valueNoise(rng, 3.4), nB = valueNoise(rng, 1.8), nC = valueNoise(rng, 5.5);
  const ox = rng() * 20, oy = rng() * 20;
  /** @type {{ x: number, y: number, s: number, a: number }[]} */
  const blobs = [];
  /** @type {(k: number, sMin: number, sMax: number, spread: number) => void} */
  const addBlobs = (k, sMin, sMax, spread) => {
    for (let i = 0; i < k; i++)
      blobs.push({ x: 4.5 + (rng() * 2 - 1) * spread, y: 4.5 + (rng() * 2 - 1) * spread, s: sMin + rng() * (sMax - sMin), a: 0.75 + rng() * 0.25 });
  };
  /** @type {(x: number, y: number) => number} */
  const blob = (x, y) => blobs.reduce((s, b) => s + b.a * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.s * b.s)), 0);
  const ridge = (/** @type {number} */ n) => 1 - Math.abs(2 * n - 1);
  /** @type {number} */
  let maxH;
  /** @type {(x: number, y: number, a: number, b: number, c: number) => number} */
  let f;
  switch (mode) {
    case 'mountains':
      maxH = 8; addBlobs(2, 1.5, 2.3, 1.8);
      f = (x, y, a, b) => 0.9 * blob(x, y) + 0.22 * a + 0.1 * b; break;
    case 'valleys':
      maxH = 7;
      f = (x, y, a, b, c) => 0.8 * Math.pow(Math.max(ridge(a), 0.85 * ridge(c)), 2.4) + 0.1 * b; break;
    case 'highlands':
      maxH = 7; addBlobs(2, 1.3, 1.9, 2.6);
      f = (x, y, a, b, c) => 0.6 * blob(x, y) + 0.4 * Math.pow(ridge(c), 2) + 0.15 * a; break;
    case 'woods':
      maxH = 3;
      f = (x, y, a, b) => 0.65 * a + 0.35 * b; break;
    case 'desert':
      maxH = 6; addBlobs(1 + ((rng() * 2) | 0), 0.7, 1.1, 3.2);
      f = (x, y, a, b) => blob(x, y) + 0.1 * b; break;
    default:
      maxH = 6; addBlobs(1, 1.5, 2.5, 3);
      f = (x, y, a, b) => 0.55 * a + 0.3 * b + 0.35 * blob(x, y);
  }
  const raw = new Float32Array(NC);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      raw[idx(x, y)] = f(x, y, nA(x + ox, y + oy), nB(x + oy, y + ox), nC(x + ox * 0.5, y + oy * 0.7));
  // symétrie centrale : plateau équitable pour les deux camps
  const sym = raw.map((v, i) => (v + raw[NC - 1 - i]) / 2);
  let lo = Infinity, hi = -Infinity;
  for (const v of sym) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const h = new Int8Array(NC);
  for (let i = 0; i < NC; i++) h[i] = Math.round(((sym[i] - lo) / (hi - lo || 1)) * maxH);
  // deux cases adjacentes diffèrent d'au plus 2
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < NC; i++)
      for (const n of NEIGH[i])
        if (h[i] > h[n] + 2) { h[i] = h[n] + 2; changed = true; }
  }
  return h;
}
