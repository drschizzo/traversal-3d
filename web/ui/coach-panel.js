// Panneau d'analyse : explication du dernier coup du bot (ou du coup revu), conseil en trois temps,
// et coups cités tracés sur le plateau
import * as R from '../render/index.js';
import { S, phase, mode, isHuman } from '../session/store.js';
import { revealHint } from '../session/hint.js';
import { performMove } from '../session/turns.js';
import { $ } from './dom.js';
import { renderAnalysis, renderHint, moveRegistry } from './coach-view.js';
import { updateMenuShift } from './menu.js';

export function setCoach(on) {
  S.coachOn = on;
  S.coachForHint = false;
  $('btnCoach').classList.toggle('on', on);
  $('coach').classList.toggle('hidden', !on);
  $('legend').classList.toggle('hidden', on);
  if (!on) clearPlan();
  renderCoach();
  updateMenuShift();
}

export function renderCoach() {
  const el = $('coach');
  if (!S.coachOn) return;
  const reg = moveRegistry();
  if (S.hintPending) {
    el.innerHTML = '<div class="coach-wait"><span class="spinner"></span> Le bot analyse la position…</div>';
  } else if (S.hintFailed) {
    el.innerHTML = '<p class="muted">Analyse indisponible.</p>';
  } else if (S.hintData && S.hintLevel > 0) {
    el.innerHTML = renderHint(S.hintData, S.hintLevel, reg, { history: S.evalHistory });
    el.querySelectorAll('[data-hint]').forEach(b => { /** @type {HTMLElement} */ (b).onclick = () => revealHint(+(/** @type {HTMLElement} */ (b).dataset.hint)); });
    const playBtn = $('coachPlayHint');
    if (playBtn) playBtn.onclick = () => { if (S.hintMove && phase.is('human', 'coach') && isHuman(S.state.turn)) performMove(S.hintMove); };
  } else if (!S.coachData) {
    el.innerHTML = `<div class="coach-head"><span class="tag">Analyse</span></div>
      <p class="muted">${mode().playback ? 'L’idée de chaque coup du bot s’affichera ici.' : 'Ici s’affiche l’idée de chaque coup du bot. À votre tour, « Conseil » donne une piste, puis la pièce à jouer, puis le coup.'}</p>`;
  } else el.innerHTML = renderAnalysis(S.coachData, reg, { label: S.coachLabel, history: S.evalHistory, compact: R.compactMQ.matches });
  updateMenuShift();
  bindMoveChips(el, reg.list);
  const btn = $('coachPlanBtn');
  if (btn) {
    btn.classList.toggle('on', S.planShown);
    btn.onclick = () => { if (S.planShown) clearPlan(); else showPlan(planItems()); btn.classList.toggle('on', S.planShown); };
  }
}

// coups cités dans un panneau : tracés sur le plateau au survol ; un toucher (ou un clic) garde le tracé affiché
export function bindMoveChips(el, list) {
  el.querySelectorAll('[data-mv]').forEach(c => {
    const m = list[+c.dataset.mv];
    c.onmouseenter = () => R.showPath(m);
    c.onmouseleave = () => R.showPath(S.pinnedMove || S.hintMove);
    c.onclick = () => {
      S.pinnedMove = S.pinnedMove === m ? null : m;
      document.querySelectorAll('.mv-chip.pinned').forEach(x => x.classList.remove('pinned'));
      if (S.pinnedMove) c.classList.add('pinned');
      R.showPath(S.pinnedMove || S.hintMove);
    };
  });
}

// coups à tracer : pour un conseil, le coup suggéré puis la suite ; sinon la suite du coup joué
const planItems = () => (S.hintData && S.hintLevel ? [{ move: S.hintData.move, side: S.hintData.side }, ...S.hintData.plan.slice(0, 3)] : S.coachData.plan.slice(0, 4));

// suite prévue tracée sur le plateau (render/overlays.js)
export function clearPlan() {
  R.clearPlan();
  S.planShown = false;
  $('coachPlanBtn')?.classList.remove('on');
}
export function showPlan(items) {
  R.showPlan(items);
  S.planShown = items.length > 0;
}

export function initCoachPanel() {
  $('btnCoach').onclick = () => setCoach(!S.coachOn);
}
