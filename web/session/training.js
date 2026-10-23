// Mode Entraînement : chaque coup du joueur est jugé aussitôt (préférence gardée d'une partie à l'autre).
// Après une erreur ou une gaffe, la partie attend (phase coach) : voir pourquoi, reprendre le coup ou continuer.
// Le verdict est tenu dans S.feedback ; sa mise en page est dans ui/feedback.js.
import { reviewMove } from '../coach/review.js';
import { save } from '../storage.js';
import { S, phase, isHuman, coachCtx } from './store.js';
import { analysisFor, reviewAnalysis, gameScope, bumpGame } from './bot.js';
import { nextTurn, undo } from './turns.js';
import * as V from './view.js';
import { BEST, PLAYED } from '../colors.js';

// jugement d'un coup du joueur, gardé pour l'analyse de fin de partie
export function judgeMove(before, m) {
  const think = s => (s === before ? analysisFor(s) : reviewAnalysis(s, gameScope.signal));
  return reviewMove(think, before, m, coachCtx(before.turn))
    .then(r => { if (r) S.liveReviews.set(before, r); return r; }, () => null);
}

export function resetCoaching() {
  S.liveReviews.clear();
  hideFeedback();
}

/** La partie doit-elle attendre une décision du joueur ? (erreur ou gaffe) */
export const feedbackBlocks = () => !!S.feedback && ['mistake', 'blunder'].includes(S.feedback.grade);

// montre le verdict ; renvoie true si la partie doit attendre la décision du joueur
export function showFeedback(r) {
  S.feedback = r;
  S.feedbackOpen = false;
  V.emit('feedback');
  return feedbackBlocks();
}

export function hideFeedback() {
  if (S.feedbackOpen) V.clearPlan();
  S.feedback = null;
  S.feedbackOpen = false;
  V.emit('feedback');
}

/** « Pourquoi ? », « Continuer » ou « Reprendre le coup » sous le verdict. */
export function feedbackAction(action) {
  const r = S.feedback;
  if (!r) return;
  if (action === 'why') {
    S.feedbackOpen = true;
    V.emit('feedback');
    V.showPlan([{ move: r.best, side: r.side, color: BEST }, { move: r.move, side: r.side, color: PLAYED }]);
  } else if (action === 'go') {
    const waiting = phase.is('coach');
    hideFeedback();
    if (waiting) nextTurn();
  } else if (action === 'undo') {
    if (phase.is('animating', 'judging')) return;
    // le bot réfléchit déjà à sa réponse : elle est abandonnée
    if (phase.is('bot')) { bumpGame(); phase.to('human'); }
    hideFeedback();
    undo();
  }
}

export function toggleTraining() {
  S.training = !S.training;
  save('training', S.training);
  V.toast(S.training ? 'Entraînement : chacun de vos coups est jugé aussitôt, et une faute peut être reprise.' : 'Entraînement désactivé.');
  if (!S.training) {
    hideFeedback();
    if (phase.is('coach')) nextTurn();
  } else if (S.state && !S.state.over && isHuman(S.state.turn) && phase.is('human')) analysisFor(S.state);
  V.refresh();
}
