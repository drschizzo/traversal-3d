// Clé d'une position : deux positions de même clé sont identiques pour les règles et pour le moteur
// (sert de clé de cache aux analyses, quelle que soit la façon dont la position a été reconstruite).
export function positionKey(s) {
  let k = `${s.turn}|${s.ply}|${s.score[0]},${s.score[1]}|${s.crossed}|`;
  for (const p of s.pieces) k += `${p.x}${p.y}${p.st}`;
  // le relief distingue deux mondes ; 100 chiffres de 0 à 8
  return k + '|' + s.h.join('');
}
