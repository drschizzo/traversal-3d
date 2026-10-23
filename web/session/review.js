// Analyse de fin de partie. Les coups déjà jugés pendant la partie (entraînement) sont repris tels quels, les autres
// analysés un à un. Les plus grosses fautes deviennent des moments clés : on y voit ce qui s'est passé, ce qu'il
// fallait jouer, la suite rejouée sur le plateau, et l'on peut chercher soi-même un meilleur coup (exercice, phase puzzle).
//
// Ce qu'il y a à montrer est dans S.review (coups jugés, moment choisi, position finale) et S.puzzle ;
// sa mise en page est dans ui/review-panel.js, prévenue par l'annonce « review ».
import * as G from '../../core/index.js';
import { sameMove, WIN, DRAW } from '../../core/index.js';
import { PLAYER_NAMES } from '../i18n/fr.js';
import * as R from '../render/index.js';
import { explain, winProb } from '../coach/explain.js';
import { moveText, pct } from '../coach/wording.js';
import { reviewMove, keyMoments, isError } from '../coach/review.js';
import { addGame } from '../coach/progress.js';
import { load, save } from '../storage.js';
import { judgedSides } from './modes.js';
import { S, play, phase, mode, coachCtx } from './store.js';
import { reviewAnalysis, bumpReview, reviewScope } from './bot.js';
import { hideFeedback } from './training.js';
import * as V from './view.js';
import { BEST, PLAYED } from '../colors.js';

// suite rejouée sur le plateau : une nouvelle position l'interrompt, et refermer l'analyse aussi (portée fille)
const lineScope = reviewScope.child();
const reviewing = () => phase.is('review', 'puzzle');
const rv = () => S.review;

export async function startReview() {
  if (reviewing()) return;
  bumpReview();
  const { signal } = reviewScope;
  phase.to('review');
  const humans = S.movesLog.filter(x => x.human);
  S.review = {
    items: humans.map(x => { const r = S.liveReviews.get(x.before); return r && sameMove(r.move, x.move) ? r : null; }),
    sel: -1, final: S.state, failed: false,
  };
  S.puzzle = null;
  hideFeedback();
  V.emit('coachOpen', false);
  V.emit('review'); // l'écran d'analyse s'ouvre et se remplit au fil des coups jugés
  const think = s => reviewAnalysis(s);
  for (let k = 0; k < humans.length; k++) {
    if (rv().items[k]) continue;
    const r = await reviewMove(think, humans[k].before, humans[k].move, coachCtx());
    if (signal.aborted) return;
    if (!r) { rv().failed = true; V.emit('review'); return; } // moteur WebAssembly indisponible : pas d'analyse
    rv().items[k] = r;
    V.emit('review');
  }
  recordProgress(rv().items, rv().final);
  V.emit('review');
}

/** Fautes dans l'ordre de la partie, pour passer de l'une à l'autre (indices dans S.review.items). */
export function reviewNav() {
  const { items, sel } = rv(), sides = judgedSides(play);
  const errs = items.map((r, i) => (r && sides.includes(r.side) && isError(r) ? i : -1)).filter(i => i >= 0);
  return { prev: [...errs].reverse().find(i => i < sel) ?? -1, next: errs.find(i => i > sel) ?? -1 };
}

/** Moments clés : les plus grosses fautes des camps jugés. */
export const reviewKeys = () => keyMoments(rv().items, judgedSides(play));
export const reviewSides = () => judgedSides(play);
/** Nombre de conseils demandés pendant la partie (bilan). */
export const hintsUsed = () => S.movesLog.filter(x => x.human && x.hint).length;

/** Noms des camps dans le bilan : « Vous », « Bot », « Adversaire », ou simplement les couleurs. */
export function sideNames() {
  const m = mode();
  if (!m.seated) return PLAYER_NAMES;
  const me = m.remote ? 'Vous' : 'Joueur', other = m.remote ? 'Adversaire' : 'Bot';
  return PLAYER_NAMES.map((n, o) => `${o === play.side ? me : other} (${n})`);
}

export function selectReview(i) {
  const r = rv().items[i];
  if (!r) return;
  S.puzzle = null;
  rv().sel = i;
  showReviewPosition(r);
  V.emit('review');
}

// plateau à la position d'avant le coup, avec le meilleur coup (vert) et le coup joué (orange)
function showReviewPosition(r) {
  lineScope.bump();
  phase.to('review');
  S.state = r.before;
  V.clearSelection();
  R.syncPieces(S.state);
  V.clearPlan();
  V.showPlan(r.isBest ? [{ move: r.move, side: r.side, color: BEST }] : [{ move: r.best, side: r.side, color: BEST }, { move: r.move, side: r.side, color: PLAYED }]);
  V.status(`Position avant le coup ${r.ply + 1} — à ${PLAYER_NAMES[r.side]} de jouer`, r.side);
  V.refresh();
}

