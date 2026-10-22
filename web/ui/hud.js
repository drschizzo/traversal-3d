// Interface de la partie : tableau des scores, message d'état, fiche de pièce, infobulles, annonces,
// placement de la barre d'outils, plein écran
import * as G from '../../core/index.js';
import { TYPE_NAMES, TYPE_GLYPHS, TYPE_DESC, PLAYER_NAMES, LEVEL_NAMES } from '../i18n/fr.js';
import * as R from '../render/index.js';
import { S, play, mode } from '../session/store.js';
import { $, isTouch } from './dom.js';
import { TEAM } from './colors.js';
import { load, save } from '../storage.js';

export function setStatus(text, side, thinking = false) {
  $('statusText').textContent = text;
  $('statusDot').style.background = TEAM[side].css;
  $('statusDot').className = thinking ? 'spinner' : 'dot';
  if (thinking) $('statusDot').style.background = 'transparent';
}

export function updateHUD() {
  const s = S.state;
  $('score0').textContent = s.score[0];
  $('score1').textContent = s.score[1];
  $('ply').textContent = s.ply;
  $('crossed').textContent = s.crossed;
  for (let o = 0; o < 2; o++) {
    $('side' + o).classList.toggle('active', !s.over && s.turn === o);
    $('lost' + o).textContent = s.pieces.filter(p => p.o === o && p.st === G.CAPTURED).map(p => TYPE_GLYPHS[p.t]).join('') || '—';
  }
  $('btnUndo').disabled = !S.history.length;
}

// noms des camps au tableau des scores
export function setNames() {
  const m = mode(), bot = `Bot ${LEVEL_NAMES[play.level]}`;
  for (let o = 0; o < 2; o++) {
    let name = PLAYER_NAMES[o];
    if (m.remote) name = `${o === play.side ? 'Vous' : 'Adversaire'} · ${name}`;
    else if (m.seated) name = `${o === play.side ? 'Joueur' : bot} · ${name}`;
    else if (!m.humans) name = bot;
    $('name' + o).textContent = name;
  }
}

// fiche de la pièce sélectionnée ou survolée (−1 : aucune)
export function showCard(pi) {
  const card = $('card');
  if (pi < 0) { card.classList.add('hidden-soft'); return; }
  const s = S.state, p = s.pieces[pi], pips = R.currentTheme().pips || R.PIP_DEFAULT;
  card.innerHTML = `
    <div class="head"><span class="glyph" style="color:${TEAM[p.o].css}">${TYPE_GLYPHS[p.t]}</span>
      <div><div class="title">${TYPE_NAMES[p.t]}</div><div class="owner">${PLAYER_NAMES[p.o]} · hauteur ${s.h[G.idx(p.x, p.y)]}</div></div></div>
    ${S.previewing && pi === S.selected ? '<div class="preview-tag">Aperçu de ses coups · non jouables</div>' : ''}
    <div class="stats"><div class="stat"><b>${G.MOVE[p.t]}</b><span><i style="background:${pips.base.color}"></i>Mouvement</span></div><div class="stat"><b>${G.STR[p.t]}</b><span><i style="background:${pips.top.color}"></i>Force</span></div></div>
    <p>${TYPE_DESC[p.t]}</p>`;
  card.classList.remove('hidden-soft');
}

// au doigt, pas d'infobulle : le chemin tracé sous le doigt suffit
export function showTip(html, e) {
  if (isTouch(e)) return hideTip();
  const tip = $('tip');
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(e.clientX, innerWidth - w - 24) + 'px';
  tip.style.top = Math.min(e.clientY, innerHeight - h - 24) + 'px';
}
export function hideTip() { $('tip').classList.add('hidden'); }

// infobulle d'un coup : coût, sortie, ou détail du combat
export function showMoveTip(m, e) {
  const s = S.state, p = s.pieces[m.pi];
  const sp = m.special === 'diag' ? 'Pas en diagonale' : m.special === 'jump' ? 'Bond de 2 cases' : null;
  if (m.kind === 'move') return showTip(`${sp || `Coût : <b>${m.cost}</b> / ${G.MOVE[p.t]}`}`, e);
  if (m.kind === 'exit') return showTip(`<b style="color:#ffd36b">Franchir l’arrivée</b><br>+${G.STR[p.t]} point${G.STR[p.t] > 1 ? 's' : ''}${p.t === G.SENTINEL && s.crossed === 0 ? '<br><b>Victoire immédiate !</b>' : ''}`, e);
  const c = m.combat, d = s.pieces[c.defender];
  const sign = n => (n > 0 ? '+' + n : String(n));
  const rows = [[`${TYPE_NAMES[p.t]}`, c.base]];
  if (c.height) rows.push([c.height > 0 ? 'Avantage de hauteur' : 'Attaque en montée', sign(c.height)]);
  if (c.vb) rows.push(['Charge de l’Avant-garde', '+1']);
  if (c.allies) rows.push(['Alliés adjacents', '+' + c.allies]);
  const drows = [[TYPE_NAMES[d.t], c.dBase]];
  if (c.reinf) drows.push(['Renforts', '+' + c.reinf]);
  const tbl = r => `<table>${r.map(([a, b]) => `<tr><td>${a}</td><td class="n">${b}</td></tr>`).join('')}</table>`;
  showTip(`${sp ? `<i>${sp}</i><br>` : ''}<b style="color:${TEAM[p.o].css}">Attaque ${c.att}</b>${tbl(rows)}<b style="color:${TEAM[d.o].css}">Défense ${c.def}</b>${tbl(drows)}<span class="ok">Capture ✓</span>`, e);
}

