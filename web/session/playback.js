// Bot contre bot : lecture automatique, pause, coup par coup, et navigation dans les coups déjà joués
// (S.viewPly : position passée affichée, null = en direct)
import { PLAYER_NAMES, endReason } from '../i18n/fr.js';
import * as R from '../render/index.js';
import { clampPly } from './history.js';
import { S, phase, mode } from './store.js';
import { bumpGame } from './bot.js';
import { nextTurn } from './turns.js';
import { $ } from '../ui/dom.js';
import { setStatus, updateHUD } from '../ui/hud.js';
import { updateControls } from '../ui/controls.js';
import { renderCoach, showPlan, clearPlan } from '../ui/coach-panel.js';
import { clearSelection } from '../ui/input.js';
import { GOLD } from '../ui/colors.js';

export const viewIndex = () => S.viewPly ?? S.history.length;
// navigation possible : bot contre bot, hors analyse de partie et hors animation d'un coup
export const canNavigate = () => mode().playback && !phase.is('review', 'puzzle', 'animating') && !!S.state;

// affiche la position après k coups (k = nombre de coups joués : retour au présent)
export function goTo(k) {
  if (!canNavigate()) return;
  const n = S.history.length;
  k = clampPly(k, n);
  if (S.viewPly === null) {
    if (k === n) return;
    // on quitte le direct : pause, et le coup en cours de calcul ou d'affichage est abandonné (il sera recalculé)
    S.liveState = S.state;
    bumpGame();
    phase.to('paused');
    S.paused = true;
  }
  if (k === n) { S.viewPly = null; S.state = S.liveState; } else { S.viewPly = k; S.state = S.history[k]; }
  showViewed();
}

function showViewed() {
  const k = viewIndex(), n = S.history.length, s = S.state;
  clearSelection();
  R.syncPieces(s);
  updateHUD();
  clearPlan();
  const last = k > 0 ? S.movesLog[k - 1] : null;
  if (last) showPlan([{ move: last.move, side: last.before.turn, color: GOLD }]);
  S.coachData = last ? S.analyses.get(last.before.ply) || null : null;
  S.coachLabel = S.viewPly === null ? 'Dernier coup' : `Coup ${k} sur ${n}`;
  renderCoach();
  if (S.viewPly !== null) setStatus(`Revue — position après le coup ${k} sur ${n} · ◀ ▶ pour naviguer`, s.turn);
  else if (s.over) setStatus(`Partie terminée — ${endReason(s)}`, s.winner === 1 ? 1 : 0);
  else setStatus(`En pause — à ${PLAYER_NAMES[s.turn]} de jouer · Lecture pour reprendre`, s.turn);
  updateControls();
}

// coup suivant : déjà joué (navigation), ou, au présent et en pause, le bot joue un coup
export function stepForward() {
  if (S.viewPly !== null) return goTo(S.viewPly + 1);
  if (!S.paused || phase.busy() || !S.state || S.state.over) return;
  S.stepOnce = true;
  nextTurn();
}

function togglePlay() {
  if (S.viewPly !== null) {
    if (!canNavigate()) return;
    S.viewPly = null;
    S.state = S.liveState;
    showViewed();
    if (S.state.over) return;
    S.paused = false;
    updateControls();
    return void nextTurn();
  }
  S.paused = !S.paused;
  updateControls();
  if (!S.paused && !phase.busy() && S.state && !S.state.over) nextTurn();
}

export function initPlayback() {
  $('btnFirst').onclick = () => goTo(0);
  $('btnPrev').onclick = () => goTo(viewIndex() - 1);
  $('btnLast').onclick = () => goTo(S.history.length);
  $('btnNext').onclick = stepForward;
  $('btnPlay').onclick = togglePlay;
}
