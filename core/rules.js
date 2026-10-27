// Traversal — moteur de règles (pur, sans DOM ni texte : utilisable dans un Worker, sur le serveur et dans les tests).
// Une position est immuable : applyMove en renvoie une nouvelle.
// Porté à l'identique en Rust (engine/src/game.rs) ; tests/parity.test.js vérifie que les deux concordent.
import { N, NC, EXPLORER, VANGUARD, SENTINEL, MOVE, STR, ON_BOARD, CAPTURED, SCORED, MAX_PLIES, DRAW, END, TIEBREAK } from './constants.js';
import { idx, cx, cy, goalRow, NEIGH } from './board.js';

/** @import { Kind } from './constants.js' */
/** @import { WireMove } from './move.js' */
/**
 * @typedef {{ t: number, o: number, x: number, y: number, st: number }} Piece
 * @typedef {{
 *   h: Int8Array, cell: Int8Array, pieces: Piece[], turn: number, ply: number, score: number[], crossed: number,
 *   over: boolean, winner: number, reason: string | null, tiebreak: string | null, resigned?: number, passed: boolean,
 *   last: WireMove | null
 * }} State
 * @typedef {{ winner: number, reason: string, tiebreak?: string | null, resigned?: number }} Result fin de partie
 * @typedef {{ att: number, def: number, base: number, height: number, vb: number, allies: number, dBase: number, reinf: number, defender: number }} Combat
 * @typedef {{ pi: number, kind: Kind, to: number, path: number[], cost: number, special?: 'diag' | 'jump', combat?: Combat }} Move
 */

/** @param {Int8Array} heights @returns {State} */
export function newGame(heights) {
  const order = [SENTINEL, VANGUARD, EXPLORER, EXPLORER, VANGUARD, SENTINEL];
  const cell = new Int8Array(NC).fill(-1);
  /** @type {Piece[]} */
  const pieces = [];
  for (let o = 0; o < 2; o++)
    order.forEach((t, k) => {
      const x = 2 + k, y = o === 0 ? 0 : N - 1;
      cell[idx(x, y)] = pieces.length;
      pieces.push({ t, o, x, y, st: ON_BOARD });
    });
  return { h: heights, cell, pieces, turn: 0, ply: 0, score: [0, 0], crossed: 0, over: false, winner: -1, reason: null, tiebreak: null, passed: false, last: null };
}

/** @param {State} s @returns {State} */
export function clone(s) {
  return { ...s, cell: s.cell.slice(), pieces: s.pieces.map(p => ({ ...p })), score: s.score.slice() };
}

