// Traversal — analyse des coups joués : qualité de chaque coup humain comparée au meilleur coup trouvé par le moteur,
// ce qui cloche (la réponse adverse), le thème de l'erreur (relié au guide) et le bilan de la partie.
import * as G from './game.js';
import { WIN, winProb, pct, plural, esc, sameMove, explain, moveText, pieceRef, TOPICS, ideaBox, reasonList, principleBox, guideUrl } from './coach.js';

// catégories, de la meilleure à la pire, selon la perte de chances de gain (en points de pourcentage)
export const GRADES = [
  { id: 'best', label: 'Meilleur coup', short: 'meilleur', icon: '★', color: '#7fe39a' },
  { id: 'excellent', label: 'Excellent', short: 'excellent', icon: '✓', color: '#9be7c4', max: 2 },
  { id: 'good', label: 'Bon coup', short: 'bon', icon: '✓', color: '#c9d6a3', max: 6 },
  { id: 'inaccuracy', label: 'Imprécision', short: 'imprécision', icon: '?!', color: '#f2c46d', max: 12 },
  { id: 'mistake', label: 'Erreur', short: 'erreur', icon: '?', color: '#f0955a', max: 25 },
  { id: 'blunder', label: 'Gaffe', short: 'gaffe', icon: '??', color: '#ef5b5b', max: Infinity },
];
export const gradeOf = id => GRADES.find(g => g.id === id);
// un coup « solide » ne perd presque rien ; une faute mérite d'être revue
export const isSolid = r => ['best', 'excellent', 'good'].includes(r.grade);
export const isError = r => !isSolid(r);

// score d'un état terminal du point de vue de side
function terminalScore(s, side) {
  if (s.winner === 2) return 0;
  return s.winner === side ? WIN - s.ply : -(WIN - s.ply);
}

