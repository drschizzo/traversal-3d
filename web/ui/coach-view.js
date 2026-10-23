// Mise en page des explications (coach/explain.js) : panneau d'analyse, conseil en trois temps
import { PLAYER_NAMES } from '../i18n/fr.js';
import { TOPICS, guideUrl } from '../coach/topics.js';
import { pct, plural } from '../coach/wording.js';
import { esc, rich } from './html.js';
import { DOT } from '../colors.js';

// icône d'une raison : celle de son thème si elle est positive, un avertissement si elle est négative
const reasonIcon = r => (r.tone === 'bad' ? '⚠️' : r.tone === 'info' ? '·' : TOPICS[r.theme].icon);

// les coups cités dans un panneau sont montrés sur le plateau au survol (ou au toucher) : chaque panneau
// enregistre les siens, et la page relie ensuite les éléments [data-mv] à leur coup
export function moveRegistry() {
  const list = [];
  const chip = (m, html, { tag = 'span', cls = '', attrs = '' } = {}) =>
    `<${tag} class="mv-chip${cls ? ' ' + cls : ''}" data-mv="${list.push(m) - 1}"${attrs}>${html}</${tag}>`;
  return { list, chip };
}

export const reasonList = (list, cls = 'reasons') =>
  list.length ? `<ul class="${cls}">${list.map(r => `<li class="${r.tone}"><span class="ic">${reasonIcon(r)}</span><span>${rich(r.text)}</span></li>`).join('')}</ul>` : '';

export const ideaBox = (idea, kicker = 'L’idée') =>
  `<div class="idea ${idea.tone}"><span class="ic">${TOPICS[idea.theme].icon}</span><div><small>${kicker}</small><b>${esc(idea.idea)}</b></div></div>`;

export const principleBox = theme =>
  `<div class="principle"><span>${TOPICS[theme].icon}</span><p><b>${TOPICS[theme].label}.</b> ${TOPICS[theme].principle} <a href="${guideUrl(theme)}" target="_blank" rel="noopener">Le guide ↗</a></p></div>`;

const fmtNodes = n => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : n >= 1000 ? Math.round(n / 1000) + ' k' : String(n));

function evalBar(pRed) {
  return `<div class="eval-bar" title="Chances de gain estimées"><i style="width:${(pRed * 100).toFixed(1)}%"></i>
    <span class="l">Rouge ${pct(pRed)}</span><span class="r">${pct(1 - pRed)} Bleu</span></div>`;
}

// le reste de l'analyse, replié sous l'idée : raisons secondaires, suite prévue, coups écartés
function detailsHtml(a, reg, history, { skip = null, open = false } = {}) {
  const rest = a.reasons.filter(r => r !== skip && r.weight > 0);
  const plan = a.plan.length
    ? `<ol class="plan">${a.plan.map((p, i) => reg.chip(p.move, `<i style="background:${DOT[p.side]}"></i>${esc(p.text)}`, { tag: 'li', attrs: ` data-plan="${i}"` })).join('')}</ol>`
    : '<p class="muted">Pas de suite calculée au-delà de ce coup.</p>';
  const alts = a.alts.length
    ? `<ul class="alts">${a.alts.map(x => reg.chip(x.move, `<span>${esc(x.text)}</span><b>${esc(x.cost)}</b>`, { tag: 'li' })).join('')}</ul>` : '';
  return `<details${open ? ' open' : ''}><summary>Plus de détails</summary>
    ${evalBar(a.verdict.pRed)}
    <p class="verdict">${rich(a.verdict.text)}</p>
    ${sparkline(history)}
    ${rest.length ? `<h4>Toutes les raisons</h4>${reasonList(rest)}` : ''}
    <h4>Suite prévue <button class="mini" id="coachPlanBtn">Voir sur le plateau</button></h4>${plan}
    ${alts ? `<h4>Coups écartés</h4>${alts}` : ''}
    <p class="muted foot">${plural(a.depth, 'coup')} d’avance · ${fmtNodes(a.nodes)} position${a.nodes > 1 ? 's' : ''} examinée${a.nodes > 1 ? 's' : ''}${a.noisy ? ' · à ce niveau, le bot ajoute volontairement du hasard' : ''}</p>
  </details>`;
}

// explication d'un coup joué (bot, ou coup revu en bot contre bot) : l'idée en tête, deux raisons, le reste replié
export function renderAnalysis(a, reg, { label = '', history = [], compact = false } = {}) {
  const key = a.reasons.filter(r => r !== a.idea && r.weight >= 10).slice(0, compact ? 1 : 2);
  return `
    <div class="coach-head"><span class="tag">${esc(label)}</span><span class="who" style="color:${DOT[a.side]}">${PLAYER_NAMES[a.side]}</span></div>
    ${reg.chip(a.move, esc(a.title), { tag: 'div', cls: 'coach-move' })}
    ${ideaBox(a.idea)}
    ${reasonList(key, 'reasons key')}
    ${detailsHtml(a, reg, history, { skip: a.idea })}`;
}

// conseil en trois temps : une piste, puis la pièce, puis le coup
const HINT_STEPS = ['Piste', 'La pièce', 'Le coup'];
export function renderHint(a, level, reg, { history = [] } = {}) {
  const steps = `<div class="hint-steps">${HINT_STEPS.map((s, i) => `<span class="${i < level ? 'on' : ''}">${i + 1}. ${s}</span>`).join('')}</div>`;
  let body;
  if (level === 1) body = `<div class="what">${esc(a.clue)}</div>
    <p class="muted">Cherchez d’abord par vous-même. Besoin d’aide ?</p>
    <div class="hint-cta"><button class="mini" data-hint="2">Montrer la pièce</button><button class="mini" data-hint="3">Montrer le coup</button></div>`;
  else if (level === 2) body = `<div class="what">Jouez ${esc(a.pieceRef)}</div>
    <p class="muted">${esc(a.clue)} Ses cases accessibles sont éclairées : à vous de choisir la bonne.</p>
    <div class="hint-cta"><button class="mini" data-hint="3">Montrer le coup</button></div>`;
  else body = `${reg.chip(a.move, esc(a.advice), { tag: 'div', cls: 'what' })}
    ${ideaBox(a.idea, 'Pourquoi')}
    ${reasonList(a.reasons.filter(r => r !== a.idea && r.weight >= 10).slice(0, 2), 'reasons key')}
    <div class="hint-cta"><button class="accent" id="coachPlayHint">Jouer ce coup</button></div>`;
  return `
    <div class="coach-head"><span class="tag">Conseil</span><span class="who" style="color:${DOT[a.side]}">${PLAYER_NAMES[a.side]}</span></div>
    ${steps}
    <div class="hint-box">${body}</div>
    ${level === 3 ? detailsHtml(a, reg, history, { skip: a.idea }) : ''}`;
}

// courbe des chances de Rouge au fil de la partie
function sparkline(history) {
  if (history.length < 2) return '';
  const W = 290, H = 46, maxPly = Math.max(20, history[history.length - 1].ply);
  const pts = history.map(h => `${(h.ply / maxPly * W).toFixed(1)},${((1 - h.pRed) * H).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Chances de gain de Rouge au fil de la partie">
    <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"/><polyline points="${pts}"/></svg>`;
}
