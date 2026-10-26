// Menu : mode de jeu, couleur, niveau, monde (terrain, thème, qualité graphique), partie en cours,
// confirmation d'abandon, et boutons de la partie qui ramènent au menu ou en sortent
import { TERRAINS, CODE_RE, normalizeCode } from '../../core/index.js';
import { TERRAIN_NAMES } from '../i18n/fr.js';
import { progressStats } from '../coach/progress.js';
import { renderMenuProgress } from './review-view.js';
import { startReview } from '../session/review.js';
import * as R from '../render/index.js';
import * as Sound from '../audio/sound.js';
import { load, save } from '../storage.js';
import { S, cfg, mode, gameActive, gameAtStake } from '../session/store.js';
import { startGame, enterGame, abandonGame, previewTerrain, resetBoard } from '../session/game.js';
import { startOnline, proposeRematch } from '../session/online.js';
import { undo } from '../session/turns.js';
import { hint } from '../session/hint.js';
import { toggleTraining } from '../session/training.js';
import { matchLink } from '../session/links.js';
import { $, shown, icon } from './dom.js';
import { autoFullscreen, toast, layoutHud, setTools } from './hud.js';
import { copyText } from './clipboard.js';

// ---------------------------------------------------------------- choix du menu
const startLabel = () => `${cfg.mode !== 'pvp' || cfg.where === 'local' ? 'Jouer' : cfg.where === 'create' ? 'Créer le salon' : 'Rejoindre le salon'} <span aria-hidden="true">→</span>`;

export function showModeOptions() {
  const toggle = (sel, hidden) => document.querySelectorAll(sel).forEach(el => el.classList.toggle('hidden', hidden));
  toggle('.side-opt', !(cfg.mode === 'bot' || (cfg.mode === 'pvp' && cfg.where === 'create')));
  toggle('.bots-only', cfg.mode === 'pvp');
  toggle('.pvp-only', cfg.mode !== 'pvp');
  toggle('.join-only', !(cfg.mode === 'pvp' && cfg.where === 'join'));
  // un salon rejoint impose son monde : la carte du monde ne sert qu'à celui qui le crée
  $('worldCard').classList.toggle('hidden', cfg.mode === 'pvp' && cfg.where === 'join');
  if (!gameActive()) $('btnStart').innerHTML = startLabel();
}

// reflète l'état de la session dans le menu : sélecteurs, monde affiché, boutons (annonce « menu »)
export function syncMenu(joinCode = null) {
  document.querySelectorAll('.seg[data-key]').forEach(seg => {
    const key = /** @type {HTMLElement} */ (seg).dataset.key;
    if (key in cfg) seg.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x.dataset.v === String(cfg[key])));
  });
  if (joinCode) $('joinCode').value = joinCode;
  if (S.worldTerrain) {
    $('menuWorld').textContent = `Monde n° ${S.worldSeed.toLocaleString('fr-FR')}`;
    $('menuTerrain').textContent = TERRAIN_NAMES[S.worldTerrain];
  }
  showProgress();
  showModeOptions();
  updateMenuButtons();
}

// bilan des dernières parties analysées, sous les réglages du menu
function showProgress() {
  const p = progressStats(load('progress')), el = $('menuProgress');
  el.classList.toggle('hidden', !p);
  if (p) el.innerHTML = renderMenuProgress(p);
}

// partie en cours : « Reprendre » devient l'action principale, « Jouer » propose une nouvelle partie,
// et les réglages de la partie (mode, couleur, niveau) sont figés
const LOCKED_KEYS = ['mode', 'side', 'level', 'where'];
export function updateMenuButtons() {
  const active = gameActive();
  LOCKED_KEYS.forEach(k => {
    const seg = /** @type {HTMLElement} */ (document.querySelector(`.seg[data-key="${k}"]`));
    seg.classList.toggle('locked', active);
    seg.title = active ? 'Réglage de la partie en cours' : '';
  });
  $('btnResume').classList.toggle('hidden', !active);
  $('btnStart').classList.toggle('primary', !active);
  $('btnStart').classList.toggle('play', !active);
  $('btnStart').classList.toggle('ghost', active);
  $('btnStart').innerHTML = active ? 'Nouvelle partie' : startLabel();
}

// on entre dans la partie : le menu s'efface, l'écran de jeu s'affiche
export function enterView() {
  $('menu').classList.add('hidden');
  updateMenuShift();
  $('hud').classList.remove('hidden');
  layoutHud();
}

// on quitte la partie : barre d'outils repliée, écran de jeu caché (le menu revient par openMenu)
export function leaveView() {
  setTools(false);
  $('hud').classList.add('hidden');
}

export function openMenu() {
  R.panTo(0, 0, 0.8);
  updateMenuButtons();
  $('menu').classList.remove('hidden');
  updateMenuShift();
}

