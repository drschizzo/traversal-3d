// Analyse de fin de partie. Les coups déjà jugés pendant la partie (entraînement) sont repris tels quels, les autres
// analysés un à un. Les plus grosses fautes deviennent des moments clés : on y voit ce qui s'est passé, ce qu'il
// fallait jouer, la suite rejouée sur le plateau, et l'on peut chercher soi-même un meilleur coup (exercice, phase puzzle).
import * as G from '../../core/index.js';
import { sameMove, WIN, DRAW } from '../../core/index.js';
import { PLAYER_NAMES } from '../i18n/fr.js';
import * as R from '../render/index.js';
import { explain, winProb } from '../coach/explain.js';
import { moveText, pct } from '../coach/wording.js';
import { reviewMove, keyMoments, isError } from '../coach/review.js';
import { addGame, progressStats } from '../coach/progress.js';
import { load, save } from '../storage.js';
import { judgedSides } from './modes.js';
import { S, play, phase, mode, coachCtx } from './store.js';
import { reviewAnalysis, bumpReview, tokens } from './bot.js';
import { hideFeedback } from './training.js';
import { $ } from '../ui/dom.js';
import { setStatus, updateHUD } from '../ui/hud.js';
import { updateControls } from '../ui/controls.js';
import { setCoach, bindMoveChips, showPlan, clearPlan } from '../ui/coach-panel.js';
import { moveRegistry } from '../ui/coach-view.js';
import { renderSummary, renderLessons, renderGraph, renderKeyMoments, renderList, renderDetail, renderPuzzle, renderTrend, renderMenuProgress } from '../ui/review-view.js';
import { showGameOver } from '../ui/game-over.js';
import { clearSelection } from '../ui/input.js';
import { updateMenuShift } from '../ui/menu.js';
import { BEST, PLAYED } from '../ui/colors.js';

let items = [], sel = -1, finalState = null, failed = false, listOpen = false;
// lineToken : suite rejouée sur le plateau (une nouvelle position l'interrompt)
let lineToken = 0;
const reviewing = () => phase.is('review', 'puzzle');

async function startReview() {
  if (reviewing()) return;
  bumpReview();
  const token = tokens.review;
  phase.to('review');
  finalState = S.state;
  const humans = S.movesLog.filter(x => x.human);
  items = humans.map(x => { const r = S.liveReviews.get(x.before); return r && sameMove(r.move, x.move) ? r : null; });
  sel = -1;
  S.puzzle = null;
  failed = false;
  $('over').classList.add('hidden');
  hideFeedback();
  setCoach(false);
  $('legend').classList.add('hidden');
  $('review').classList.remove('hidden');
  updateMenuShift();
  renderReview();
  const think = s => reviewAnalysis(s);
  for (let k = 0; k < humans.length; k++) {
    if (items[k]) continue;
    const r = await reviewMove(think, humans[k].before, humans[k].move, coachCtx());
    if (token !== tokens.review) return;
    if (!r) { failed = true; renderReview(); return; } // moteur WebAssembly indisponible : pas d'analyse
    items[k] = r;
    renderReview();
  }
  recordProgress(items, finalState);
  renderReview();
}

// fautes dans l'ordre de la partie, pour passer de l'une à l'autre
function reviewNav() {
  const sides = judgedSides(play);
  const errs = items.map((r, i) => (r && sides.includes(r.side) && isError(r) ? i : -1)).filter(i => i >= 0);
  return { prev: [...errs].reverse().find(i => i < sel) ?? -1, next: errs.find(i => i > sel) ?? -1 };
}

function sideNames() {
  const m = mode();
  if (!m.seated) return PLAYER_NAMES;
  const me = m.remote ? 'Vous' : 'Joueur', other = m.remote ? 'Adversaire' : 'Bot';
  return PLAYER_NAMES.map((n, o) => `${o === play.side ? me : other} (${n})`);
}

