// Historique d'une partie : positions avant chaque coup (history) et coups joués (log), toujours de même longueur.
// Fonctions pures, testées dans tests/session.test.js.

/**
 * Coup repris : on revient au dernier tour d'un humain avant la position actuelle (le coup du joueur et la réponse
 * du bot sont repris ensemble). Renvoie le nombre de coups à garder, ou −1 s'il n'y a rien à reprendre.
 * @param {any[]} history positions avant chaque coup
 * @param {(turn: number) => boolean} isHuman
 */
export function undoPoint(history, isHuman) {
  for (let k = history.length - 1; k >= 0; k--) if (isHuman(history[k].turn)) return k;
  return history.length ? 0 : -1;
}

/** Indice de position borné à la partie : 0 (départ) … n (position actuelle). */
export const clampPly = (k, n) => Math.max(0, Math.min(n, k));

/** Forme courte des coups joués, pour la sauvegarde et les liens. */
export const wireMoves = log => log.map(({ move: m }) => ({ pi: m.pi, kind: m.kind, to: m.to }));
