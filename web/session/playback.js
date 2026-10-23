// Bot contre bot : lecture automatique, pause, coup par coup, et navigation dans les coups déjà joués
// (S.viewPly : position passée affichée, null = en direct). Les boutons sont câblés par ui/controls.js.
import { PLAYER_NAMES, endReason } from '../i18n/fr.js';
import * as R from '../render/index.js';
import { clampPly } from './history.js';
import { S, phase, mode } from './store.js';
import { bumpGame } from './bot.js';
import { nextTurn } from './turns.js';
import * as V from './view.js';
import { GOLD } from '../colors.js';

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
  V.clearSelection();
  R.syncPieces(s);
  V.clearPlan();
  const last = k > 0 ? S.movesLog[k - 1] : null;
  if (last) V.showPlan([{ move: last.move, side: last.before.turn, color: GOLD }]);
  S.coachData = last ? S.analyses.get(last.before.ply) || null : null;
  S.coachLabel = S.viewPly === null ? 'Dernier coup' : `Coup ${k} sur ${n}`;
  V.emit('coach');
  if (S.viewPly !== null) V.status(`Revue — position après le coup ${k} sur ${n} · ◀ ▶ pour naviguer`, s.turn);
  else if (s.over) V.status(`Partie terminée — ${endReason(s)}`, s.winner === 1 ? 1 : 0);
  else V.status(`En pause — à ${PLAYER_NAMES[s.turn]} de jouer · Lecture pour reprendre`, s.turn);
  V.refresh();
}

// coup suivant : déjà joué (navigation), ou, au présent et en pause, le bot joue un coup
export function stepForward() {
  if (S.viewPly !== null) return goTo(S.viewPly + 1);
  if (!S.paused || phase.busy() || !S.state || S.state.over) return;
  S.stepOnce = true;
  nextTurn();
}

export function togglePlay() {
  if (S.viewPly !== null) {
    if (!canNavigate()) return;
    S.viewPly = null;
    S.state = S.liveState;
    showViewed();
    if (S.state.over) return;
    S.paused = false;
    V.refresh();
    return void nextTurn();
  }
  S.paused = !S.paused;
  V.refresh();
  if (!S.paused && !phase.busy() && S.state && !S.state.over) nextTurn();
}