function renderReview() {
  if (!reviewing()) return;
  const done = items.filter(Boolean).length, total = items.length;
  const sides = judgedSides(play);
  const keys = keyMoments(items, sides);
  const r = sel >= 0 ? items[sel] : null;
  const reg = moveRegistry();
  const hints = S.movesLog.filter(x => x.human && x.hint).length;
  const finished = done === total && !failed;
  let detail = '';
  if (S.puzzle) detail = renderPuzzle(S.puzzle, reg);
  else if (r) { const nav = reviewNav(); detail = renderDetail(r, reg, { prev: nav.prev >= 0, next: nav.next >= 0 }); }
  else if (keys.length) detail = '<p class="muted">Choisissez un moment clé : le plateau revient à la position, avec le coup joué <span class="key played"></span> et le meilleur coup <span class="key best"></span>.</p>';
  const rv = $('review');
  rv.innerHTML = `
    <div class="rv-head"><b>Analyse de la partie</b><button class="mini" id="rvClose">Fermer</button></div>
    ${failed ? '<p class="muted">Analyse indisponible : le moteur du bot n’a pas pu être chargé.</p>' : done < total ? `<div class="rv-progress"><i style="width:${(done / total) * 100}%"></i><span>Analyse des coups ${done} / ${total}…</span></div>` : ''}
    ${renderSummary(items, sides, sideNames(), hints)}
    ${renderGraph(items, finalState.ply, r ? r.ply : -1)}
    ${renderKeyMoments(items, keys, sel)}
    ${detail}
    ${finished ? renderLessons(items, sides) + renderTrend(progressStats(load('progress'))) : ''}
    ${renderList(items, sel)}`;
  $('rvClose').onclick = () => closeReview(true);
  const on = (selector, fn) => rv.querySelectorAll(selector).forEach(el => { /** @type {HTMLElement} */ (el).onclick = () => fn(/** @type {HTMLElement} */ (el).dataset); });
  on('.rv-list li[data-i], .rv-keys li[data-i]', d => selectReview(+d.i));
  on('.rv-graph g[data-ply]', d => selectReview(items.findIndex(x => x && x.ply === +d.ply)));
  on('[data-nav]', d => { const nav = reviewNav(), i = +d.nav < 0 ? nav.prev : nav.next; if (i >= 0) selectReview(i); });
  on('[data-line]', d => playLine(r, d.line));
  on('[data-puzzle]', () => startPuzzle(r));
  on('[data-pz]', d => puzzleAction(d.pz));
  const all = /** @type {HTMLDetailsElement} */ (rv.querySelector('.rv-all'));
  if (all) { all.open = listOpen; all.ontoggle = () => { listOpen = all.open; }; }
  bindMoveChips(rv, reg.list);
}

