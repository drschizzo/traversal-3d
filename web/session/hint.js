// Conseil en trois temps : chaque appui en dévoile un peu plus (une piste, puis la pièce, puis le coup)
import * as R from '../render/index.js';
import { explain } from '../coach/explain.js';
import { S, phase, isHuman, coachCtx } from './store.js';
import { analysisFor, gameScope } from './bot.js';
import * as V from './view.js';

export async function hint() {
  const s = S.state;
  if (!s || s.over || !isHuman(s.turn) || !phase.is('human', 'coach') || S.hintPending) return;
  if (S.hintData && S.hintLevel > 0) return revealHint(Math.min(3, S.hintLevel + 1));
  S.hintPending = true;
  S.hintFailed = false;
  V.refresh();
  const wasOpen = S.coachOn;
  V.emit('coachOpen', true); // le panneau montre l'attente, puis le conseil
  S.coachForHint = !wasOpen;
  const { signal } = gameScope;
  const { move, info } = await analysisFor(s);
  S.hintPending = false;
  V.refresh();
  if (signal.aborted || S.state !== s) return void V.emit('coach');
  if (!move || !info) {
    S.hintFailed = true;
    return void V.emit('coach');
  }
  S.hintData = explain(s, move, info, { ctx: coachCtx(s.turn) });
  revealHint(1);
}

export function revealHint(level) {
  if (!S.hintData || S.state.over || !isHuman(S.state.turn)) return;
  S.hintLevel = level;
  if (level === 2) V.emit('select', S.hintData.move.pi);
  if (level === 3) showHint(S.hintData.move);
  if (!S.coachOn) { V.emit('coachOpen', true); S.coachForHint = true; }
  V.emit('coach');
  V.refresh();
}

// coup conseillé : la pièce est sélectionnée, sa case d'arrivée cerclée d'or
function showHint(m) {
  S.hintMove = m;
  V.emit('select', m.pi);
  R.showHint(m);
}
export function clearHint() {
  S.hintMove = null;
  S.hintLevel = 0;
  S.hintData = null;
  S.hintFailed = false;
  S.pinnedMove = null;
  R.showHint(null);
}
