// Rejeu d'une partie depuis sa description { seed, terrain, moves } : liens, sauvegarde, serveur, parties en ligne.
import { generateTerrain } from './terrain.js';
import { newGame, applyMove } from './rules.js';
import { findMove } from './move.js';

/** @type {(terrain: string, seed: number) => import('./rules.js').State} */
export const startPosition = (terrain, seed) => newGame(generateTerrain(terrain, seed >>> 0));

// Renvoie les positions avant chaque coup, les coups légaux correspondants (objets complets de allMoves)
// et la position finale ; null au premier coup illégal.
/** @param {number} seed @param {string} terrain @param {import('./move.js').WireMove[]} moves */
export function replay(seed, terrain, moves) {
  let s = startPosition(terrain, seed);
  const before = [], legal = [];
  for (const w of moves) {
    const m = findMove(s, w);
    if (!m) return null;
    before.push(s);
    legal.push(m);
    s = applyMove(s, m);
  }
  return { before, legal, state: s };
}
