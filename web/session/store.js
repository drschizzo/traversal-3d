// État de la session de jeu, partagé par les modules de session/ et ui/ : réglages, partie en cours, vue,
// sélection, analyse. Un seul objet (S) plutôt que des dizaines de variables : on voit d'un coup d'œil
// tout ce qui fait l'état de l'interface, et qui le modifie (rechercher « S.nom »).
import { createPhase } from './phase.js';
import { MODES, isHuman as humanAt, viewerSide } from './modes.js';
import { load } from '../storage.js';

// cfg : choix du menu ; play : réglages de la partie en cours, figés à son lancement.
// cfg.where : partie à deux sur cet écran ('local'), ou en ligne en créant ('create') ou rejoignant ('join') un salon.
// play.mode : 'bot', 'pvp', 'bvb' ou 'online' (voir modes.js) ; play.side : couleur du joueur s'il en a une.
export const cfg = { mode: 'bot', side: 0, level: 'medium', terrain: 'random', where: 'local' };
export const play = { mode: 'bot', side: 0, level: 'medium' };

// ce que la partie attend (voir phase.js)
export const phase = createPhase();

export const S = {
  // ---------------------------------------------------------------- monde et partie
  state: null,            // position affichée
  history: [],            // positions avant chaque coup joué
  movesLog: [],           // coups joués : { before, move, human, hint } (même longueur que history)
  worldSeed: 0, worldTerrain: 'random', worldLabel: '',
  inGame: false,          // une partie a été lancée (ou restaurée) sur le monde affiché et n'a pas été abandonnée
  onScreen: false,        // l'écran de jeu est affiché (on est entré dans la partie, menu ou non par-dessus)
  // ---------------------------------------------------------------- bot contre bot
  paused: false,          // lecture en pause (après le coup en cours)
  stepOnce: false,        // en pause : un seul coup demandé
  viewPly: null,          // position passée affichée (null : en direct)
  liveState: null,        // position en direct pendant qu'on revoit une position passée
  // ---------------------------------------------------------------- vue
  viewSide: 0,            // camp du côté duquel regarde la caméra
  autoRotateView: true,   // à deux sur cet écran, la caméra passe du côté du camp qui joue
  showHeights: false,
  // ---------------------------------------------------------------- sélection
  selected: -1, selMoves: [],
  previewing: false,      // pièce adverse sélectionnée : ses coups sont montrés, pas jouables
  lastPointer: 'mouse',
  // ---------------------------------------------------------------- panneau d'analyse et conseil
  coachOn: false,
  coachData: null, coachLabel: '', // explication affichée (dernier coup du bot, coup revu…)
  coachForHint: false,    // le panneau a été ouvert par « Conseil » : il se referme une fois le coup joué
  evalHistory: [],        // chances de Rouge au fil de la partie : { ply, pRed }
  analyses: new Map(),    // explication de chaque coup du bot, par ply (bot contre bot)
  planShown: false,       // suite prévue tracée sur le plateau
  hintLevel: 0,           // conseil en trois temps : 0 aucun, 1 piste, 2 pièce, 3 coup
  hintData: null, hintMove: null, hintPending: false, hintFailed: false,
  pinnedMove: null,       // coup cité gardé tracé sur le plateau
  // ---------------------------------------------------------------- entraînement et analyse de partie
  training: /** @type {boolean} */ (load('training')),
  feedback: null,         // verdict du dernier coup du joueur, affiché sous le plateau (mode Entraînement)
  feedbackOpen: false,    // son détail est déplié
  liveReviews: new Map(), // coups déjà jugés pendant la partie, par position
  review: { items: [], sel: -1, final: null, failed: false }, // analyse de fin de partie : coups jugés,
                          // moment choisi, position finale, moteur indisponible
  puzzle: null,           // exercice en cours (analyse de partie)
};

export const mode = () => MODES[play.mode];
export const isHuman = t => humanAt(play, t);
export const liveNow = () => (S.viewPly === null ? S.state : S.liveState);
export const gameActive = () => S.inGame && !!S.state && !liveNow().over;
// une partie entamée (au moins un coup joué) serait perdue
export const gameAtStake = () => gameActive() && S.history.length > 0;
export const trainingOn = () => S.training && mode().training;
// pièces nommées pour le joueur (« votre Sentinelle », « l’Avant-garde adverse »), gauche et droite vues de son côté ;
// à deux sur cet écran, on s'adresse au camp qui joue (conseil, entraînement) ou on nomme les couleurs
export const coachCtx = (me = viewerSide(play)) => ({ view: S.viewSide, me });
