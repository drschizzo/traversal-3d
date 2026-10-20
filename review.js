// Traversal — analyse de fin de partie : qualité de chaque coup humain comparée au meilleur coup trouvé par le moteur.
import * as G from './game.js';
import { WIN, winProb, explain, describeMove } from './coach.js';

// catégories, de la meilleure à la pire, selon la perte de chances de gain (en points de pourcentage)
export const GRADES = [
  { id: 'best', label: 'Meilleur coup', short: 'meilleur', icon: '★', color: '#7fe39a' },
  { id: 'excellent', label: 'Excellent', short: 'excellent', icon: '✓', color: '#9be7c4', max: 2 },
  { id: 'good', label: 'Bon coup', short: 'bon', icon: '✓', color: '#c9d6a3', max: 6 },
  { id: 'inaccuracy', label: 'Imprécision', short: 'imprécision', icon: '?!', color: '#f2c46d', max: 12 },
  { id: 'mistake', label: 'Erreur', short: 'erreur', icon: '?', color: '#f0955a', max: 25 },
  { id: 'blunder', label: 'Gaffe', short: 'gaffe', icon: '??', color: '#ef5b5b', max: Infinity },
];
const gradeById = id => GRADES.find(g => g.id === id);

const sameMove = (a, b) => a.pi === b.pi && a.kind === b.kind && (a.kind === 'exit' || a.to === b.to);
const pct = p => `${Math.round(p * 100)} %`;

// score d'un état terminal du point de vue de side
function terminalScore(s, side) {
  if (s.winner === 2) return 0;
  return s.winner === side ? WIN - s.ply : -(WIN - s.ply);
}

// Analyse d'un coup. think(state) -> Promise<{ move, info }> (moteur avec analyse).
export async function reviewMove(think, before, move) {
  const side = before.turn;
  const best = await think(before);
  if (!best.move || !best.info) return null;
  const bestScore = best.info.score;
  let playedScore, playedInfo;
  if (sameMove(best.move, move)) {
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
      playedScore = after.turn === side ? s : -s;
      // suite attendue après le coup joué, pour comprendre ce qui cloche
      const line = r.info ? r.info.pv : [];
      playedInfo = { ...best.info, score: playedScore, pv: [{ move, before }, ...line], alts: [] };
    }
  }
  const pBest = winProb(bestScore), pPlayed = winProb(playedScore);
  // à profondeur un peu différente, le coup joué peut paraître meilleur que le « meilleur » : on borne à 0
  const loss = Math.max(0, (pBest - pPlayed) * 100);
  const isBest = sameMove(best.move, move);
  const grade = isBest ? 'best' : GRADES.find(g => g.max !== undefined && loss < g.max).id;
  return {
    ply: before.ply, side, before, move, best: best.move, isBest, grade, loss,
    pBest, pPlayed, bestScore, playedScore,
    bestExpl: explain(before, best.move, best.info),
    playedExpl: explain(before, move, playedInfo, { judged: true }),
  };
}

// Bilan par camp : précision (100 − perte moyenne) et nombre de coups par catégorie
export function summary(items, side) {
  const mine = items.filter(r => r && r.side === side);
  if (!mine.length) return null;
  const counts = Object.fromEntries(GRADES.map(g => [g.id, 0]));
  for (const r of mine) counts[r.grade]++;
  const meanLoss = mine.reduce((a, r) => a + Math.min(r.loss, 50), 0) / mine.length;
  return { n: mine.length, accuracy: Math.max(0, 100 - meanLoss * 2), counts };
}

