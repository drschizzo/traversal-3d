// Jugement des coups joués : qualité de chaque coup humain comparée au meilleur coup trouvé par le moteur,
// ce qui cloche (la réponse adverse), le thème de l'erreur (relié au guide) et le bilan de la partie.
// Pur : renvoie des données, que ui/review-view.js met en page.
import * as G from '../../core/index.js';
import { WIN, sameMove } from '../../core/index.js';
import { PLAYER_NAMES } from '../i18n/fr.js';
import { explain, winProb } from './explain.js';
import { pieceRef, cap, lower } from './wording.js';

// catégories, de la meilleure à la pire, selon la perte de chances de gain (en points de pourcentage)
export const GRADES = [
  { id: 'best', label: 'Meilleur coup', short: 'meilleur' },
  { id: 'excellent', label: 'Excellent', short: 'excellent', max: 2 },
  { id: 'good', label: 'Bon coup', short: 'bon', max: 6 },
  { id: 'inaccuracy', label: 'Imprécision', short: 'imprécision', max: 12 },
  { id: 'mistake', label: 'Erreur', short: 'erreur', max: 25 },
  { id: 'blunder', label: 'Gaffe', short: 'gaffe', max: Infinity },
];
// un coup « solide » ne perd presque rien ; une faute mérite d'être revue
const isSolid = r => ['best', 'excellent', 'good'].includes(r.grade);
export const isError = r => !isSolid(r);

// score d'un état terminal du point de vue de side
function terminalScore(s, side) {
  if (s.winner === 2) return 0;
  return s.winner === side ? WIN - s.ply : -(WIN - s.ply);
}

// ce qui cloche dans le coup joué, en une phrase : la réponse adverse si elle punit, sinon le défaut le plus lourd
function refutation(before, move, played, best, ctx) {
  const side = before.turn, opp = ctx.me === side ? 'l’adversaire' : PLAYER_NAMES[1 - side];
  const line = played.plan.slice(0, 4);
  const reply = line[0];
  if (reply && reply.side !== side) {
    if (reply.move.kind === 'attack') return `${cap(opp)} répond en capturant ${pieceRef(reply.before, reply.before.cell[reply.move.to], ctx)}.`;
    if (reply.move.kind === 'exit') return `${cap(opp)} en profite pour faire franchir l’arrivée à ${pieceRef(reply.before, reply.move.pi, ctx)}.`;
  }
  const hit = line.find(x => x.side !== side && x.move.kind === 'attack');
  if (hit) return `Quelques coups plus loin, ${opp} capture ${pieceRef(hit.before, hit.before.cell[hit.move.to], ctx)}.`;
  const bad = played.reasons.find(r => r.tone === 'bad' && r.weight >= 30);
  if (bad) return bad.text.replace(/\*\*/g, '');
  return null;
}

// Faute sans réponse adverse qui punit : ce que le meilleur coup apportait. L'idée d'une raison positive est un verbe
// (« Capturer… », « Gagner un tour… ») ; une raison neutre est un simple constat (« Course inchangée ») : on décrit alors le coup.
export function missedChance(bestExpl) {
  const idea = bestExpl.idea;
  if (idea.tone === 'good') return `Occasion manquée : il fallait ${lower(idea.idea)}.`;
  return `Occasion manquée : le bot aurait joué ainsi : ${lower(bestExpl.title)}.`;
}

// Analyse d'un coup. think(state) -> Promise<{ move, info }> (moteur avec analyse).
// ctx : { view, me } pour nommer les pièces (voir coach.js).
export async function reviewMove(think, before, move, ctx) {
  const side = before.turn;
  const best = await think(before);
  if (!best.move || !best.info) return null;
  const bestScore = best.info.score;
  const isBest = sameMove(best.move, move);
  let playedScore, playedInfo;
  if (isBest) {
    playedScore = bestScore;
    playedInfo = best.info;
  } else {
    const after = G.applyMove(before, move);
    if (after.over) {
      playedScore = terminalScore(after, side);
      playedInfo = { ...best.info, score: playedScore, pv: [{ move, before }], alts: [] };
    } else {
      const r = await think(after);
      const s = r.info ? r.info.score : 0;
      // le coup figure parmi les alternatives de la même recherche : son score y est comparable au meilleur
      const alt = best.info.alts.find(a => sameMove(a.move, move));
      playedScore = alt ? alt.score : after.turn === side ? s : -s;
      // suite attendue après le coup joué, pour comprendre ce qui cloche
      const line = r.info ? r.info.pv : [];
      playedInfo = { ...best.info, score: playedScore, pv: [{ move, before }, ...line], alts: [] };
    }
  }
  const pBest = winProb(bestScore), pPlayed = winProb(playedScore);
  // à profondeur un peu différente, le coup joué peut paraître meilleur que le « meilleur » : on borne à 0
  const loss = isBest ? 0 : Math.max(0, (pBest - pPlayed) * 100);
  const grade = isBest ? 'best' : GRADES.find(g => g.max !== undefined && loss < g.max).id;
  const bestExpl = explain(before, best.move, best.info, { ctx });
  const playedExpl = explain(before, move, playedInfo, { judged: true, ctx });
  // thème de la faute : ce que le coup joué abîme, sinon ce que le meilleur coup apportait
  const badLead = playedExpl.reasons.find(r => r.tone === 'bad' && r.weight >= 30);
  const theme = badLead ? badLead.theme : bestExpl.idea.theme;
  const r = {
    ply: before.ply, side, before, move, best: best.move, bestInfo: best.info, isBest, grade, loss,
    pBest, pPlayed, bestScore, playedScore, bestExpl, playedExpl, theme, ctx,
  };
  // sans réponse adverse qui punit, la faute est une occasion manquée : l'idée du meilleur coup suffit à l'expliquer
  r.why = isBest ? null : refutation(before, move, playedExpl, bestExpl, ctx);
  r.missed = !r.why;
  if (r.missed && !isBest) r.why = missedChance(bestExpl);
  return r;
}

// Bilan par camp : coups solides, précision (100 − 2 × perte moyenne), catégories et thèmes des fautes
export function summary(items, side) {
  const mine = items.filter(r => r && r.side === side);
  if (!mine.length) return null;
  const counts = Object.fromEntries(GRADES.map(g => [g.id, 0]));
  const themes = {};
  for (const r of mine) {
    counts[r.grade]++;
    if (isError(r)) themes[r.theme] = (themes[r.theme] || 0) + 1;
  }
  const meanLoss = mine.reduce((a, r) => a + Math.min(r.loss, 50), 0) / mine.length;
  return { n: mine.length, solid: mine.filter(isSolid).length, accuracy: Math.max(0, 100 - meanLoss * 2), counts, themes };
}

// moments clés : les plus grosses fautes (au plus 5), dans l'ordre de la partie ; indices dans items
export function keyMoments(items, sides) {
  return items.map((r, i) => [r, i]).filter(([r]) => r && sides.includes(r.side) && isError(r))
    .sort((a, b) => b[0].loss - a[0].loss).slice(0, 5).map(([, i]) => i).sort((a, b) => a - b);
}
