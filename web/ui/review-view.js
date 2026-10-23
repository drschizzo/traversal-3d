// Mise en page du jugement des coups (coach/review.js) : bilan, moments clés, détail d'une faute, exercice,
// verdict immédiat de l'entraînement
import { PLAYER_NAMES } from '../i18n/fr.js';
import { TOPICS, guideUrl } from '../coach/topics.js';
import { GRADES, summary, isError } from '../coach/review.js';
import { moveText, pct, plural } from '../coach/wording.js';
import { ideaBox, reasonList, principleBox } from './coach-view.js';
import { esc, rich } from './html.js';
import { DOT } from '../colors.js';

// apparence de chaque catégorie de coup
const GRADE_STYLE = {
  best: { icon: '★', color: '#7fe39a' },
  excellent: { icon: '✓', color: '#9be7c4' },
  inaccuracy: { icon: '?!', color: '#f2c46d' },
  good: { icon: '✓', color: '#c9d6a3' },
  mistake: { icon: '?', color: '#f0955a' },
  blunder: { icon: '??', color: '#ef5b5b' },
};
const gradeOf = id => ({ ...GRADES.find(g => g.id === id), ...GRADE_STYLE[id] });
const styledGrades = () => GRADES.map(g => gradeOf(g.id));

export function renderSummary(items, sides, names, hints = 0) {
  return sides.map(side => {
    const s = summary(items, side);
    if (!s) return '';
    const chips = styledGrades().filter(g => s.counts[g.id]).map(g => `<span class="chip" style="--c:${g.color}">${g.icon} ${s.counts[g.id]} ${g.short}${s.counts[g.id] > 1 ? 's' : ''}</span>`).join('');
    const bar = styledGrades().filter(g => s.counts[g.id]).map(g => `<i style="flex:${s.counts[g.id]};background:${g.color}" title="${g.label} : ${s.counts[g.id]}"></i>`).join('');
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
  const r = pz.r, who = r.ctx.me === r.side ? 'vous' : PLAYER_NAMES[r.side];
  const msg = pz.busy ? '<p class="pz-msg info"><span class="spinner"></span> Le bot examine ce coup…</p>'
    : pz.msg ? `<p class="pz-msg ${pz.tone}">${rich(pz.msg)}</p>` : '';
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

// progression d'une partie à l'autre (coach/progress.js) : tendance en fin d'analyse, et résumé dans le menu
export function renderTrend(p) {
  if (!p || p.games < 2) return '';
  const trend = p.prev === null ? '' : p.acc > p.prev ? ` <b class="up">↑ ${p.acc - p.prev}</b>` : p.acc < p.prev ? ` <b class="down">↓ ${p.prev - p.acc}</b>` : ' <span class="muted">(stable)</span>';
  return `<p class="rv-trend">📈 Précision moyenne sur vos ${p.n} dernières parties analysées : <b>${p.acc} %</b>${trend}${p.theme ? `<br>À travailler en priorité : ${TOPICS[p.theme].icon} ${TOPICS[p.theme].label}` : ''}</p>`;
}
export const renderMenuProgress = p =>
  `📈 ${plural(p.games, 'partie')} analysée${p.games > 1 ? 's' : ''} · précision ${p.acc} %${p.theme ? ` · à travailler : ${TOPICS[p.theme].label}` : ''}`;
