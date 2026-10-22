// Niveaux du bot : temps de réflexion (ms), profondeur maximale, bruit ajouté aux évaluations, recherche de calme
export const LEVELS = {
  easy: { time: 400, depth: 1, noise: 40, quiesce: 0 },
  medium: { time: 700, depth: 3, noise: 10, quiesce: 1 },
  hard: { time: 2500, depth: 64, noise: 0, quiesce: 1 },
  expert: { time: 8000, depth: 64, noise: 0, quiesce: 1 },
  review: { time: 800, depth: 64, noise: 0, quiesce: 1 }, // jugement des coups (entraînement, analyse de partie)
};
const PLAYABLE_LEVELS = ['easy', 'medium', 'hard', 'expert'];
export const isLevel = l => PLAYABLE_LEVELS.includes(l);
// niveau des analyses demandées par le joueur (conseil, entraînement) : jamais moins fort que difficile
export const coachLevel = level => (level === 'expert' ? 'expert' : 'hard');
