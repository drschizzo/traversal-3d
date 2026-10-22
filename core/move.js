// Identité d'un coup. Un coup se transmet (liens, serveur, moteur, sauvegarde) sous sa forme courte { pi, kind, to } ;
// le coup complet (chemin, combat) se retrouve en le cherchant parmi les coups légaux de la position.
import { KINDS } from './constants.js';
import { allMoves, pieceMoves } from './rules.js';

export { KINDS };

/** Forme courte d'un coup, pour l'envoyer ou l'enregistrer. */
export const toWire = m => ({ pi: m.pi, kind: m.kind, to: m.to });

/** Même coup exactement (même case de sortie comprise). */
export const sameWire = (a, b) => !!a && !!b && a.pi === b.pi && a.kind === b.kind && a.to === b.to;
/** Même coup du point de vue du jeu : toutes les sorties d'une pièce se valent. */
export const sameMove = (a, b) => !!a && !!b && a.pi === b.pi && a.kind === b.kind && (a.kind === 'exit' || a.to === b.to);

/** Coup légal correspondant à sa forme courte, ou null. */
export function findMove(s, w) {
  if (s.over || !w) return null;
  return allMoves(s).find(m => sameWire(m, w)) || null;
}

/** Coup légal de la pièce w.pi correspondant au sens du jeu (sortie la moins coûteuse), ou null. */
export function findEquivalent(s, w) {
  if (s.over || !w) return null;
  return pieceMoves(s, w.pi, true).find(m => sameMove(m, w)) || null;
}
