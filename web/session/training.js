// Mode Entraînement : chaque coup du joueur est jugé aussitôt (préférence gardée d'une partie à l'autre).
// Après une erreur ou une gaffe, la partie attend (phase coach) : voir pourquoi, reprendre le coup ou continuer.
// Le verdict est tenu dans S.feedback ; sa mise en page est dans ui/feedback.js. Ce qui relance la partie (continuer,
// reprendre le coup, couper l'entraînement) est dans turns.js.
import { reviewMove } from '../coach/review.js';
import { S, coachCtx } from './store.js';
import { analysisFor, reviewAnalysis, gameScope } from './bot.js';
import * as V from './view.js';

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
