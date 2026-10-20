// Bot dans un Web Worker : moteur Rust compilé en WebAssembly (engine/), repli sur ai.js s'il ne se charge pas.
// Avec { analyze: true }, renvoie aussi de quoi expliquer le coup : évaluation, variante prévue, alternatives.
import { chooseMove } from './ai.js';
import { pieceMoves, applyMove } from './game.js';

export const LEVELS = {
  easy: { time: 400, depth: 1, noise: 40, quiesce: 0 },
  medium: { time: 700, depth: 3, noise: 10, quiesce: 1 },
  hard: { time: 2500, depth: 64, noise: 0, quiesce: 1 },
  expert: { time: 8000, depth: 64, noise: 0, quiesce: 1 },
  review: { time: 800, depth: 64, noise: 0, quiesce: 1 }, // analyse de fin de partie
};
const KINDS = ['move', 'attack', 'exit'];

const engine = fetch(new URL('./engine/traversal.wasm', import.meta.url))
  .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
  .then(b => WebAssembly.instantiate(b, { env: { now: () => performance.now() } }))
  .then(r => r.instance.exports)
  .catch(e => { console.warn('Moteur WebAssembly indisponible, repli sur le bot JavaScript', e); return null; });

// coup codé par le moteur -> coup complet (chemin, combat) du moteur de règles JavaScript
function decode(state, code) {
  const pi = code & 255, kind = KINDS[(code >> 8) & 255], to = code >> 16;
  return pieceMoves(state, pi, true).find(m => m.kind === kind && (kind === 'exit' || m.to === to)) || null;
}

function wasmThink(ex, state, level, analyze) {
  const cfg = LEVELS[level] || LEVELS.medium;
  let buf = new Int32Array(ex.memory.buffer, ex.buf(), 1024);
  for (let i = 0; i < 100; i++) buf[i] = state.h[i];
  state.pieces.forEach((p, k) => buf.set([p.t, p.o, p.x, p.y, p.st], 100 + k * 5));
  buf.set([state.turn, state.ply, state.score[0], state.score[1], state.crossed], 160);
  const r = ex.think(cfg.time, cfg.depth, cfg.noise, cfg.quiesce, (Math.random() * 2 ** 32) >>> 0, analyze ? 4 : 0);
  if (r < 0) return { move: null };
  buf = new Int32Array(ex.memory.buffer, ex.buf(), 1024); // la mémoire a pu grandir pendant la recherche
  const move = decode(state, r);
  if (!move || !analyze) return { move };
  const info = { depth: buf[200], nodes: buf[201], score: buf[202], noisy: cfg.noise > 0, alts: [], pv: [] };
  for (let k = 0; k < buf[210]; k++) {
    const m = decode(state, buf[211 + 2 * k]);
    if (m) info.alts.push({ move: m, score: buf[212 + 2 * k] });
  }
  // variante prévue, rejouée avec les règles JavaScript (on s'arrête au premier coup illisible)
  let s = state;
  for (let k = 0; k < buf[230] && !s.over; k++) {
    const m = decode(s, buf[231 + k]);
    if (!m) break;
    info.pv.push({ move: m, before: s });
    s = applyMove(s, m);
  }
  info.turns = Int8Array.from(buf.subarray(400, 1000));
  return { move, info };
}

self.onmessage = async e => {
  const { state, level, token, analyze } = e.data;
  const ex = await engine;
  let res = null;
  if (ex) {
    try { res = wasmThink(ex, state, level, analyze); } catch (err) { console.warn(err); }
  }
  if (!res || !res.move) res = { move: chooseMove(state, level === 'expert' ? 'hard' : level) };
  self.postMessage({ ...res, token });
};
