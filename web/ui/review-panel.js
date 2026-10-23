// Écran d'analyse de fin de partie : bilan, courbe, moments clés, détail d'une faute, exercice, liste des coups.
// Tout ce qu'il affiche vient de S.review et S.puzzle (session/review.js) ; ses boutons rappellent la session.
import { progressStats } from '../coach/progress.js';
import { load } from '../storage.js';
import { S, phase } from '../session/store.js';
import {
  closeReview, selectReview, playLine, startPuzzle, puzzleAction,
  reviewNav, reviewKeys, reviewSides, sideNames, hintsUsed,
} from '../session/review.js';
import { $ } from './dom.js';
import { bindMoveChips } from './coach-panel.js';
import { moveRegistry } from './coach-view.js';
import { renderSummary, renderLessons, renderGraph, renderKeyMoments, renderList, renderDetail, renderPuzzle, renderTrend } from './review-view.js';
import { updateMenuShift } from './menu.js';

// la liste de tous les coups reste dépliée (ou repliée) d'un affichage à l'autre : état de la vue seule
let listOpen = false;

/** Ouvre l'écran (open ≠ false), ou le referme. */
export function showReviewPanel(open) {
  if (open === false) {
    $('review').classList.add('hidden');
    $('legend').classList.remove('hidden');
    updateMenuShift();
    return;
  }
  $('over').classList.add('hidden');
  $('legend').classList.add('hidden');
  $('review').classList.remove('hidden');
  renderReviewPanel();
  updateMenuShift();
}

function renderReviewPanel() {
  if (!phase.is('review', 'puzzle')) return;
  const { items, sel, final, failed } = S.review;
  const done = items.filter(Boolean).length, total = items.length;
  const sides = reviewSides(), keys = reviewKeys();
  const r = sel >= 0 ? items[sel] : null;
  const reg = moveRegistry();
  const finished = done === total && !failed;
  let detail = '';
  if (S.puzzle) detail = renderPuzzle(S.puzzle, reg);
  else if (r) { const nav = reviewNav(); detail = renderDetail(r, reg, { prev: nav.prev >= 0, next: nav.next >= 0 }); }
  else if (keys.length) detail = '<p class="muted">Choisissez un moment clé : le plateau revient à la position, avec le coup joué <span class="key played"></span> et le meilleur coup <span class="key best"></span>.</p>';
  const rv = $('review');
  rv.innerHTML = `
    <div class="rv-head"><b>Analyse de la partie</b><button class="mini" id="rvClose">Fermer</button></div>
    ${failed ? '<p class="muted">Analyse indisponible : le moteur du bot n’a pas pu être chargé.</p>' : done < total ? `<div class="rv-progress"><i style="width:${(done / total) * 100}%"></i><span>Analyse des coups ${done} / ${total}…</span></div>` : ''}
    ${renderSummary(items, sides, sideNames(), hintsUsed())}
    ${renderGraph(items, final.ply, r ? r.ply : -1)}
    ${renderKeyMoments(items, keys, sel)}
    ${detail}
    ${finished ? renderLessons(items, sides) + renderTrend(progressStats(load('progress'))) : ''}
    ${renderList(items, sel)}`;
  $('rvClose').onclick = () => closeReview(true);
  const on = (selector, fn) => rv.querySelectorAll(selector).forEach(el => { /** @type {HTMLElement} */ (el).onclick = () => fn(/** @type {HTMLElement} */ (el).dataset); });
  on('.rv-list li[data-i], .rv-keys li[data-i]', d => selectReview(+d.i));
  on('.rv-graph g[data-ply]', d => selectReview(items.findIndex(x => x && x.ply === +d.ply)));
  on('[data-nav]', d => { const nav = reviewNav(), i = +d.nav < 0 ? nav.prev : nav.next; if (i >= 0) selectReview(i); });
  on('[data-line]', d => playLine(d.line));
  on('[data-puzzle]', () => startPuzzle());
  on('[data-pz]', d => puzzleAction(d.pz));
  const all = /** @type {HTMLDetailsElement} */ (rv.querySelector('.rv-all'));
  if (all) { all.open = listOpen; all.ontoggle = () => { listOpen = all.open; }; }
  bindMoveChips(rv, reg.list);
}
