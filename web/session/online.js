// Partie en ligne (net.js, server/worker.js). Le serveur fait foi : un coup du joueur est envoyé (phase sending),
// puis joué quand le serveur le renvoie aux deux joueurs. Les coups reçus attendent dans queue que l'animation
// en cours se termine.
import * as G from '../../core/index.js';
import { PLAYER_NAMES, rejectText, errorText } from '../i18n/fr.js';
import * as R from '../render/index.js';
import * as Net from '../net.js';
import { S, cfg, play, phase, mode, isHuman, liveNow } from './store.js';
import { installGame, enterGame, abandonGame } from './game.js';
import { nextTurn, performMove } from './turns.js';
import { $, shown } from '../ui/dom.js';
import { setStatus, updateHUD, toast } from '../ui/hud.js';
import { updateControls } from '../ui/controls.js';
import { clearSelection } from '../ui/input.js';
import { syncMenuChoices, updateMenuButtons, openMenu } from '../ui/menu.js';
import { copyText } from '../ui/clipboard.js';

let net = null, queue = [], result = null, opponentHere = false;
let rematchAsked = false, rematchOffered = false;
// salon en cours d'ouverture : 'create' ou 'join' (fenêtre du salon affichée), 'resume' (reprise au chargement)
let lobbyIntent = null;

function openRoom(code, token) {
  net = Net.connect(code, token, { onMessage: onNet, onStatus: onNetStatus });
}

export function leaveRoom(resign) {
  if (!net) return;
  if (resign) net.send({ type: 'resign' });
  net.close();
  net = null;
  queue = [];
  Net.saveSession(null);
}

function resync() {
  if (!net) return;
  const { code, token } = net;
  net.close();
  openRoom(code, token);
}

// « Créer le salon » ou « Rejoindre le salon » depuis le menu
export async function startOnline(kind) {
  leaveRoom(false);
  if (kind === 'join') {
    const code = Net.normalizeCode($('joinCode').value);
    if (!Net.CODE_RE.test(code)) { toast('Le code du salon fait six lettres.'); $('joinCode').focus(); return; }
    return joinRoom(code);
  }
  lobbyIntent = 'create';
  showLobby('Nouveau salon', 'Création du salon…');
  try {
    const d = await Net.createRoom({ seed: S.worldSeed, terrain: S.worldTerrain, side: cfg.side });
    if (lobbyIntent === 'create') openRoom(d.code, d.token);
  } catch (e) {
    hideLobby();
    toast(e.message);
  }
}

// rejoindre prend toujours la place libre : la reprise d'une place déjà occupée passe par resumeOnline
function joinRoom(code) {
  lobbyIntent = 'join';
  showLobby('Rejoindre un salon', 'Connexion au salon…', code);
  openRoom(code, null);
}

export function joinFromLink(code) {
  Object.assign(cfg, { mode: 'pvp', where: 'join' });
  $('joinCode').value = code;
  syncMenuChoices();
  joinRoom(code);
}

// au chargement : reprise de la partie en ligne en cours, s'il y en a une
export function resumeOnline() {
  const saved = Net.savedSession();
  if (!saved) return;
  lobbyIntent = 'resume';
  openRoom(saved.code, saved.token);
}

function showLobby(title, text, code = '') {
  $('lobbyTitle').textContent = title;
  $('lobbyText').textContent = text;
  $('lobbyCode').textContent = code;
  $('btnLobbyCopy').classList.toggle('hidden', !code || lobbyIntent !== 'create');
  $('lobby').classList.remove('hidden');
}
function hideLobby() {
  $('lobby').classList.add('hidden');
  lobbyIntent = null;
}

function onNet(msg) {
  switch (msg.type) {
    case 'state': return applyNetState(msg);
    case 'move': queue.push(msg); return wakeTurn();
    case 'reject':
      toast(rejectText(msg.code));
      if (phase.is('sending')) phase.to('human');
      return resync();
    case 'over': result = msg; return wakeTurn();
    case 'opponent':
      opponentHere = msg.status === 'joined';
      if (opponentHere && lobbyIntent === 'create') { hideLobby(); enterGame(); return; }
      if (S.inGame && !liveNow().over) toast(opponentHere ? 'Votre adversaire est connecté.' : 'Votre adversaire s’est déconnecté.');
      return wakeTurn();
    case 'rematch':
      rematchOffered = true;
      updateRematchButton();
      toast('Votre adversaire propose une revanche.');
      return;
    case 'error': {
      const quiet = lobbyIntent === 'resume';
      hideLobby();
      leaveRoom(false);
      if (!quiet) toast(errorText(msg.code));
    }
  }
}

function onNetStatus(status, code) {
  const playing = S.inGame && mode().remote;
  if (status === 'reconnecting' && playing) setStatus('Connexion perdue — reconnexion…', liveNow().turn, true);
  if (status !== 'closed') return;
  net = null;
  hideLobby();
  if (code === G.CLOSE.REPLACED) toast('La partie a été ouverte dans un autre onglet.');
  else { Net.saveSession(null); if (code === G.CLOSE.EXPIRED) toast('Le salon a expiré.'); }
  if (playing && !liveNow().over) { abandonGame(); openMenu(); }
}

