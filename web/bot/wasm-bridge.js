// Pont vers le moteur WebAssembly (engine/) : écrit une position dans le tampon partagé, lance la recherche
// et relit le résultat. Les positions du tampon viennent de engine/layout.json, partagé avec le moteur.
import L from '../../engine/layout.json';
import { KINDS, applyMove, findEquivalent } from '../../core/index.js';
import { LEVELS } from './levels.js';

// source : adresse du fichier .wasm, ou son contenu (tests)
export async function loadEngine(source) {
  let bytes = source;
  if (typeof source === 'string' || source instanceof URL) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`moteur introuvable (${res.status})`);
    bytes = await res.arrayBuffer();
  }
  const { instance } = await WebAssembly.instantiate(bytes, { env: { now: () => performance.now() } });
  const ex = /** @type {any} */ (instance.exports);
  if (ex.layout_version?.() !== L.VERSION) throw new Error('moteur d’une autre version que le jeu');
  return ex;
}

// la mémoire du module peut grandir pendant une recherche : la vue sur le tampon est recréée à chaque lecture
const view = ex => new Int32Array(ex.memory.buffer, ex.buf(), L.SIZE);

function writeState(ex, s) {
  const buf = view(ex);
  for (let i = 0; i < 100; i++) buf[L.IN_HEIGHTS + i] = s.h[i];
  s.pieces.forEach((p, k) => buf.set([p.t, p.o, p.x, p.y, p.st], L.IN_PIECES + k * L.PIECE_STRIDE));
  buf[L.IN_TURN] = s.turn;
  buf[L.IN_PLY] = s.ply;
  buf[L.IN_SCORE] = s.score[0];
  buf[L.IN_SCORE + 1] = s.score[1];
  buf[L.IN_CROSSED] = s.crossed;
}

// coup codé par le moteur -> coup complet (chemin, combat) des règles JavaScript
const decode = (s, code) => findEquivalent(s, { pi: code & 255, kind: KINDS[(code >> 8) & 255], to: code >> 16 });

/**
 * Cherche un coup. Avec analyze, renvoie aussi de quoi l'expliquer (coach/) : évaluation, variante prévue,
 * alternatives et tours minimaux pour sortir.
 */
export function think(ex, state, level, analyze, seed = (Math.random() * 2 ** 32) >>> 0) {
  const cfg = LEVELS[level] || LEVELS.medium;
  writeState(ex, state);
  const r = ex.think(cfg.time, cfg.depth, cfg.noise, cfg.quiesce, seed, analyze ? L.ALTS_MAX : 0);
  if (r < 0) return { move: null, info: null };
  const buf = view(ex);
  const move = decode(state, r);
  if (!move || !analyze) return { move, info: null };
  const info = { depth: buf[L.OUT_DEPTH], nodes: buf[L.OUT_NODES], score: buf[L.OUT_SCORE], noisy: cfg.noise > 0, alts: [], pv: [], turns: null };
  for (let k = 0; k < buf[L.OUT_ALTS_LEN]; k++) {
    const m = decode(state, buf[L.OUT_ALTS + 2 * k]);
    if (m) info.alts.push({ move: m, score: buf[L.OUT_ALTS + 2 * k + 1] });
  }
  // variante prévue, rejouée avec les règles JavaScript (on s'arrête au premier coup illisible)
  let s = state;
  for (let k = 0; k < buf[L.OUT_PV_LEN] && !s.over; k++) {
    const m = decode(s, buf[L.OUT_PV + k]);
    if (!m) break;
    info.pv.push({ move: m, before: s });
    s = applyMove(s, m);
  }
  info.turns = Int8Array.from(buf.subarray(L.OUT_TURNS, L.OUT_TURNS + 600));
  return { move, info };
}
