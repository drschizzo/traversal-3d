// Traversal — moteur de règles (pur, sans DOM, utilisable dans un Worker)

export const N = 10;
export const EXPLORER = 0, VANGUARD = 1, SENTINEL = 2;
export const MOVE = [5, 4, 3];
export const STR = [1, 2, 3];
export const TYPE_NAMES = ['Explorateur', 'Avant-garde', 'Sentinelle'];
export const TYPE_GLYPHS = ['⬟', '◆', '▲'];
export const TYPE_DESC = [
  'Au lieu de son déplacement normal : 1 case en diagonale, ou bond de 2 cases en ligne droite, sans coût de hauteur.',
  '+1 en attaque si le plus court chemin vers la cible coûte exactement 4 points de Mouvement.',
  'Si elle est la toute première pièce à franchir l’arrivée, son joueur gagne immédiatement.',
];
export const PLAYER_NAMES = ['Rouge', 'Bleu'];
export const MAX_PLIES = 200;
export const ON_BOARD = 0, CAPTURED = 1, SCORED = 2;

export const TERRAIN_MODES = [
  ['random', 'Aléatoire'],
  ['mountains', 'Montagnes'],
  ['valleys', 'Vallées'],
  ['highlands', 'Hautes terres'],
  ['woods', 'Bois'],
  ['desert', 'Désert'],
];

export const idx = (x, y) => y * N + x;
export const cx = i => i % N;
export const cy = i => (i / N) | 0;
export const goalRow = o => (o === 0 ? N - 1 : 0);

export const NEIGH = [];
for (let i = 0; i < N * N; i++) {
  const x = cx(i), y = cy(i), a = [];
  if (x > 0) a.push(i - 1);
  if (x < N - 1) a.push(i + 1);
  if (y > 0) a.push(i - N);
  if (y < N - 1) a.push(i + N);
  NEIGH.push(a);
}

// ---------------------------------------------------------------- terrain

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(rng, scale) {
  const G = 16, grid = Array.from({ length: G * G }, () => rng());
  const g = (i, j) => grid[(((j % G) + G) % G) * G + (((i % G) + G) % G)];
  const s = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / scale, fy = y / scale, x0 = Math.floor(fx), y0 = Math.floor(fy);
    const u = s(fx - x0), v = s(fy - y0);
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export function generateTerrain(mode = 'random', seed = (Math.random() * 2 ** 32) >>> 0) {
  const rng = mulberry32(seed);
  const nA = valueNoise(rng, 3.4), nB = valueNoise(rng, 1.8), nC = valueNoise(rng, 5.5);
  const ox = rng() * 20, oy = rng() * 20;
  const blobs = [];
  const addBlobs = (k, sMin, sMax, spread) => {
    for (let i = 0; i < k; i++)
      blobs.push({ x: 4.5 + (rng() * 2 - 1) * spread, y: 4.5 + (rng() * 2 - 1) * spread, s: sMin + rng() * (sMax - sMin), a: 0.75 + rng() * 0.25 });
  };
  const blob = (x, y) => blobs.reduce((s, b) => s + b.a * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.s * b.s)), 0);
  const ridge = n => 1 - Math.abs(2 * n - 1);
  let maxH, f;
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
  const raw = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      raw[idx(x, y)] = f(x, y, nA(x + ox, y + oy), nB(x + oy, y + ox), nC(x + ox * 0.5, y + oy * 0.7));
  // symétrie centrale : plateau équitable pour les deux camps
  const sym = raw.map((v, i) => (v + raw[N * N - 1 - i]) / 2);
  let lo = Infinity, hi = -Infinity;
  for (const v of sym) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const h = new Int8Array(N * N);
  for (let i = 0; i < N * N; i++) h[i] = Math.round(((sym[i] - lo) / (hi - lo || 1)) * maxH);
  // deux cases adjacentes diffèrent d'au plus 2
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < N * N; i++)
      for (const n of NEIGH[i])
        if (h[i] > h[n] + 2) { h[i] = h[n] + 2; changed = true; }
  }
  return h;
}

// ---------------------------------------------------------------- état

