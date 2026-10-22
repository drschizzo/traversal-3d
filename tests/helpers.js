// Positions construites à la main pour les tests de règles
import { NC, ON_BOARD, CAPTURED, EXPLORER, newGame, idx } from '../core/index.js';

export const flat = (h = 0) => new Int8Array(NC).fill(h);

// pieces : [{ t, o, x, y, st? }] ; les pièces non listées sont absentes du plateau (capturées)
export function position({ h = flat(), pieces, turn = 0, ...rest }) {
  const s = newGame(h);
  s.cell.fill(-1);
  s.pieces = pieces.map(p => ({ st: ON_BOARD, ...p }));
  s.pieces.forEach((p, pi) => { if (p.st === ON_BOARD) s.cell[idx(p.x, p.y)] = pi; });
  return { ...s, turn, ...rest };
}

export const targets = (moves, kind) => moves.filter(m => m.kind === kind).map(m => m.to).sort((a, b) => a - b);

// Position complète pour le moteur, qui attend toujours 12 pièces : Rouge aux indices 0-5, Bleu aux indices 6-11,
// les places libres étant occupées par des pièces capturées
export function fullPosition({ pieces, ...rest }) {
  const slots = [];
  for (const o of [0, 1]) {
    const mine = pieces.filter(p => p.o === o);
    for (let k = 0; k < 6; k++) slots.push(mine[k] ?? { t: EXPLORER, o, x: 0, y: 0, st: CAPTURED });
  }
  return position({ pieces: slots, ...rest });
}