let toastTimer = 0;
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

// Barre d'outils : sur la ligne du tableau des scores (avec libellés, sinon en icônes) si elle tient à sa droite
// sans le toucher, sinon en bas au centre ; sur téléphone, repliée derrière son bouton (placement par la feuille de style).
// Les panneaux d'analyse se placent sous ce qui occupe le haut.
export function layoutHud() {
  const hud = $('hud');
  if (hud.classList.contains('hidden')) return;
  const tb = $('toolbar'), sb = $('scoreboard').getBoundingClientRect(), css = document.documentElement.style;
  if (R.compactMQ.matches) {
    hud.dataset.tb = 'compact';
    css.setProperty('--panel-top', `${Math.round(sb.bottom + 10)}px`);
    css.setProperty('--panel-gap', '80px');
    return;
  }
  let place = 'bottom';
  for (const m of ['full', 'icons']) {
    hud.dataset.tb = m;
    if (innerWidth - 16 - tb.offsetWidth >= sb.right + 16) { place = m; break; }
  }
  hud.dataset.tb = place;
  // les panneaux d'analyse commencent sous le tableau des scores et la barre d'outils
  let below = sb.bottom;
  if (place === 'bottom') {
    css.setProperty('--panel-gap', '140px');
  } else {
    const top = sb.top + (sb.height - tb.offsetHeight) / 2; // centrée verticalement sur le tableau des scores
    css.setProperty('--tb-top', `${Math.round(top)}px`);
    css.setProperty('--panel-gap', '80px');
    below = Math.max(below, top + tb.offsetHeight);
  }
  css.setProperty('--panel-top', `${Math.round(below + 10)}px`);
}

// téléphones : la barre d'outils s'ouvre en liste depuis son bouton et se referme après un choix
export function setTools(open) {
  $('hud').classList.toggle('tools-open', open);
  $('btnTools').setAttribute('aria-expanded', open);
}

// plein écran : bouton dans la barre d'outils, et automatique au lancement d'une partie sur téléphone.
// L'iPhone n'autorise pas une page en plein écran : seul l'ajout à l'écran d'accueil masque la barre d'adresse.
// (anciens Safari : API préfixée webkit, et navigator.standalone pour une page ajoutée à l'écran d'accueil)
const root = /** @type {any} */ (document.documentElement), doc = /** @type {any} */ (document);
const canFullscreen = !!(root.requestFullscreen || root.webkitRequestFullscreen);
const installed = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;
const isFullscreen = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement);
function enterFullscreen() {
  const req = root.requestFullscreen || root.webkitRequestFullscreen;
  try { Promise.resolve(req.call(root, { navigationUI: 'hide' })).catch(() => {}); } catch {}
}
function toggleFullscreen() {
  if (isFullscreen()) return void (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
  if (canFullscreen) return enterFullscreen();
  toast('Pour jouer en plein écran : bouton Partager, puis « Sur l’écran d’accueil »');
}
export function autoFullscreen() { if (R.compactMQ.matches && canFullscreen && !installed && !isFullscreen()) enterFullscreen(); }

export function initHud({ onCompactChange }) {
  document.fonts?.ready.then(layoutHud);
  $('btnTools').onclick = () => setTools(!$('hud').classList.contains('tools-open'));
  // les commandes de lecture (⏮ ◀ ⏸ ▶ ⏭) laissent la liste ouverte pour enchaîner les appuis
  const KEEP_TOOLS = ['btnFirst', 'btnPrev', 'btnPlay', 'btnNext', 'btnLast'];
  $('toolbar').addEventListener('click', e => { const b = /** @type {HTMLElement} */ (e.target).closest('button'); if (b && !KEEP_TOOLS.includes(b.id)) setTools(false); });
  R.compactMQ.addEventListener?.('change', () => { setTools(false); layoutHud(); onCompactChange(); });

  $('btnFull').classList.toggle('hidden', installed);
  $('btnFull').onclick = toggleFullscreen;
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange'])
    document.addEventListener(ev, () => { $('btnFull').classList.toggle('on', isFullscreen()); layoutHud(); });

  // portrait sur téléphone : invitation à passer en paysage ; une fois écartée, elle ne revient plus
  if (load('rotateOk')) $('rotateHint').classList.add('dismissed');
  $('btnRotateOk').onclick = () => {
    $('rotateHint').classList.add('dismissed');
    save('rotateOk', true);
  };
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => layoutHud());
    ro.observe(document.documentElement);
    ro.observe($('scoreboard'));
  }
}