// Dijkstra (coûts ≤ 5) : distance en points de Mouvement à travers les cases vides
/** @param {State} s @param {number} pi */
export function reach(s, pi) {
  const p = s.pieces[pi], mp = MOVE[p.t], H = s.h;
  const start = idx(p.x, p.y);
  // dist : points de Mouvement (≤ 5, 99 = hors d'atteinte) ; prev : indice de la case précédente, donc Int16
  const dist = new Int8Array(NC).fill(99), prev = new Int16Array(NC).fill(-1);
  const buckets = Array.from({ length: mp + 1 }, () => /** @type {number[]} */ ([]));
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

/** @param {Int16Array} prev @param {number} v */
function pathTo(prev, v) {
  const p = [v];
  while (prev[p[0]] !== -1) p.unshift(prev[p[0]]);
  return p;
}

/**
 * Forces effectives d'une attaque de la pièce pi sur la case target.
 * @param {State} s @param {number} pi @param {number} target @param {boolean} vanguardBonus
 * @returns {Combat}
 */
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

/**
 * Tous les coups d'une pièce. dedupeExit : un seul coup de sortie par pièce (le moins coûteux).
 * @param {State} s @param {number} pi
 * @returns {Move[]}
 */
export function pieceMoves(s, pi, dedupeExit = false) {
  const p = s.pieces[pi];
  if (p.st !== ON_BOARD) return [];
  const { dist, prev, start, mp } = reach(s, pi), H = s.h;
  /** @type {Move[]} */
  const res = [];
  for (let v = 0; v < NC; v++)
    if (v !== start && dist[v] <= mp) res.push({ pi, kind: 'move', to: v, path: pathTo(prev, v), cost: dist[v] });

  // attaques : entrer sur la case ennemie
  /** @type {Map<number, { c: number, u: number }>} */
  const best = new Map();
  for (let u = 0; u < NC; u++) {
    if (dist[u] > mp) continue;
    for (const v of NEIGH[u]) {
      const q = s.cell[v];
      if (q < 0 || s.pieces[q].o === p.o) continue;
      const c = dist[u] + 1 + Math.abs(H[u] - H[v]);
      if (c <= mp && c < (best.get(v)?.c ?? Infinity)) best.set(v, { c, u });
    }
  }
  for (const [v, { c, u }] of best) {
    const vb = p.t === VANGUARD && c === 4;
    const cb = combat(s, pi, v, vb);
    if (cb.att >= cb.def) res.push({ pi, kind: 'attack', to: v, path: [...pathTo(prev, u), v], cost: c, combat: cb });
  }

  // sortie par le bord opposé : être sur la dernière rangée avec ≥ 1 point restant
  const gr = goalRow(p.o);
  /** @type {Move[]} */
  const exits = [];
  for (let x = 0; x < N; x++) {
    const u = idx(x, gr);
    if (dist[u] <= mp - 1) exits.push({ pi, kind: 'exit', to: u, path: pathTo(prev, u), cost: dist[u] + 1 });
  }
  if (dedupeExit && exits.length) { exits.sort((a, b) => a.cost - b.cost); res.push(exits[0]); }
  else res.push(...exits);

  // coups spéciaux de l'Explorateur ; ils ne visent jamais une case déjà accessible normalement,
  // si bien qu'un coup reste identifié sans ambiguïté par { pi, kind, to } (voir move.js)
  if (p.t === EXPLORER) {
    /** @type {[number, number, 'diag' | 'jump'][]} */
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

/** @param {State} s @returns {Move[]} */
export function allMoves(s, dedupeExit = false) {
  /** @type {Move[]} */
  const res = [];
  s.pieces.forEach((p, pi) => { if (p.o === s.turn && p.st === ON_BOARD) res.push(...pieceMoves(s, pi, dedupeExit)); });
  return res;
}

/**
 * Attaques que le camp by pourrait jouer s'il avait le trait : pièce visée → attaquants (rien si la partie est finie).
 * @param {State} s @param {number} by @returns {Map<number, number[]>}
 */
export function attacksBy(s, by) {
  /** @type {Map<number, number[]>} */
  const map = new Map();
  if (s.over) return map;
  for (const m of allMoves({ ...s, turn: by }, true)) {
    if (m.kind !== 'attack') continue;
    const d = s.cell[m.to], list = map.get(d);
    if (list) list.push(m.pi);
    else map.set(d, [m.pi]);
  }
  return map;
}

/** @param {State} s */
function hasAnyMove(s) {
  for (let pi = 0; pi < s.pieces.length; pi++) {
    const p = s.pieces[pi];
    if (p.o === s.turn && p.st === ON_BOARD && pieceMoves(s, pi, true).length) return true;
  }
  return false;
}

/** @param {State} s @param {number} winner @param {string} reason @param {string | null} tiebreak */
function finish(s, winner, reason, tiebreak = null) { s.over = true; s.winner = winner; s.reason = reason; s.tiebreak = tiebreak; }

/** @param {State} s @param {string} reason */
function endByScore(s, reason) {
  if (s.score[0] !== s.score[1]) return finish(s, s.score[0] > s.score[1] ? 0 : 1, reason);
  if (s.score[0] > 0) return finish(s, DRAW, reason);
  // personne n'a marqué : pièce la plus proche de l'arrivée, puis la plus forte
  const bestOf = (/** @type {number} */ o) => {
    let rows = Infinity, str = 0;
    for (const p of s.pieces) {
      if (p.o !== o || p.st !== ON_BOARD) continue;
      const r = o === 0 ? N - p.y : p.y + 1;
      if (r < rows || (r === rows && STR[p.t] > str)) { rows = r; str = STR[p.t]; }
    }
    return { rows, str };
  };
  const a = bestOf(0), b = bestOf(1);
  if (a.rows !== b.rows) return finish(s, a.rows < b.rows ? 0 : 1, reason, TIEBREAK.CLOSEST);
  if (a.str !== b.str) return finish(s, a.str > b.str ? 0 : 1, reason, TIEBREAK.STRONGEST);
  finish(s, DRAW, reason);
}

/** @param {State} s0 @param {WireMove} m @returns {State} */
export function applyMove(s0, m) {
  const s = clone(s0);
  const p = s.pieces[m.pi];
  s.cell[idx(p.x, p.y)] = -1;
  s.passed = false;
  if (m.kind === 'exit') {
    p.st = SCORED;
    s.score[p.o] += STR[p.t];
    s.crossed++;
    if (s.crossed === 1 && p.t === SENTINEL) finish(s, p.o, END.SENTINEL);
    else if (s.crossed >= 2) endByScore(s, END.TWO);
  } else {
    if (m.kind === 'attack') s.pieces[s.cell[m.to]].st = CAPTURED;
    s.cell[m.to] = m.pi;
    p.x = cx(m.to); p.y = cy(m.to);
  }
  s.ply++;
  s.last = { pi: m.pi, kind: m.kind, to: m.to };
  if (!s.over) {
    if (s.ply >= MAX_PLIES) endByScore(s, END.PLIES);
    else {
      s.turn = 1 - s.turn;
      if (!hasAnyMove(s)) {
        s.turn = 1 - s.turn;
        if (!hasAnyMove(s)) endByScore(s, END.STUCK);
        else s.passed = true;
      }
    }
  }
  return s;
}

/**
 * Fin de partie décidée hors des règles (abandon, résultat imposé par le serveur) ; resigned : camp qui abandonne.
 * @param {State} s @param {Result} result @returns {State}
 */
export function withResult(s, { winner, reason, tiebreak = null, resigned = undefined }) {
  return { ...s, over: true, winner, reason, tiebreak, ...(resigned === undefined ? {} : { resigned }) };
}