// ---------------------------------------------------------------- confirmation d'abandon
// avant une action qui remplace la partie entamée : confirmation, puis abandon de la partie
let confirmResolve = null;
function confirmAbandon() {
  if (!gameAtStake()) {
    if (S.inGame) abandonGame();
    return Promise.resolve(true);
  }
  $('confirm').classList.remove('hidden');
  $('btnConfirmCancel').focus();
  return new Promise(res => { confirmResolve = res; });
}
export function closeConfirm(ok) {
  $('confirm').classList.add('hidden');
  if (ok) abandonGame();
  confirmResolve?.(ok);
  confirmResolve = null;
}

// ---------------------------------------------------------------- vue décalée à côté des panneaux
// Sur grand écran, la vue 3D glisse pour rester dégagée : vers la droite à côté du menu,
// vers la gauche quand un panneau d'analyse occupe la droite.
function menuShiftTarget() {
  if (innerWidth < 900 || R.compactMQ.matches) return 0;
  if (shown('menu')) return Math.round($('menuPanel').getBoundingClientRect().right / 2);
  if (!shown('hud')) return 0;
  const panel = [$('coach'), $('review')].find(el => !el.classList.contains('hidden'));
  if (!panel || panel.offsetHeight < innerHeight * 0.4) return 0; // un panneau court ne couvre que le fond du plateau
  // juste assez pour dégager le plateau du panneau, sans le faire sortir à gauche
  const half = R.boardHalfWidthPx(), free = panel.getBoundingClientRect().left - 12;
  const need = innerWidth / 2 + half - free, room = innerWidth / 2 - half - 12;
  return -Math.round(Math.max(0, Math.min(need, room)));
}
export function updateMenuShift(animated = true) { R.shiftView(menuShiftTarget(), animated); }

// ---------------------------------------------------------------- son
// le dernier volume choisi, que le bouton de la barre d'outils rétablit après l'avoir coupé
let lastVolume = Sound.soundLevel() === 'off' ? 'mid' : Sound.soundLevel();
function setSound(v) {
  if (v !== 'off') lastVolume = v;
  Sound.setSoundLevel(v);
  showSoundChoice();
  Sound.select(); // un aperçu du volume choisi (et le geste qui ouvre le son)
}
function showSoundChoice() {
  const v = Sound.soundLevel(), off = v === 'off';
  document.querySelectorAll('#soundSeg button').forEach(b => b.classList.toggle('sel', /** @type {HTMLElement} */ (b).dataset.v === v));
  $('btnSound').innerHTML = `${icon(off ? 'mute' : 'sound')}<span>Son</span>`;
  $('btnSound').title = off ? 'Rétablir le son' : 'Couper le son';
  $('btnSound').classList.toggle('on', !off);
}

// ---------------------------------------------------------------- qualité graphique
function showQualityChoice() {
  const q = R.qualityState();
  document.querySelectorAll('#qualitySeg button').forEach(b => b.classList.toggle('sel', /** @type {HTMLElement} */ (b).dataset.v === q.pref));
  $('qualityAuto').textContent = q.pref === 'auto' ? `Auto · ${q.name}` : 'Auto';
}

