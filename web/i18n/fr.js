// Textes du jeu en français. Le cœur (core/) ne produit que des codes : ils prennent ici leur forme lisible.
import { END, TIEBREAK, MAX_PLIES, STR, REJECT, ERROR } from '../../core/index.js';

export const TYPE_NAMES = ['Explorateur', 'Avant-garde', 'Sentinelle'];
export const TYPE_GLYPHS = ['⬟', '◆', '▲'];
export const TYPE_DESC = [
  'Au lieu de son déplacement normal : 1 case en diagonale, ou bond de 2 cases en ligne droite, sans coût de hauteur.',
  '+1 en attaque si le plus court chemin vers la cible coûte exactement 4 points de Mouvement.',
  'Si elle est la toute première pièce à franchir l’arrivée, son joueur gagne immédiatement.',
];
export const PLAYER_NAMES = ['Rouge', 'Bleu'];

export const LEVEL_NAMES = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile', expert: 'Expert' };

export const TERRAIN_NAMES = {
  random: 'Aléatoire', mountains: 'Montagnes', valleys: 'Vallées', highlands: 'Hautes terres', woods: 'Bois', desert: 'Désert',
};

const END_TEXT = {
  [END.SENTINEL]: 'Une Sentinelle a franchi l’arrivée en premier',
  [END.TWO]: 'Deux pièces ont franchi l’arrivée',
  [END.PLIES]: `Limite de ${MAX_PLIES} coups atteinte`,
  [END.STUCK]: 'Plus aucun coup possible',
};
const TIEBREAK_TEXT = {
  [TIEBREAK.CLOSEST]: 'pièce la plus proche de l’arrivée',
  [TIEBREAK.STRONGEST]: 'pièce la plus forte',
};

/** Raison de la fin d'une partie, en une phrase (sans point final). */
export function endReason({ reason, tiebreak, resigned }) {
  if (reason === END.RESIGN) return `${PLAYER_NAMES[resigned] ?? 'Un joueur'} a abandonné`;
  // un résultat enregistré par une ancienne version du serveur porte déjà son texte
  const text = END_TEXT[reason] ?? reason ?? '';
  return tiebreak ? `${text} — ${TIEBREAK_TEXT[tiebreak]}` : text;
}

/** Coup joué, pour le message d'état : « Rouge : Sentinelle capture Explorateur (4 ≥ 2) ». */
export function describeMove(s, m) {
  const p = s.pieces[m.pi], who = PLAYER_NAMES[p.o], name = TYPE_NAMES[p.t];
  if (m.kind === 'exit') return `${who} : ${name} franchit l’arrivée ! +${STR[p.t]}`;
  if (m.kind === 'attack') return `${who} : ${name} capture ${TYPE_NAMES[s.pieces[s.cell[m.to]].t]} (${m.combat.att} ≥ ${m.combat.def})`;
  return `${who} : ${name} se déplace`;
}

// ---------------------------------------------------------------- parties en ligne : codes du serveur (core/protocol.js)
const REJECT_TEXT = {
  [REJECT.OVER]: 'La partie est terminée.',
  [REJECT.DESYNC]: 'Coup désynchronisé.',
  [REJECT.NOT_YOUR_TURN]: 'Ce n’est pas votre tour.',
  [REJECT.ILLEGAL]: 'Coup illégal.',
};
const ERROR_TEXT = {
  [ERROR.NOT_FOUND]: 'Ce salon n’existe pas ou a expiré.',
  [ERROR.FULL]: 'Ce salon est complet.',
  [ERROR.VERSION]: 'Une nouvelle version du jeu est disponible : rechargez la page.',
  [ERROR.RATE]: 'Trop de salons créés, réessayez dans une minute.',
  [ERROR.UNAVAILABLE]: 'Impossible de créer un salon.',
  [ERROR.BAD_CODE]: 'Code de salon invalide.',
};
export const rejectText = code => REJECT_TEXT[code] ?? 'Coup refusé.';
export const errorText = code => ERROR_TEXT[code] ?? 'Serveur indisponible.';
