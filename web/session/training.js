// Mode Entraînement : chaque coup du joueur est jugé aussitôt (préférence gardée d'une partie à l'autre).
// Après une erreur ou une gaffe, la partie attend (phase coach) : voir pourquoi, reprendre le coup ou continuer.
import { reviewMove, isError } from '../coach/review.js';
import { save } from '../storage.js';
import { S, phase, isHuman, coachCtx } from './store.js';
import { analysisFor, reviewAnalysis, gameSignal, bumpGame } from './bot.js';
import { nextTurn, undo } from './turns.js';
import { $ } from '../ui/dom.js';
import { toast } from '../ui/hud.js';
import { updateControls } from '../ui/controls.js';
import { bindMoveChips, showPlan, clearPlan } from '../ui/coach-panel.js';
import { moveRegistry } from '../ui/coach-view.js';
import { renderFeedback } from '../ui/review-view.js';
import { BEST, PLAYED } from '../ui/colors.js';

// verdict affiché après un coup du joueur ; open : détail déplié ; blocking : la partie attend une décision
let feedback = null, feedbackOpen = false, feedbackBlocking = false, feedbackTimer = 0;

// jugement d'un coup du joueur, gardé pour l'analyse de fin de partie
export function judgeMove(before, m) {
  const think = s => (s === before ? analysisFor(s) : reviewAnalysis(s, gameSignal()));
  return reviewMove(think, before, m, coachCtx(before.turn))
    .then(r => { if (r) S.liveReviews.set(before, r); return r; }, () => null);
}

export function resetCoaching() {
  S.liveReviews.clear();
  hideFeedback();
}

// affiche le verdict ; renvoie true si la partie doit attendre la décision du joueur
export function showFeedback(r) {
  feedback = r;
  feedbackOpen = false;
  feedbackBlocking = ['mistake', 'blunder'].includes(r.grade);
  clearTimeout(feedbackTimer);
  // un bon coup s'affiche un instant ; une faute reste jusqu'au coup suivant
  if (!isError(r)) feedbackTimer = setTimeout(hideFeedback, 2600);
  renderFeedbackPanel();
  return feedbackBlocking;
}
function renderFeedbackPanel() {
  const el = $('feedback');
  if (!feedback) return void el.classList.add('hidden');
  const reg = moveRegistry();
  el.innerHTML = renderFeedback(feedback, reg, { open: feedbackOpen, blocking: feedbackBlocking });
  el.classList.toggle('open', feedbackOpen);
  el.classList.remove('hidden');
  bindMoveChips(el, reg.list);
  el.querySelectorAll('[data-fb]').forEach(b => { /** @type {HTMLElement} */ (b).onclick = () => onFeedback(/** @type {HTMLElement} */ (b).dataset.fb); });
}
export function hideFeedback() {
  if (feedbackOpen) clearPlan();
  feedback = null;
  feedbackOpen = false;
  clearTimeout(feedbackTimer);
  $('feedback').classList.add('hidden');
}
function onFeedback(action) {
  const r = feedback;
  if (!r) return;
  if (action === 'why') {
    feedbackOpen = true;
    renderFeedbackPanel();
    showPlan([{ move: r.best, side: r.side, color: BEST }, { move: r.move, side: r.side, color: PLAYED }]);
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
  toast(S.training ? 'Entraînement : chacun de vos coups est jugé aussitôt, et une faute peut être reprise.' : 'Entraînement désactivé.');
  if (!S.training) {
    hideFeedback();
    if (phase.is('coach')) nextTurn();
  } else if (S.state && !S.state.over && isHuman(S.state.turn) && phase.is('human')) analysisFor(S.state);
  updateControls();
}