export function newGame(heights) {
  const order = [SENTINEL, VANGUARD, EXPLORER, EXPLORER, VANGUARD, SENTINEL];
  const cell = new Int8Array(N * N).fill(-1);
  const pieces = [];
  for (let o = 0; o < 2; o++)
    order.forEach((t, k) => {
      const x = 2 + k, y = o === 0 ? 0 : N - 1;
      cell[idx(x, y)] = pieces.length;
      pieces.push({ t, o, x, y, st: ON_BOARD });
    });
  return { h: heights, cell, pieces, turn: 0, ply: 0, score: [0, 0], crossed: 0, over: false, winner: -1, reason: '', passed: false, last: null };
}

export function clone(s) {
  return { ...s, cell: s.cell.slice(), pieces: s.pieces.map(p => ({ ...p })), score: s.score.slice() };
}

// Dijkstra (coûts ≤ 5) : distance en points de Mouvement à travers les cases vides
export function reach(s, pi) {
  const p = s.pieces[pi], mp = MOVE[p.t], H = s.h;
  const start = idx(p.x, p.y);
  const dist = new Int8Array(N * N).fill(99), prev = new Int8Array(N * N).fill(-1);
  const buckets = Array.from({ length: mp + 1 }, () => []);
  dist[start] = 0; buckets[0].push(start);
  for (let c = 0; c <= mp; c++)
    for (const u of buckets[c]) {
      if (dist[u] !== c) continue;
      for (const v of NEIGH[u]) {
        if (s.cell[v] !== -1) continue;
        const nc = c + 1 + Math.abs(H[u] - H[v]);
        if (nc <= mp && nc < dist[v]) { dist[v] = nc; prev[v] = u; buckets[nc].push(v); }
      }
    }
  return { dist, prev, start, mp };
}

function pathTo(prev, v) {
  const p = [v];
  while (prev[p[0]] !== -1) p.unshift(prev[p[0]]);
  return p;
}

// Forces effectives d'une attaque de la pièce pi sur la case target
export function combat(s, pi, target, vanguardBonus) {
  const p = s.pieces[pi], dpi = s.cell[target], d = s.pieces[dpi], H = s.h;
  const hs = H[idx(p.x, p.y)], ht = H[target];
  const height = hs > ht ? 1 : hs < ht ? -1 : 0;
  let allies = 0, reinf = 0;
  for (const n of NEIGH[target]) {
    const q = s.cell[n];
    if (q < 0 || q === pi) continue;
    if (s.pieces[q].o === p.o) allies += STR[s.pieces[q].t];
    else reinf += 1;
  }
  const vb = vanguardBonus ? 1 : 0;
  return {
    att: STR[p.t] + height + vb + allies, def: STR[d.t] + reinf,
    base: STR[p.t], height, vb, allies, dBase: STR[d.t], reinf, defender: dpi,
  };
}

// Tous les coups d'une pièce. dedupeExit : un seul coup de sortie par pièce (pour l'IA).
export function pieceMoves(s, pi, dedupeExit = false) {
  const p = s.pieces[pi];
  if (p.st !== ON_BOARD) return [];
  const { dist, prev, start, mp } = reach(s, pi), H = s.h, res = [];
  for (let v = 0; v < N * N; v++)
    if (v !== start && dist[v] <= mp) res.push({ pi, kind: 'move', to: v, path: pathTo(prev, v), cost: dist[v] });

  // attaques : entrer sur la case ennemie
  const best = new Map();
  for (let u = 0; u < N * N; u++) {
    if (dist[u] > mp) continue;
    for (const v of NEIGH[u]) {
      const q = s.cell[v];
      if (q < 0 || s.pieces[q].o === p.o) continue;
      const c = dist[u] + 1 + Math.abs(H[u] - H[v]);
      if (c <= mp && (!best.has(v) || c < best.get(v).c)) best.set(v, { c, u });
    }
  }
  for (const [v, { c, u }] of best) {
    const vb = p.t === VANGUARD && c === 4;
    const cb = combat(s, pi, v, vb);
    if (cb.att >= cb.def) res.push({ pi, kind: 'attack', to: v, path: [...pathTo(prev, u), v], cost: c, combat: cb });
  }

  // sortie par le bord opposé : être sur la dernière rangée avec ≥ 1 point restant
  const gr = goalRow(p.o);
  const exits = [];
  for (let x = 0; x < N; x++) {
    const u = idx(x, gr);
    if (dist[u] <= mp - 1) exits.push({ pi, kind: 'exit', to: u, path: pathTo(prev, u), cost: dist[u] + 1 });
  }
  if (dedupeExit && exits.length) { exits.sort((a, b) => a.cost - b.cost); res.push(exits[0]); }
  else res.push(...exits);

  // coups spéciaux de l'Explorateur
  if (p.t === EXPLORER) {
    const sp = [[1, 1, 'diag'], [1, -1, 'diag'], [-1, 1, 'diag'], [-1, -1, 'diag'], [2, 0, 'jump'], [-2, 0, 'jump'], [0, 2, 'jump'], [0, -2, 'jump']];
    for (const [dx, dy, kind] of sp) {
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const v = idx(x, y), q = s.cell[v];
      if (q === -1) {
        if (dist[v] <= mp) continue; // déjà atteignable normalement
        res.push({ pi, kind: 'move', to: v, path: [start, v], cost: 0, special: kind });
      } else if (s.pieces[q].o !== p.o && !best.has(v)) {
        const cb = combat(s, pi, v, false);
        if (cb.att >= cb.def) res.push({ pi, kind: 'attack', to: v, path: [start, v], cost: 0, special: kind, combat: cb });
      }
    }
  }
  return res;
}

