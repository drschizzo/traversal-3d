// Traversal — constantes des règles, partagées par le jeu, le serveur et les tests (aucun texte : voir web/i18n)

export const N = 10;
export const NC = N * N;

// types de pièce : indices de MOVE et STR
export const EXPLORER = 0, VANGUARD = 1, SENTINEL = 2;
export const MOVE = [5, 4, 3];
export const STR = [1, 2, 3];

// statut d'une pièce
export const ON_BOARD = 0, CAPTURED = 1, SCORED = 2;

export const MAX_PLIES = 200;
// winner : camp gagnant (0 Rouge, 1 Bleu), DRAW pour un nul, −1 tant que la partie continue
export const DRAW = 2;

// types de coup ; l'indice sert au codage compact (liens de partie, serveur, moteur)
/** @typedef {'move' | 'attack' | 'exit'} Kind */
/** @type {Kind[]} */
export const KINDS = ['move', 'attack', 'exit'];

// raisons de fin de partie, dans l'ordre des codes du moteur Rust (R_SENTINEL = 1…)
export const END = { SENTINEL: 'sentinel', TWO: 'two', PLIES: 'plies', STUCK: 'stuck', RESIGN: 'resign' };
// départage quand aucun camp n'a marqué : pièce la plus proche de l'arrivée, puis la plus forte
export const TIEBREAK = { CLOSEST: 'closest', STRONGEST: 'strongest' };

// modes de terrain, dans l'ordre du codage compact (indice sur 4 bits)
export const TERRAINS = ['random', 'mountains', 'valleys', 'highlands', 'woods', 'desert'];

// évaluation d'une victoire forcée (moteur) : WIN − ply ; au-delà de WIN − 1000, la partie est jouée d'avance
export const WIN = 100000;
export const isMateScore = (/** @type {number} */ score) => Math.abs(score) >= WIN - 1000;
