// Déroulement de la partie : à qui de jouer, coup du bot, coup joué (animé, éventuellement jugé), coup repris
import * as G from '../../core/index.js';
import { PLAYER_NAMES, describeMove } from '../i18n/fr.js';
import * as R from '../render/index.js';
import { explain } from '../coach/explain.js';
import { undoPoint } from './history.js';
import { S, play, phase, mode, isHuman, trainingOn, coachCtx } from './store.js';
import { askBot, analysisFor, bumpGame, tokens } from './bot.js';
import { saveGame } from './game.js';
import { judgeMove, showFeedback, hideFeedback } from './training.js';
import { clearHint } from './hint.js';
import { onlineTurn, sendMove } from './online.js';
import { setStatus, updateHUD, toast } from '../ui/hud.js';
import { updateControls } from '../ui/controls.js';
import { showGameOver } from '../ui/game-over.js';
import { setCoach, renderCoach, clearPlan } from '../ui/coach-panel.js';
import { clearSelection } from '../ui/input.js';

// le tour suivant : fin de partie, joueur humain, pause, ou coup du bot
export async function nextTurn() {
  if (mode().remote && onlineTurn()) return;
  const s = S.state;
  updateHUD();
  updateControls();
  if (s.over) {
    phase.to('over');
    updateControls();
    await R.wait(600);
    showGameOver();
    return;
  }
  if (s.passed) toast(`${PLAYER_NAMES[1 - s.turn]} ne peut pas jouer : tour passé.`);
  if (isHuman(s.turn)) {
    phase.to('human');
    updateControls();
    if (mode().followTurn && S.autoRotateView && S.viewSide !== s.turn) { S.viewSide = s.turn; R.turnCameraTo(S.viewSide); }
    setStatus(mode().remote ? 'À vous de jouer — choisir une pièce' : `À ${PLAYER_NAMES[s.turn]} de jouer — choisir une pièce`, s.turn);
    // entraînement : le bot prépare son jugement pendant que le joueur réfléchit
    if (trainingOn()) analysisFor(s);
    return;
  }
  if (mode().playback && S.paused && !S.stepOnce) {
    phase.to('paused');
    updateControls();
    setStatus(`En pause — à ${PLAYER_NAMES[s.turn]} de jouer · Lecture pour reprendre, ◀ pour revoir`, s.turn);
    return;
  }
  S.stepOnce = false;
  phase.to('bot');
  updateControls();
  setStatus(play.level === 'expert' ? 'Le bot réfléchit en profondeur…' : 'Le bot réfléchit…', s.turn, true);
  const t0 = performance.now();
  const token = tokens.game;
  const { move, info } = await askBot(s);
  if (token !== tokens.game) return;
  if (info && move) {
    S.evalHistory = S.evalHistory.filter(h => h.ply < s.ply);
    S.coachData = explain(s, move, info, { ctx: coachCtx() });
    S.coachLabel = 'Coup du bot';
    S.analyses.set(s.ply, S.coachData);
    S.evalHistory.push({ ply: s.ply, pRed: S.coachData.verdict.pRed });
    renderCoach();
  }
  // laisser le temps de lire l'analyse
  const elapsed = performance.now() - t0;
  if (elapsed < mode().botPause) await R.wait(mode().botPause - elapsed);
  if (token !== tokens.game) return;
  if (!move) return void setStatus('Le bot ne peut pas jouer : son moteur n’a pas pu être chargé.', s.turn);
  await performMove(move);
}

// Joue le coup m. En ligne, le coup du joueur est d'abord envoyé, puis joué quand le serveur le confirme (fromNet).
export async function performMove(m, fromNet = false) {
  if (mode().remote && !fromNet) return sendMove(m);
  const token = tokens.game;
  const hintUsed = S.hintLevel;
  const before = S.state, human = isHuman(before.turn);
  clearHint();
  if (S.coachForHint && human) setCoach(false);
  clearSelection();
  clearPlan();
  // le verdict du coup précédent reste lisible pendant la réponse du bot
  if (human) hideFeedback();
  // entraînement : le jugement du coup se calcule pendant son animation
  const verdict = human && trainingOn() ? judgeMove(before, m) : null;
  S.history.push(before);
  S.movesLog.push({ before, move: m, human, hint: hintUsed });
  S.state = G.applyMove(before, m);
  saveGame();
  setStatus(describeMove(before, m), before.turn);
  phase.to('animating');
  updateControls();
  await R.animateMove(m, before);
  if (token !== tokens.game) return;
  R.syncPieces(S.state);
  if (verdict) {
    phase.to('judging');
    if (!S.state.over) setStatus('Le bot examine votre coup…', before.turn, true);
    const r = await verdict;
    if (token !== tokens.game) return;
    // une erreur ou une gaffe arrête la partie le temps de choisir : reprendre le coup, ou continuer
    if (r && showFeedback(r) && !S.state.over) {
      phase.to('coach');
      updateControls();
      setStatus('Reprenez le coup, ou continuez la partie', before.turn);
      return;
    }
  }
  nextTurn();
}

// reprend le dernier coup du joueur (et la réponse du bot)
export function undo() {
  if (!S.history.length || !mode().undo || !phase.is('human', 'coach')) return;
  const k = undoPoint(S.history, isHuman);
  if (k < 0) return;
  bumpGame();
  hideFeedback();
  S.state = S.history[k];
  S.history.length = k;
  S.movesLog.length = k;
  saveGame();
  S.evalHistory = S.evalHistory.filter(h => h.ply < S.state.ply);
  clearHint();
  clearSelection();
  R.syncPieces(S.state);
  nextTurn();
}