// rejoue sur le plateau le coup (joué ou meilleur) puis la suite que le bot prévoit
export async function playLine(which) {
  const r = rv().items[rv().sel];
  if (!r) return;
  showReviewPosition(r);
  V.clearPlan();
  const { signal } = lineScope;
  const expl = which === 'best' ? r.bestExpl : r.playedExpl;
  const moves = [which === 'best' ? r.best : r.move, ...expl.plan.slice(0, 5).map(p => p.move)];
  let s = r.before;
  for (const m of moves) {
    if (s.over) break;
    V.status(moveText(s, m, r.ctx), s.turn);
    await R.animateMove(m, s);
    if (signal.aborted) return void R.syncPieces(S.state);
    s = G.applyMove(s, m);
    S.state = s;
    R.syncPieces(s);
    V.refresh();
    await R.wait(420);
    if (signal.aborted) return;
  }
  V.status(`${which === 'best' ? 'Suite du meilleur coup' : 'Suite du coup joué'} : fin de la variante prévue`, r.side);
}

// ---------------------------------------------------------------- exercice : retrouver un meilleur coup
export function startPuzzle() {
  const r = rv().items[rv().sel];
  if (!r) return;
  showReviewPosition(r);
  V.clearPlan();
  phase.to('puzzle');
  S.puzzle = { r, tries: 0, msg: '', tone: 'info', solved: false, hint: false, showSolution: false, busy: false };
  V.status(`À ${r.ctx.me === r.side ? 'vous' : PLAYER_NAMES[r.side]} : trouvez un meilleur coup`, r.side);
  V.emit('review');
}

export async function tryPuzzle(m) {
  const pz = S.puzzle;
  if (!pz || pz.busy || pz.solved) return;
  const r = pz.r, { signal } = lineScope;
  V.clearSelection();
  if (sameMove(m, r.move)) {
    Object.assign(pz, { msg: 'C’est le coup joué dans la partie : cherchez autre chose.', tone: 'ko' });
    return V.emit('review');
  }
  pz.busy = true;
  phase.to('review');
  V.emit('review');
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
  if (S.puzzle !== pz || signal.aborted) return void R.syncPieces(S.state);
  const p = winProb(score), loss = Math.max(0, (r.pBest - p) * 100);
  const yours = r.ctx.me === r.side ? 'vos chances' : `les chances de ${PLAYER_NAMES[r.side]}`;
  pz.busy = false;
  pz.tries++;
  if (loss < 6) {
    pz.solved = true;
    pz.tone = 'ok';
    pz.msg = sameMove(m, r.best) ? '**Bravo !** C’est exactement le coup du bot.'
      : `**Bien joué !** Ce coup vaut presque le meilleur : ${yours} passent à ${pct(p)}, contre ${pct(r.pPlayed)} avec le coup de la partie.`;
    V.emit('review');
    return;
  }
  const e = explain(r.before, m, { ...r.bestInfo, score, pv: [{ move: m, before: r.before }], alts: [] }, { judged: true, ctx: r.ctx });
  const bad = e.reasons.find(x => x.tone === 'bad' && x.weight >= 30);
  pz.tone = 'ko';
  pz.msg = `**Pas encore.** Avec ce coup, ${yours} seraient de ${pct(p)} au lieu de ${pct(r.pBest)}.${bad ? ` ⚠️ ${bad.idea}.` : ''} Réessayez.`;
  V.emit('review');
  await R.wait(900);
  if (S.puzzle !== pz) return;
  R.syncPieces(r.before); // la pièce revient à sa place pour un nouvel essai
  phase.to('puzzle');
}

export function puzzleAction(action) {
  const pz = S.puzzle;
  if (!pz) return;
  if (action === 'hint') { pz.hint = true; V.emit('review'); }
  else if (action === 'solution') {
    lineScope.bump();
    pz.showSolution = true;
    pz.busy = false;
    phase.to('review');
    V.clearSelection();
    R.syncPieces(pz.r.before);
    V.showPlan([{ move: pz.r.best, side: pz.r.side, color: BEST }]);
    V.emit('review');
  } else if (action === 'back') selectReview(rv().items.indexOf(pz.r));
}

export function closeReview(showOver) {
  if (!reviewing()) return;
  bumpReview(); // la portée fille (suite rejouée) est abandonnée avec elle
  S.puzzle = null;
  phase.to('over');
  V.emit('review', false);
  V.clearPlan();
  const final = rv().final;
  if (final) { S.state = final; R.syncPieces(S.state); V.refresh(); }
  if (showOver) V.emit('over');
}

// ---------------------------------------------------------------- progression d'une partie à l'autre
// Chaque partie analysée (contre le bot ou en ligne) laisse une ligne : coups solides, précision, thèmes des fautes.
export function recordProgress(judged, final) {
  if (!mode().seated || !final) return;
  const id = `${S.worldSeed}:${final.ply}:${play.mode}:${play.side}`;
  const list = addGame(load('progress'), judged, { id, side: play.side, level: play.level });
  if (!list) return;
  save('progress', list);
  V.emit('menu'); // le menu montre la progression d'une partie à l'autre
}
