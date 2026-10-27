// Verdict du coup qui vient d'être joué (mode Entraînement) : une ligne sous le plateau, dépliable.
// Ce qu'il contient est dans S.feedback (session/training.js) ; ici, sa mise en page et ses boutons.
import { isError } from '../coach/review.js';
import { S } from '../session/store.js';
import { feedbackBlocks, hideFeedback } from '../session/training.js';
import { feedbackAction } from '../session/turns.js';
import { $ } from './dom.js';
import { bindMoveChips } from './coach-panel.js';
import { moveRegistry } from './coach-view.js';
import { renderFeedback } from './review-view.js';

// un bon coup s'affiche un instant ; une faute reste jusqu'au coup suivant
let timer = 0;

export function showFeedbackPanel() {
  const el = $('feedback'), r = S.feedback;
  clearTimeout(timer);
  if (!r) return void el.classList.add('hidden');
  if (!isError(r)) timer = setTimeout(hideFeedback, 2600);
  const reg = moveRegistry();
  el.innerHTML = renderFeedback(r, reg, { open: S.feedbackOpen, blocking: feedbackBlocks() });
  el.classList.toggle('open', S.feedbackOpen);
  el.classList.remove('hidden');
  bindMoveChips(el, reg.list);
  el.querySelectorAll('[data-fb]').forEach(b => { /** @type {HTMLElement} */ (b).onclick = () => feedbackAction(/** @type {HTMLElement} */ (b).dataset.fb); });
}