export function allMoves(s, dedupeExit = false) {
  const res = [];
  s.pieces.forEach((p, pi) => { if (p.o === s.turn && p.st === ON_BOARD) res.push(...pieceMoves(s, pi, dedupeExit)); });
  return res;
}

function hasAnyMove(s) {
  for (let pi = 0; pi < s.pieces.length; pi++) {
    const p = s.pieces[pi];
    if (p.o === s.turn && p.st === ON_BOARD && pieceMoves(s, pi, true).length) return true;
  }
  return false;
}

function finish(s, winner, reason) { s.over = true; s.winner = winner; s.reason = reason; }

function endByScore(s, reason) {
  if (s.score[0] !== s.score[1]) return finish(s, s.score[0] > s.score[1] ? 0 : 1, reason);
  if (s.score[0] > 0) return finish(s, 2, reason);
  // personne n'a marqué : pièce la plus proche de l'arrivée, puis la plus forte
  const bestOf = o => {
    let rows = Infinity, str = 0;
    for (const p of s.pieces) {
      if (p.o !== o || p.st !== ON_BOARD) continue;
      const r = o === 0 ? N - p.y : p.y + 1;
      if (r < rows || (r === rows && STR[p.t] > str)) { rows = r; str = STR[p.t]; }
    }
    return { rows, str };
  };
  const a = bestOf(0), b = bestOf(1);
  if (a.rows !== b.rows) return finish(s, a.rows < b.rows ? 0 : 1, reason + ' — pièce la plus proche de l’arrivée');
  if (a.str !== b.str) return finish(s, a.str > b.str ? 0 : 1, reason + ' — pièce la plus forte');
  finish(s, 2, reason);
}

export function applyMove(s0, m) {
  const s = clone(s0);
  const p = s.pieces[m.pi];
  s.cell[idx(p.x, p.y)] = -1;
  s.passed = false;
  if (m.kind === 'exit') {
    p.st = SCORED;
    s.score[p.o] += STR[p.t];
    s.crossed++;
    if (s.crossed === 1 && p.t === SENTINEL) finish(s, p.o, 'Une Sentinelle a franchi l’arrivée en premier');
    else if (s.crossed >= 2) endByScore(s, 'Deux pièces ont franchi l’arrivée');
  } else {
    if (m.kind === 'attack') s.pieces[s.cell[m.to]].st = CAPTURED;
    s.cell[m.to] = m.pi;
    p.x = cx(m.to); p.y = cy(m.to);
  }
  s.ply++;
  s.last = { pi: m.pi, kind: m.kind, to: m.to };
  if (!s.over) {
    if (s.ply >= MAX_PLIES) endByScore(s, 'Limite de 200 coups atteinte');
    else {
      s.turn = 1 - s.turn;
      if (!hasAnyMove(s)) {
        s.turn = 1 - s.turn;
        if (!hasAnyMove(s)) endByScore(s, 'Plus aucun coup possible');
        else s.passed = true;
      }
    }
  }
  return s;
}

// Coût minimal (terrain seul) pour sortir depuis chaque case
export function exitDistances(h, o) {
  const d = new Float32Array(N * N).fill(Infinity), gr = goalRow(o);
  for (let x = 0; x < N; x++) d[idx(x, gr)] = 1;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < N * N; i++)
      for (const n of NEIGH[i]) {
        const c = d[n] + 1 + Math.abs(h[i] - h[n]);
        if (c < d[i]) { d[i] = c; changed = true; }
      }
  }
  return d;
}
