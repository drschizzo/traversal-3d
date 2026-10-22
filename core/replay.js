// Rejeu d'une partie depuis sa description { seed, terrain, moves } : liens, sauvegarde, serveur, parties en ligne.
import { generateTerrain } from './terrain.js';
import { newGame, applyMove } from './rules.js';
import { findMove } from './move.js';

export const startPosition = (terrain, seed) => newGame(generateTerrain(terrain, seed >>> 0));

// Renvoie les positions avant chaque coup, les coups légaux correspondants (objets complets de allMoves)
// et la position finale ; null au premier coup illégal.
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