function selectReview(i) {
  const r = items[i];
  if (!r) return;
  S.puzzle = null;
  sel = i;
  showReviewPosition(r);
  renderReview();
  $('review').querySelector('.rv-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// plateau à la position d'avant le coup, avec le meilleur coup (vert) et le coup joué (orange)
function showReviewPosition(r) {
  lineToken++;
  phase.to('review');
  S.state = r.before;
  clearSelection();
  R.syncPieces(S.state);
  updateHUD();
  clearPlan();
  showPlan(r.isBest ? [{ move: r.move, side: r.side, color: BEST }] : [{ move: r.best, side: r.side, color: BEST }, { move: r.move, side: r.side, color: PLAYED }]);
  setStatus(`Position avant le coup ${r.ply + 1} — à ${PLAYER_NAMES[r.side]} de jouer`, r.side);
  updateControls();
}

// rejoue sur le plateau le coup (joué ou meilleur) puis la suite que le bot prévoit
async function playLine(r, which) {
  if (!r) return;
  showReviewPosition(r);
  clearPlan();
  const token = lineToken;
  const expl = which === 'best' ? r.bestExpl : r.playedExpl;
  const moves = [which === 'best' ? r.best : r.move, ...expl.plan.slice(0, 5).map(p => p.move)];
  let s = r.before;
  for (const m of moves) {
    if (s.over) break;
    setStatus(moveText(s, m, r.ctx), s.turn);
    await R.animateMove(m, s);
    if (token !== lineToken) return void R.syncPieces(S.state);
    s = G.applyMove(s, m);
    S.state = s;
    R.syncPieces(s);
    updateHUD();
    await R.wait(420);
    if (token !== lineToken) return;
  }
  setStatus(`${which === 'best' ? 'Suite du meilleur coup' : 'Suite du coup joué'} : fin de la variante prévue`, r.side);
}

// ---------------------------------------------------------------- exercice : retrouver un meilleur coup
function startPuzzle(r) {
  showReviewPosition(r);
  clearPlan();
  phase.to('puzzle');
  S.puzzle = { r, tries: 0, msg: '', tone: 'info', solved: false, hint: false, showSolution: false, busy: false };
  setStatus(`À ${r.ctx.me === r.side ? 'vous' : PLAYER_NAMES[r.side]} : trouvez un meilleur coup`, r.side);
  renderReview();
}

export async function tryPuzzle(m) {
  const pz = S.puzzle;
  if (!pz || pz.busy || pz.solved) return;
  const r = pz.r, token = lineToken;
  clearSelection();
  if (sameMove(m, r.move)) {
    Object.assign(pz, { msg: 'C’est le coup joué dans la partie : cherchez autre chose.', tone: 'ko' });
    return renderReview();
  }
  pz.busy = true;
  phase.to('review');
  renderReview();
  const anim = R.animateMove(m, r.before);
  const after = G.applyMove(r.before, m);
  let score;
  if (sameMove(m, r.best)) score = r.bestScore;
  else if (after.over) score = after.winner === DRAW ? 0 : after.winner === r.side ? WIN : -WIN;
  else {
    // le coup a été examiné par la même recherche que le meilleur : son score y est comparable
    const alt = r.bestInfo.alts.find(x => sameMove(x.move, m));
    if (alt) score = alt.score;
    else { const res = await reviewAnalysis(after); const v = res.info ? res.info.score : 0; score = after.turn === r.side ? v : -v; }
  }
  await anim;
  if (S.puzzle !== pz || token !== lineToken) return void R.syncPieces(S.state);
  const p = winProb(score), loss = Math.max(0, (r.pBest - p) * 100);
  const yours = r.ctx.me === r.side ? 'vos chances' : `les chances de ${PLAYER_NAMES[r.side]}`;
  pz.busy = false;
  pz.tries++;
  if (loss < 6) {
    pz.solved = true;
    pz.tone = 'ok';
    pz.msg = sameMove(m, r.best) ? '**Bravo !** C’est exactement le coup du bot.'
      : `**Bien joué !** Ce coup vaut presque le meilleur : ${yours} passent à ${pct(p)}, contre ${pct(r.pPlayed)} avec le coup de la partie.`;
    renderReview();
    return;
  }
  const e = explain(r.before, m, { ...r.bestInfo, score, pv: [{ move: m, before: r.before }], alts: [] }, { judged: true, ctx: r.ctx });
  const bad = e.reasons.find(x => x.tone === 'bad' && x.weight >= 30);
  pz.tone = 'ko';
  pz.msg = `**Pas encore.** Avec ce coup, ${yours} seraient de ${pct(p)} au lieu de ${pct(r.pBest)}.${bad ? ` ⚠️ ${bad.idea}.` : ''} Réessayez.`;
  renderReview();
  await R.wait(900);
  if (S.puzzle !== pz) return;
  R.syncPieces(r.before); // la pièce revient à sa place pour un nouvel essai
  phase.to('puzzle');
}

function puzzleAction(action) {
  const pz = S.puzzle;
  if (!pz) return;
  if (action === 'hint') { pz.hint = true; renderReview(); }
  else if (action === 'solution') {
    lineToken++;
    pz.showSolution = true;
    pz.busy = false;
    phase.to('review');
    clearSelection();
    R.syncPieces(pz.r.before);
    showPlan([{ move: pz.r.best, side: pz.r.side, color: BEST }]);
    renderReview();
  } else if (action === 'back') selectReview(items.indexOf(pz.r));
}

export function closeReview(showOver) {
  if (!reviewing()) return;
  bumpReview();
  lineToken++;
  S.puzzle = null;
  phase.to('over');
  $('review').classList.add('hidden');
  $('legend').classList.remove('hidden');
  updateMenuShift();
  clearPlan();
  if (finalState) { S.state = finalState; R.syncPieces(S.state); updateHUD(); updateControls(); }
  if (showOver) showGameOver();
}

// ---------------------------------------------------------------- progression d'une partie à l'autre
// Chaque partie analysée (contre le bot ou en ligne) laisse une ligne : coups solides, précision, thèmes des fautes.
export function recordProgress(judged, final) {
  if (!mode().seated || !final) return;
  const id = `${S.worldSeed}:${final.ply}:${play.mode}:${play.side}`;
  const list = addGame(load('progress'), judged, { id, side: play.side, level: play.level });
  if (!list) return;
  save('progress', list);
  showMenuProgress();
}
function showMenuProgress() {
  const p = progressStats(load('progress')), el = $('menuProgress');
  el.classList.toggle('hidden', !p);
  if (p) el.innerHTML = renderMenuProgress(p);
}

export function initReview() {
  $('btnReview').onclick = startReview;
  showMenuProgress();
}
