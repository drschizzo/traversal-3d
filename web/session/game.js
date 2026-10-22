// Cycle de vie d'une partie : monde affiché, nouvelle partie, partie restaurée ou chargée, entrée en jeu, abandon,
// et sauvegarde de la partie locale en cours (pour la reprendre après un rechargement)
import * as G from '../../core/index.js';
import { TERRAIN_NAMES } from '../i18n/fr.js';
import * as R from '../render/index.js';
import { isLevel } from '../bot/levels.js';
import { load, save } from '../storage.js';
import { MODES } from './modes.js';
import { wireMoves } from './history.js';
import { S, cfg, play, phase, mode, isHuman, gameActive } from './store.js';
import { bumpGame, tokens } from './bot.js';
import { nextTurn } from './turns.js';
import { resetCoaching } from './training.js';
import { clearHint } from './hint.js';
import { closeReview } from './review.js';
import { leaveRoom } from './online.js';
import { $ } from '../ui/dom.js';
import { setNames, setStatus, layoutHud, setTools } from '../ui/hud.js';
import { updateControls } from '../ui/controls.js';
import { setCoach, clearPlan } from '../ui/coach-panel.js';
import { clearSelection } from '../ui/input.js';
import { updateMenuButtons, syncMenuChoices, updateMenuShift } from '../ui/menu.js';

// affiche un monde ; s : position à afficher (partie restaurée), sinon position de départ
function loadWorld(seed = G.randomSeed(), terrain = cfg.terrain, s = null) {
  S.worldSeed = seed;
  S.worldTerrain = terrain;
  const h = s ? s.h : G.generateTerrain(terrain, seed);
  S.state = s || G.newGame(h);
  R.showWorld(h, terrain, S.state);
  const terrainName = TERRAIN_NAMES[terrain];
  S.worldLabel = `Monde n° ${seed.toLocaleString('fr-FR')} · ${terrainName}`;
  $('menuWorld').textContent = `Monde n° ${seed.toLocaleString('fr-FR')}`;
  $('menuTerrain').textContent = terrainName;
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

// ---------------------------------------------------------------- sauvegarde de la partie en cours
export function saveGame() {
  if (!mode().local) return; // la partie en ligne est gardée par le serveur (session dans net.js)
  if (!gameActive()) return save('game', null);
  save('game', { v: 1, seed: S.worldSeed, terrain: S.worldTerrain, play, moves: wireMoves(S.movesLog) });
}

// rejoue les coups sauvegardés sur le monde reconstruit à partir de sa graine ; false si la sauvegarde est inutilisable
export function restoreGame() {
  const d = load('game');
  if (!d || !G.isTerrain(d.terrain)) return false;
  if (!MODES[d.play?.mode]?.local || ![0, 1].includes(d.play.side) || !isLevel(d.play.level)) return false;
  const r = G.replay(d.seed >>> 0, d.terrain, d.moves);
  if (!r) { save('game', null); return false; }
  if (r.state.over) return false;
  Object.assign(play, d.play);
  Object.assign(cfg, play, { terrain: d.terrain, where: 'local' });
  syncMenuChoices();
  installGame(d.seed >>> 0, d.terrain, r);
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
  clearSelection();
  clearPlan();
}

function beginMatch() {
  S.inGame = true;
  setNames();
  setCoach(mode().analyzeAll);
  updateControls();
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
  $('menu').classList.add('hidden');
  updateMenuShift();
  $('hud').classList.remove('hidden');
  layoutHud();
  R.autoRotate(false);
  S.viewSide = mode().seated ? play.side : 0;
  R.panTo(0, 0, 0.8);
  R.turnCameraTo(S.viewSide, 1.4);
  phase.to('intro');
  setStatus(R.rising() ? 'Matérialisation du monde…' : 'La partie commence…', 0);
  const token = tokens.game;
  R.wait(delay).then(() => { if (token === tokens.game) nextTurn(); });
}

// abandon de la partie en cours (retour au menu, nouvelle partie, salon quitté)
export function abandonGame() {
  if (mode().remote) leaveRoom(gameActive());
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
  clearSelection();
  clearPlan();
  setTools(false);
  $('hud').classList.add('hidden');
  R.autoRotate(true);
  updateMenuButtons();
}
