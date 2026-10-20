// Bot dans un Web Worker : moteur Rust compilé en WebAssembly (engine/), repli sur ai.js s'il ne se charge pas.
import { chooseMove } from './ai.js';
import { pieceMoves } from './game.js';

const LEVELS = {
  easy: { time: 400, depth: 1, noise: 40, quiesce: 0 },
  medium: { time: 700, depth: 3, noise: 10, quiesce: 1 },
  hard: { time: 2500, depth: 64, noise: 0, quiesce: 1 },
};
const KINDS = ['move', 'attack', 'exit'];

const engine = fetch(new URL('./engine/traversal.wasm', import.meta.url))
  .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
  .then(b => WebAssembly.instantiate(b, { env: { now: () => performance.now() } }))
  .then(r => r.instance.exports)
  .catch(e => { console.warn('Moteur WebAssembly indisponible, repli sur le bot JavaScript', e); return null; });

function wasmMove(ex, state, level) {
  const cfg = LEVELS[level] || LEVELS.medium;
  const buf = new Int32Array(ex.memory.buffer, ex.buf(), 256);
  for (let i = 0; i < 100; i++) buf[i] = state.h[i];
  state.pieces.forEach((p, k) => buf.set([p.t, p.o, p.x, p.y, p.st], 100 + k * 5));
  buf.set([state.turn, state.ply, state.score[0], state.score[1], state.crossed], 160);
  const r = ex.think(cfg.time, cfg.depth, cfg.noise, cfg.quiesce, (Math.random() * 2 ** 32) >>> 0);
  if (r < 0) return null;
  const pi = r & 255, kind = KINDS[(r >> 8) & 255], to = r >> 16;
  // le coup complet (chemin, combat) vient du moteur de règles JavaScript
  return pieceMoves(state, pi, true).find(m => m.kind === kind && (kind === 'exit' || m.to === to)) || null;
}

self.onmessage = async e => {
  const { state, level, token } = e.data;
  const ex = await engine;
  let move = null;
  if (ex) {
    try { move = wasmMove(ex, state, level); } catch (err) { console.warn(err); }
  }
  if (!move) move = chooseMove(state, level);
  self.postMessage({ move, token });
};
