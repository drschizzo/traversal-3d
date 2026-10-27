// Cycle de vie d'une partie : monde affiché, nouvelle partie, partie restaurée ou chargée, entrée en jeu, abandon
import * as G from '../../core/index.js';
import { TERRAIN_NAMES } from '../i18n/fr.js';
import * as R from '../render/index.js';
import { S, cfg, play, phase, mode, driver, isHuman, gameActive } from './store.js';
import { saveGame, savedGame } from './save.js';
import { bumpGame, gameScope } from './bot.js';
import { nextTurn } from './turns.js';
import { resetCoaching } from './training.js';
import { clearHint } from './hint.js';
import { closeReview } from './review.js';
import * as V from './view.js';

// affiche un monde ; s : position à afficher (partie restaurée), sinon position de départ
function loadWorld(seed = G.randomSeed(), terrain = cfg.terrain, s = null) {
  S.worldSeed = seed;
  S.worldTerrain = terrain;
  const h = s ? s.h : G.generateTerrain(terrain, seed);
  S.state = s || G.newGame(h);
  R.showWorld(h, terrain, S.state);
  S.worldLabel = `Monde n° ${seed.toLocaleString('fr-FR')} · ${TERRAIN_NAMES[terrain]}`;
  V.emit('menu');
}

// nouveau monde tiré au hasard (menu)
export function previewTerrain() {
  bumpGame();
  loadWorld();
}

// remet les pièces au départ sur le monde affiché
export function resetBoard() {
  if (S.state.ply === 0) return;
  S.state = G.newGame(S.state.h);
  R.syncPieces(S.state);
  R.dropPieces(0.1);
}

// reprend la partie locale sauvegardée (save.js) ; false s'il n'y en a pas
export function restoreGame() {
  const g = savedGame();
  if (!g) return false;
  Object.assign(play, g.play);
  Object.assign(cfg, play, { terrain: g.terrain, where: 'local' });
  V.emit('menu');
  installGame(g.seed, g.terrain, g.replay);
  return true;
}

// remet à zéro tout ce qui accompagne une partie (analyse, conseil, lecture, sélection)
function resetMatch() {
  bumpGame();
  closeReview(false);
  S.evalHistory = [];
  S.coachData = null;
  S.paused = false;
  S.stepOnce = false;
  S.viewPly = null;
  S.liveState = null;
  S.analyses.clear();
  resetCoaching();
  clearHint();
  V.clearSelection();
  V.clearPlan();
}

function beginMatch() {
  S.inGame = true;
  V.emit('names');
  V.emit('coachOpen', mode().analyzeAll);
  V.refresh();
}

// installe une partie rejouée (replay de core/) sur son monde, avec les réglages de play
export function installGame(seed, terrain, r) {
  resetMatch();
  if (S.state && seed === S.worldSeed && terrain === S.worldTerrain) { S.state = r.state; R.syncPieces(S.state); }
  else loadWorld(seed, terrain, r.state);
  S.history = r.before.slice();
  S.movesLog = r.before.map((before, k) => ({ before, move: r.legal[k], human: isHuman(before.turn) }));
  beginMatch();
}

// nouvelle partie sur le monde affiché, pièces au départ
function newMatch() {
  resetMatch();
  S.history = [];
  S.movesLog = [];
  resetBoard();
  beginMatch();
}

// lance une nouvelle partie sur le monde affiché, avec les réglages choisis dans le menu
export function startGame() {
  Object.assign(play, { mode: cfg.mode, side: cfg.side, level: cfg.level });
  newMatch();
  saveGame();
  enterGame();
}

// quitte le menu pour la partie : HUD, caméra du côté du joueur, puis premier tour
export function enterGame(delay = R.rising() ? 1900 : 900) {
  S.onScreen = true;
  V.emit('enter');
  R.autoRotate(false);
  S.viewSide = mode().seated ? play.side : 0;
  R.panTo(0, 0, 0.8);
  R.turnCameraTo(S.viewSide, 1.4);
  phase.to('intro');
  V.status(R.rising() ? 'Matérialisation du monde…' : 'La partie commence…', 0);
  const { signal } = gameScope;
  R.wait(delay).then(() => { if (!signal.aborted) nextTurn(); });
}

// abandon de la partie en cours (retour au menu, nouvelle partie, salon quitté)
export function abandonGame() {
  driver()?.leave(gameActive());
  bumpGame();
  if (S.viewPly !== null) { S.state = S.liveState; S.viewPly = null; }
  closeReview(false);
  S.inGame = false;
  phase.to('idle');
  S.paused = false;
  S.history = [];
  S.movesLog = [];
  saveGame();
  clearHint();
  V.clearSelection();
  V.clearPlan();
  S.onScreen = false;
  V.emit('leave');
  R.autoRotate(true);
  V.emit('menu');
}
