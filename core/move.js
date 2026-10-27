// Identité d'un coup. Un coup se transmet (liens, serveur, moteur, sauvegarde) sous sa forme courte { pi, kind, to } ;
// le coup complet (chemin, combat) se retrouve en le cherchant parmi les coups légaux de la position.
import { KINDS } from './constants.js';
import { allMoves, pieceMoves } from './rules.js';

export { KINDS };

/** @import { Kind } from './constants.js' */
/** @import { State } from './rules.js' */
/**
 * @typedef {{ pi: number, kind: Kind, to: number }} WireMove forme courte d'un coup
 * @typedef {{ seed: number, terrain: string, moves: WireMove[] }} Match une partie, telle qu'on la transmet
 */

/** Forme courte d'un coup, pour l'envoyer ou l'enregistrer. */
/** @type {(m: WireMove) => WireMove} */
export const toWire = m => ({ pi: m.pi, kind: m.kind, to: m.to });

/** Même coup exactement (même case de sortie comprise). */
/** @type {(a: WireMove | null | undefined, b: WireMove | null | undefined) => boolean} */
export const sameWire = (a, b) => !!a && !!b && a.pi === b.pi && a.kind === b.kind && a.to === b.to;
/** Même coup du point de vue du jeu : toutes les sorties d'une pièce se valent. */
/** @type {(a: WireMove | null | undefined, b: WireMove | null | undefined) => boolean} */
export const sameMove = (a, b) => !!a && !!b && a.pi === b.pi && a.kind === b.kind && (a.kind === 'exit' || a.to === b.to);

/** Coup légal correspondant à sa forme courte, ou null. @param {State} s @param {WireMove | null | undefined} w */
export function findMove(s, w) {
  if (s.over || !w) return null;
  return allMoves(s).find(m => sameWire(m, w)) || null;
}

/** Coup légal de la pièce w.pi correspondant au sens du jeu (sortie la moins coûteuse), ou null. @param {State} s @param {WireMove | null | undefined} w */
export function findEquivalent(s, w) {
  if (s.over || !w) return null;
  return pieceMoves(s, w.pi, true).find(m => sameMove(m, w)) || null;
}