export function initMenu() {
  // terrains et thèmes
  $('terrainSeg').innerHTML = TERRAINS.map(v => `<button data-v="${v}" class="${v === cfg.terrain ? 'sel' : ''}">${TERRAIN_NAMES[v]}</button>`).join('');
  // sélecteur de thème : une pastille par thème — anneau extérieur = décor (ciel, brume, lueur),
  // disque central = plateau (relief bas → haut). Le nom s'affiche au survol et pour le thème choisi.
  const current = () => R.currentTheme().id;
  $('themeSeg').innerHTML = R.THEMES.map(t => {
    const ring = `conic-gradient(from 200deg, ${t.skyTop}, ${t.field.mid}, ${t.glows[2]}, ${t.field.high}, ${t.skyTop})`;
    const core = `linear-gradient(135deg, ${t.terrain.top[1]}, ${t.terrain.top[4]} 55%, ${t.terrain.top[7]})`;
    return `<button data-v="${t.id}" title="${t.name}" aria-label="Thème ${t.name}" class="${t.id === current() ? 'sel' : ''}" style="background:${ring}"><i style="background:${core}"></i></button>`;
  }).join('');
  const showThemeName = id => { $('themeName').textContent = 'Thème ' + R.themeById(id).name; };
  showThemeName(current());
  $('themeSeg').querySelectorAll('button').forEach(b => {
    b.addEventListener('mouseenter', () => showThemeName(b.dataset.v));
    b.addEventListener('mouseleave', () => showThemeName(current()));
  });

  // sélecteurs (mode, couleur, niveau, où jouer, terrain, thème)
  document.querySelectorAll('.seg').forEach(seg => {
    seg.addEventListener('click', async e => {
      const b = /** @type {HTMLElement} */ (e.target).closest('button');
      if (!b) return;
      const key = /** @type {HTMLElement} */ (seg).dataset.key;
      // changer de terrain tire un nouveau monde ; mode, couleur et niveau sont figés pendant la partie :
      // dans les deux cas, la partie en cours serait perdue
      if ((key === 'terrain' || seg.classList.contains('locked')) && (b.classList.contains('sel') || !(await confirmAbandon()))) return;
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
      cfg[key] = key === 'side' ? Number(b.dataset.v) : b.dataset.v;
      if (key === 'mode' || key === 'where') showModeOptions();
      if (key === 'where' && cfg.where === 'join') $('joinCode').focus();
      if (key === 'terrain') previewTerrain();
      if (key === 'theme') { save('theme', R.applyTheme(b.dataset.v).id); showThemeName(current()); }
    });
  });

  $('btnConfirmOk').onclick = () => closeConfirm(true);
  $('btnConfirmCancel').onclick = () => closeConfirm(false);

  $('btnStart').onclick = async () => {
    autoFullscreen(); // avant toute attente : le navigateur n'accepte le plein écran que pendant le geste
    const wasOnline = gameActive() && mode().remote;
    if (!(await confirmAbandon())) return;
    // partie en ligne quittée : on revient au menu, sans enchaîner aussitôt sur la création d'un salon
    if (wasOnline) {
      cfg.where = 'local';
      syncMenu();
      return;
    }
    if (cfg.mode === 'pvp' && cfg.where !== 'local') {
      // le code du salon appartient au menu : il est validé ici avant d'ouvrir la connexion
      if (cfg.where === 'join') {
        const code = normalizeCode($('joinCode').value);
        $('joinCode').value = code;
        if (!CODE_RE.test(code)) { toast('Le code du salon fait six lettres.'); $('joinCode').focus(); return; }
        return startOnline('join', code);
      }
      return startOnline('create');
    }
    startGame();
  };
  $('btnCustomize').onclick = () => {
    const open = $('worldCard').classList.toggle('open');
    $('btnCustomize').setAttribute('aria-expanded', String(open));
    $('btnCustomize').textContent = open ? 'Fermer' : 'Personnaliser';
  };
  $('btnReroll').onclick = async () => { if (await confirmAbandon()) previewTerrain(); };
  $('qualitySeg').onclick = e => { const b = /** @type {HTMLElement} */ (e.target).closest('button'); if (b) R.setQualityPref(b.dataset.v); };
  showQualityChoice();
  $('soundSeg').onclick = e => { const b = /** @type {HTMLElement} */ (e.target).closest('button'); if (b) setSound(b.dataset.v); };
  $('btnSound').onclick = () => setSound(Sound.soundLevel() === 'off' ? lastVolume : 'off');
  showSoundChoice();
  R.onQualityChange((level, auto) => {
    showQualityChoice();
    if (auto && shown('hud')) toast(`Qualité graphique ajustée : ${R.qualityState().name}`);
  });
  $('btnResume').onclick = () => {
    autoFullscreen();
    // partie restaurée au chargement : on y entre ; sinon on referme simplement le menu
    if (!shown('hud')) return enterGame(600);
    $('menu').classList.add('hidden');
    updateMenuShift();
  };
  $('btnMenuRules').onclick = $('btnRules').onclick = () => $('rules').classList.remove('hidden');
  $('btnCloseRules').onclick = () => $('rules').classList.add('hidden');

  // barre d'outils de la partie
  $('btnMenu').onclick = openMenu;
  $('btnUndo').onclick = undo;
  $('btnHint').onclick = hint;
  $('btnTrain').onclick = toggleTraining;
  $('btnView').onclick = () => { S.viewSide = 1 - S.viewSide; R.turnCameraTo(S.viewSide); };
  $('btnHeights').onclick = () => {
    S.showHeights = !S.showHeights;
    $('btnHeights').classList.toggle('on', S.showHeights);
    R.showHeights(S.showHeights);
  };
  $('btnLink').onclick = () => copyText(matchLink(), 'Lien de la partie copié.');

  // fin de partie
  $('btnAgain').onclick = () => {
    if (mode().remote) return proposeRematch();
    $('over').classList.add('hidden'); previewTerrain(); startGame();
  };
  // retour au menu après la partie : le même monde, pièces au départ, prêt pour une revanche
  $('btnOverMenu').onclick = () => { $('over').classList.add('hidden'); abandonGame(); resetBoard(); openMenu(); };
  $('btnOverBoard').onclick = () => $('over').classList.add('hidden');
  $('btnReview').onclick = startReview;
}