// ---------------------------------------------------------------- rendu
const DOT = ['#e0484f', '#4d8cf0'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function renderSummary(items, sides, names) {
  return sides.map(side => {
    const s = summary(items, side);
    if (!s) return '';
    const chips = GRADES.filter(g => s.counts[g.id]).map(g => `<span class="chip" style="--c:${g.color}">${g.icon} ${s.counts[g.id]} ${g.short}${s.counts[g.id] > 1 ? 's' : ''}</span>`).join('');
    return `<div class="rv-player"><div class="rv-name"><i style="background:${DOT[side]}"></i>${esc(names[side])}<b title="100 − 2 × perte moyenne de chances de gain par coup">${Math.round(s.accuracy)} %</b><span>précision</span></div><div class="chips">${chips}</div></div>`;
  }).join('');
}

// courbe des chances de Rouge (évaluation avant chaque coup analysé), fautes marquées
export function renderGraph(items, total) {
  const pts = items.filter(Boolean);
  if (pts.length < 2) return '';
  const W = 340, H = 70, X = ply => (ply / Math.max(total, 1)) * W, Y = p => (1 - p) * H;
  const line = pts.map(r => `${X(r.ply).toFixed(1)},${Y(r.side === 0 ? r.pBest : 1 - r.pBest).toFixed(1)}`).join(' ');
  const marks = pts.filter(r => ['inaccuracy', 'mistake', 'blunder'].includes(r.grade)).map(r => {
    const g = gradeById(r.grade);
    return `<circle data-ply="${r.ply}" cx="${X(r.ply).toFixed(1)}" cy="${Y(r.side === 0 ? r.pBest : 1 - r.pBest).toFixed(1)}" r="4" fill="${g.color}"><title>${g.label} au coup ${r.ply + 1}</title></circle>`;
  }).join('');
  return `<svg class="rv-graph" viewBox="-4 -4 ${W + 8} ${H + 8}" aria-label="Chances de gain de Rouge au fil de la partie">
    <rect x="0" y="0" width="${W}" height="${H / 2}" class="top"/><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"/>
    <polyline points="${line}"/>${marks}</svg>`;
}

export function renderList(items, selected) {
  return `<ol class="rv-list">${items.map((r, i) => {
    if (!r) return `<li class="pending" data-i="${i}"><span class="sp"></span>analyse…</li>`;
    const g = gradeById(r.grade);
    return `<li data-i="${i}" class="${i === selected ? 'sel' : ''}"><span class="n">${r.ply + 1}.</span><i style="background:${DOT[r.side]}"></i>
      <span class="mv">${esc(describeMove(r.before, r.move))}</span><span class="gr" style="color:${g.color}" title="${g.label}">${g.icon}</span></li>`;
  }).join('')}</ol>`;
}

export function renderDetail(r) {
  const g = gradeById(r.grade);
  const reasons = (list, icons) => list.filter(x => !icons || icons.includes(x.icon)).slice(0, 4).map(x => `<li><span class="ic">${x.icon}</span><span>${x.html}</span></li>`).join('');
  let html = `<div class="rv-detail"><div class="rv-grade" style="color:${g.color}">${g.icon} ${g.label}</div>
    <p><b>Coup joué</b> : ${esc(describeMove(r.before, r.move))}<br>Chances de gain : ${pct(r.pPlayed)}${r.isBest ? '' : ` (au lieu de ${pct(r.pBest)} avec le meilleur coup)`}.</p>`;
  if (r.isBest) {
    html += `<p class="muted">C’est le coup que le bot aurait joué.</p><ul class="reasons">${reasons(r.bestExpl.reasons)}</ul>`;
  } else {
    html += `<h4><span class="key best"></span>Meilleur coup : ${esc(describeMove(r.before, r.best))}</h4><ul class="reasons">${reasons(r.bestExpl.reasons)}</ul>`;
    const bad = r.playedExpl.reasons.filter(x => x.icon === '⚠️' || x.icon === '↩️');
    html += `<h4><span class="key played"></span>Le coup joué : −${Math.round(r.loss)} points de chances</h4><ul class="reasons">${bad.length ? reasons(bad) : reasons(r.playedExpl.reasons)}</ul>`;
    const line = r.playedExpl.plan.slice(0, 4);
    if (line.length) html += `<p><b>Suite attendue après ce coup</b> :</p><ol class="plan">${line.map(p => `<li><i style="background:${DOT[p.side]}"></i>${esc(p.text)}</li>`).join('')}</ol>`;
  }
  return html + '</div>';
}