// relance le tour si rien n'est en cours : partie affichée, pas d'animation, et pas de coup en préparation
function wakeTurn() {
  if (mode().remote && S.inGame && !phase.is('animating') && (!phase.busy() || phase.is('sending')) && shown('hud')) nextTurn();
}

function applyNetState(msg) {
  Net.saveSession({ code: net.code, token: msg.token });
  opponentHere = msg.opponent;
  result = msg.result;
  rematchAsked = !!msg.rematch?.[msg.you];
  rematchOffered = !!msg.rematch?.[1 - msg.you];
  const r = G.replay(msg.seed, msg.terrain, msg.moves);
  if (!r) { toast('Partie illisible.'); hideLobby(); leaveRoom(false); return; }
  const n = S.movesLog.length, mv = msg.moves;
  const same = mode().remote && S.inGame && S.worldSeed === msg.seed && S.worldTerrain === msg.terrain && play.side === msg.you
    && n <= mv.length && S.movesLog.every(({ move: m }, k) => G.sameWire(m, mv[k]));
  if (same) {
    // reconnexion : les coups manqués seront joués dans l'ordre ; un coup envoyé resté sans réponse est à rejouer
    queue = mv.slice(n).map((m, k) => ({ ply: n + k, ...m }));
    if (phase.is('sending')) phase.to('human');
    if (!phase.is('animating') && shown('hud')) nextTurn();
    return;
  }
  const intent = lobbyIntent;
  if (intent === 'resume' && (r.state.over || msg.result)) { lobbyIntent = null; leaveRoom(false); return; } // rien à reprendre
  Object.assign(play, { mode: 'online', side: msg.you, level: cfg.level });
  Object.assign(cfg, { mode: 'pvp', where: cfg.where === 'join' ? 'join' : 'create', side: msg.you });
  syncMenuChoices();
  queue = [];
  $('over').classList.add('hidden');
  installGame(msg.seed, msg.terrain, r);
  updateMenuButtons();
  if (intent === 'resume') {
    lobbyIntent = null;
    toast('Une partie en ligne est en cours : « Reprendre la partie » pour y revenir.');
    return;
  }
  if (intent === 'create' && !msg.opponent && !mv.length) {
    showLobby('Salon créé', 'En attente de votre adversaire…', net.code);
    return;
  }
  hideLobby();
  enterGame();
}

// Tour d'une partie en ligne ; true si le tour est traité ici, false pour la suite habituelle de nextTurn.
// Un coup reçu est joué ; sinon on attend la confirmation de son coup, ou le coup de l'adversaire.
// (jamais pendant l'animation d'un coup : wakeTurn et applyNetState attendent qu'elle finisse, et performMove relance le tour)
export function onlineTurn() {
  const s = S.state;
  queue = queue.filter(m => m.ply >= s.ply);
  const k = queue.findIndex(m => m.ply === s.ply);
  if (k >= 0) {
    const [m] = queue.splice(k, 1);
    const legal = G.findMove(s, m);
    if (!legal) { resync(); return true; }
    performMove(legal, true);
    return true;
  }
  if (phase.is('sending')) return true;
  if (result && !s.over) S.state = G.withResult(s, result);
  if (S.state.over || isHuman(S.state.turn)) return false;
  phase.to('remote');
  updateHUD();
  updateControls();
  setStatus(opponentHere ? `À votre adversaire de jouer (${PLAYER_NAMES[S.state.turn]})…` : 'Votre adversaire est déconnecté : en attente de son retour…', S.state.turn, opponentHere);
  return true;
}

export function sendMove(m) {
  if (phase.is('sending')) return;
  const s = S.state;
  if (!net?.send({ type: 'move', ply: s.ply, ...G.toWire(m) })) { toast('Connexion perdue : coup non envoyé.'); return; }
  phase.to('sending');
  clearSelection();
  setStatus('Coup envoyé…', s.turn, true);
  updateControls();
}

export function proposeRematch() {
  if (!net) return toast('Le salon est fermé.');
  net.send({ type: 'rematch' });
  rematchAsked = true;
  updateRematchButton();
}
export function updateRematchButton() {
  const b = $('btnAgain'), online = mode().remote;
  b.textContent = !online ? 'Rejouer' : rematchAsked ? 'Revanche proposée…' : rematchOffered ? 'Accepter la revanche' : 'Proposer une revanche';
  b.disabled = online && (rematchAsked || !net);
}

export function initOnline() {
  $('btnLobbyCopy').onclick = () => {
    if (!net) return;
    const url = Net.inviteLink(net.code);
    if (navigator.share && R.compactMQ.matches) navigator.share({ title: 'Traversal', text: 'Une partie de Traversal ?', url }).catch(() => {});
    else copyText(url, 'Lien d’invitation copié : envoyez-le à votre adversaire.');
  };
  $('btnLobbyCancel').onclick = () => {
    hideLobby();
    leaveRoom(false);
    if (S.inGame && mode().remote) abandonGame();
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) net?.wake(); });
  $('joinCode').addEventListener('input', e => { const el = /** @type {HTMLInputElement} */ (e.target); el.value = Net.normalizeCode(el.value); });
  $('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnStart').click(); });
}
