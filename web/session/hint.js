// Conseil en trois temps : chaque appui en dévoile un peu plus (une piste, puis la pièce, puis le coup)
import * as R from '../render/index.js';
import { explain } from '../coach/explain.js';
import { S, phase, isHuman, coachCtx } from './store.js';
import { analysisFor, tokens } from './bot.js';
import { $ } from '../ui/dom.js';
import { updateControls } from '../ui/controls.js';
import { setCoach, renderCoach } from '../ui/coach-panel.js';
import { select } from '../ui/input.js';

export async function hint() {
  const s = S.state;
  if (!s || s.over || !isHuman(s.turn) || !phase.is('human', 'coach') || S.hintPending) return;
  if (S.hintData && S.hintLevel > 0) return revealHint(Math.min(3, S.hintLevel + 1));
  S.hintPending = true;
  updateControls();
  const wasOpen = S.coachOn;
  setCoach(true);
  S.coachForHint = !wasOpen;
  $('coach').innerHTML = '<div class="coach-wait"><span class="spinner"></span> Le bot analyse la position…</div>';
  const token = tokens.game;
  const { move, info } = await analysisFor(s);
  S.hintPending = false;
  updateControls();
  if (token !== tokens.game || S.state !== s) { renderCoach(); return; }
  if (!move || !info) { $('coach').innerHTML = '<p class="muted">Analyse indisponible.</p>'; return; }
  S.hintData = explain(s, move, info, { ctx: coachCtx(s.turn) });
  revealHint(1);
}

export function revealHint(level) {
  if (!S.hintData || S.state.over || !isHuman(S.state.turn)) return;
  S.hintLevel = level;
  if (level === 2) select(S.hintData.move.pi);
  if (level === 3) showHint(S.hintData.move);
  if (!S.coachOn) { setCoach(true); S.coachForHint = true; }
  renderCoach();
  updateControls();
}

// coup conseillé : la pièce est sélectionnée, sa case d'arrivée cerclée d'or
function showHint(m) {
  S.hintMove = m;
  select(m.pi);
  R.showHint(m);
}
export function clearHint() {
  S.hintMove = null;
  S.hintLevel = 0;
  S.hintData = null;
  S.pinnedMove = null;
  R.showHint(null);
}