// ce qui cloche dans le coup joué, en une phrase : la réponse adverse si elle punit, sinon le défaut le plus lourd
function refutation(before, move, played, best, ctx) {
  const side = before.turn, opp = ctx.me === side ? 'l’adversaire' : G.PLAYER_NAMES[1 - side];
  const line = played.plan.slice(0, 4);
  const reply = line[0];
  if (reply && reply.side !== side) {
    if (reply.move.kind === 'attack') return `${cap(opp)} répond en capturant ${pieceRef(reply.before, reply.before.cell[reply.move.to], ctx)}.`;
    if (reply.move.kind === 'exit') return `${cap(opp)} en profite pour faire franchir l’arrivée à ${pieceRef(reply.before, reply.move.pi, ctx)}.`;
  }
  const hit = line.find(x => x.side !== side && x.move.kind === 'attack');
  if (hit) return `Quelques coups plus loin, ${opp} capture ${pieceRef(hit.before, hit.before.cell[hit.move.to], ctx)}.`;
  const bad = played.reasons.find(r => r.tone === 'bad' && r.weight >= 30);
  if (bad) return bad.html.replace(/<[^>]+>/g, '');
  return null;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const lower = s => s.charAt(0).toLowerCase() + s.slice(1);

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
  if (r.missed && !isBest) r.why = `Occasion manquée : il fallait ${lower(bestExpl.idea.idea)}.`;
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

// ---------------------------------------------------------------- rendu
const DOT = ['#e0484f', '#4d8cf0'];

export function renderSummary(items, sides, names, hints = 0) {
  return sides.map(side => {
    const s = summary(items, side);
    if (!s) return '';
    const chips = GRADES.filter(g => s.counts[g.id]).map(g => `<span class="chip" style="--c:${g.color}">${g.icon} ${s.counts[g.id]} ${g.short}${s.counts[g.id] > 1 ? 's' : ''}</span>`).join('');
    const bar = GRADES.filter(g => s.counts[g.id]).map(g => `<i style="flex:${s.counts[g.id]};background:${g.color}" title="${g.label} : ${s.counts[g.id]}"></i>`).join('');
    return `<div class="rv-player">
      <div class="rv-name"><i style="background:${DOT[side]}"></i>${esc(names[side])}
        <b title="Coups qui perdent moins de 6 points de chances de gain : meilleur coup, excellent ou bon">${s.solid}<small> / ${s.n}</small></b><span>coups solides</span></div>
      <div class="rv-bar">${bar}</div>
      <div class="chips">${chips}<span class="chip plain" title="100 − 2 × perte moyenne de chances de gain par coup">précision ${Math.round(s.accuracy)} %</span>${hints && sides.length === 1 ? `<span class="chip plain">💡 ${plural(hints, 'conseil')}</span>` : ''}</div>
    </div>`;
  }).join('');
}

// ce qu'il faut retenir de la partie : les deux thèmes où se concentrent les fautes, avec le principe du guide
export function renderLessons(items, sides) {
  const themes = {};
  let n = 0;
  for (const side of sides) {
    const s = summary(items, side);
    if (!s) continue;
    n += s.n;
    for (const [t, k] of Object.entries(s.themes)) themes[t] = (themes[t] || 0) + k;
  }
  if (!n) return '';
  const top = Object.entries(themes).sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (!top.length) return '<div class="lessons"><h4>À retenir</h4><p>Aucune faute notable : tous les coups analysés sont solides. Bravo !</p></div>';
  return `<div class="lessons"><h4>À travailler</h4>${top.map(([t, k]) => `
    <div class="lesson"><span class="ic">${TOPICS[t].icon}</span><div><b>${TOPICS[t].label}</b> <span class="muted">· ${plural(k, 'faute')}</span>
      <p>${TOPICS[t].principle} <a href="${guideUrl(t)}" target="_blank" rel="noopener">Le guide ↗</a></p></div></div>`).join('')}</div>`;
}

// courbe des chances de Rouge (évaluation avant chaque coup analysé), fautes marquées et cliquables
export function renderGraph(items, total, selPly = -1) {
  const pts = items.filter(Boolean);
  if (pts.length < 2) return '';
  const W = 340, H = 70, X = ply => (ply / Math.max(total, 1)) * W, Y = p => (1 - p) * H;
  const yOf = r => Y(r.side === 0 ? r.pBest : 1 - r.pBest);
  const line = pts.map(r => `${X(r.ply).toFixed(1)},${yOf(r).toFixed(1)}`).join(' ');
  const marks = pts.filter(isError).map(r => {
    const g = gradeOf(r.grade), x = X(r.ply).toFixed(1), y = yOf(r).toFixed(1);
    return `<g data-ply="${r.ply}" class="${r.ply === selPly ? 'sel' : ''}"><circle class="hit" cx="${x}" cy="${y}" r="11"/><circle cx="${x}" cy="${y}" r="5" fill="${g.color}"/><title>${g.label} au coup ${r.ply + 1}</title></g>`;
  }).join('');
  return `<svg class="rv-graph" viewBox="-6 -6 ${W + 12} ${H + 12}" aria-label="Chances de gain de Rouge au fil de la partie">
    <rect x="0" y="0" width="${W}" height="${H / 2}" class="top"/><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"/>
    <polyline points="${line}"/>${marks}</svg>
    <div class="rv-legend"><span>▲ avantage Rouge</span><span>▼ avantage Bleu</span><span>● faute : cliquer pour la revoir</span></div>`;
}

export function renderKeyMoments(items, keys, selected) {
  if (!keys.length) return '';
  return `<h4>Moments clés</h4><ol class="rv-keys">${keys.map(i => {
    const r = items[i], g = gradeOf(r.grade);
    return `<li data-i="${i}" class="${i === selected ? 'sel' : ''}"><span class="gr" style="color:${g.color}">${g.icon}</span>
      <i style="background:${DOT[r.side]}"></i><span class="n">Coup ${r.ply + 1}</span><span class="th">${TOPICS[r.theme].icon} ${TOPICS[r.theme].label}</span><b style="color:${g.color}">−${Math.round(r.loss)} %</b></li>`;
  }).join('')}</ol>`;
}

export function renderList(items, selected) {
  const done = items.filter(Boolean).length;
  return `<details class="rv-all"><summary>Tous les coups analysés (${done})</summary><ol class="rv-list">${items.map((r, i) => {
    if (!r) return `<li class="pending" data-i="${i}"><span class="sp"></span>analyse…</li>`;
    const g = gradeOf(r.grade);
    return `<li data-i="${i}" class="${i === selected ? 'sel' : ''}"><span class="n">${r.ply + 1}.</span><i style="background:${DOT[r.side]}"></i>
      <span class="mv">${esc(moveText(r.before, r.move, r.ctx))}</span><span class="gr" style="color:${g.color}" title="${g.label}">${g.icon}</span></li>`;
  }).join('')}</ol></details>`;
}

// détail d'un coup : chances avant / après, ce qui s'est passé, ce qu'il fallait jouer, et de quoi s'exercer
// nav : { prev, next } (présence des boutons) ; reg : registre des coups cités (coach.js)
export function renderDetail(r, reg, nav = {}) {
  const g = gradeOf(r.grade);
  const head = `<div class="rv-nav"><button class="mini" data-nav="-1"${nav.prev ? '' : ' disabled'} aria-label="Faute précédente">◂</button>
    <span class="rv-grade" style="color:${g.color}">${g.icon} ${g.label} <small>· coup ${r.ply + 1}</small></span>
    <button class="mini" data-nav="1"${nav.next ? '' : ' disabled'} aria-label="Faute suivante">▸</button></div>`;
  const played = reg.chip(r.move, esc(moveText(r.before, r.move, r.ctx)), { tag: 'div', cls: 'rv-move played' });
  if (r.isBest)
    return `<div class="rv-detail">${head}${played}<p class="muted">C’est le coup que le bot aurait joué.</p>
      ${ideaBox(r.bestExpl.idea)}
      <div class="rv-actions"><button class="mini" data-line="played">▶ Voir la suite</button></div></div>`;
  const bestKey = r.bestExpl.reasons.filter(x => x !== r.bestExpl.idea && x.weight >= 10).slice(0, 1);
  return `<div class="rv-detail">${head}
    <p class="rv-odds">Chances de gain : <b>${pct(r.pBest)}</b> → <b style="color:${g.color}">${pct(r.pPlayed)}</b></p>
    <h4><span class="key played"></span>Coup joué</h4>${played}
    ${isError(r) && r.why && !r.missed ? `<p class="rv-why">${esc(r.why)}</p>` : ''}
    <h4><span class="key best"></span>Il fallait</h4>${reg.chip(r.best, esc(moveText(r.before, r.best, r.ctx)), { tag: 'div', cls: 'rv-move best' })}
    ${ideaBox(r.bestExpl.idea, 'L’idée')}
    ${reasonList(bestKey, 'reasons key')}
    <div class="rv-actions">
      <button class="mini" data-line="played">▶ Suite du coup joué</button>
      <button class="mini" data-line="best">▶ Suite du meilleur coup</button>
      ${isError(r) ? '<button class="mini gold" data-puzzle>🎯 À vous de trouver</button>' : ''}
    </div>
    ${isError(r) ? principleBox(r.theme) : ''}
  </div>`;
}

// exercice : retrouver un meilleur coup dans la position d'une faute
// pz : { r, tries, msg, tone ('ok' | 'ko' | 'info'), solved, busy }
export function renderPuzzle(pz, reg) {
  const r = pz.r, who = r.ctx.me === r.side ? 'vous' : G.PLAYER_NAMES[r.side];
  const msg = pz.busy ? '<p class="pz-msg info"><span class="spinner"></span> Le bot examine ce coup…</p>'
    : pz.msg ? `<p class="pz-msg ${pz.tone}">${pz.msg}</p>` : '';
  const sol = pz.showSolution ? `<h4><span class="key best"></span>Solution</h4>${reg.chip(r.best, esc(moveText(r.before, r.best, r.ctx)), { tag: 'div', cls: 'rv-move best' })}${ideaBox(r.bestExpl.idea)}` : '';
  return `<div class="rv-detail puzzle">
    <div class="rv-grade">🎯 À vous de trouver <small>· coup ${r.ply + 1}</small></div>
    <p>La partie est revenue avant la faute. Trouvez un meilleur coup pour ${who} : choisissez une pièce, puis sa case d’arrivée.</p>
    ${msg}
    ${pz.hint && !pz.showSolution ? `<p class="pz-msg info">💡 ${esc(r.bestExpl.clue)}</p>` : ''}
    ${sol}
    <div class="rv-actions">
      ${pz.solved || pz.showSolution ? '' : `<button class="mini" data-pz="hint"${pz.hint ? ' disabled' : ''}>💡 Indice</button><button class="mini" data-pz="solution"${pz.tries ? '' : ' disabled'}>Solution</button>`}
      <button class="mini" data-pz="back">Retour à l’analyse</button>
    </div></div>`;
}

// verdict immédiat sur un coup (mode Entraînement) : une ligne, et le détail à la demande
export function renderFeedback(r, reg, { open = false, blocking = false } = {}) {
  const g = gradeOf(r.grade);
  const err = isError(r);
  const line = r.isBest ? 'C’est le coup que le bot aurait joué.'
    : !err ? `Presque aussi bon que le meilleur coup (−${Math.round(r.loss)} %).`
    : r.why;
  const more = open && err ? `<div class="fb-more">
      <p class="rv-odds">Chances de gain : <b>${pct(r.pBest)}</b> → <b style="color:${g.color}">${pct(r.pPlayed)}</b></p>
      <h4><span class="key best"></span>Il fallait</h4>${reg.chip(r.best, esc(moveText(r.before, r.best, r.ctx)), { tag: 'div', cls: 'rv-move best' })}
      ${r.missed ? '' : ideaBox(r.bestExpl.idea)}
      ${principleBox(r.theme)}</div>` : '';
  const actions = err ? `<div class="fb-actions">
      <button class="mini" data-fb="undo">↶ Reprendre le coup</button>
      ${open ? '' : '<button class="mini" data-fb="why">Pourquoi ?</button>'}
      <button class="mini${blocking ? ' gold' : ''}" data-fb="go">${blocking ? 'Continuer quand même' : 'OK'}</button></div>` : '';
  return `<div class="fb-line"><span class="fb-grade" style="color:${g.color}">${g.icon} ${g.label}</span><span class="fb-text">${esc(line)}</span></div>${more}${actions}`;
}
