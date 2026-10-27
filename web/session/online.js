// Partie en ligne (net.js, server/worker.js). Le serveur fait foi : un coup du joueur est envoyé (phase sending),
// puis joué quand le serveur le renvoie aux deux joueurs. Les coups reçus attendent dans queue que l'animation
// en cours se termine.
import * as G from '../../core/index.js';
import { PLAYER_NAMES, rejectText, errorText } from '../i18n/fr.js';
import * as Net from '../net.js';
import { S, cfg, play, phase, mode, isHuman, liveNow } from './store.js';
import { setDriver } from './modes.js';
import { installGame, enterGame, abandonGame } from './game.js';
import { nextTurn, performMove } from './turns.js';
import * as V from './view.js';

let net = null, queue = [], result = null, opponentHere = false;
let rematchAsked = false, rematchOffered = false;
// salon en cours d'ouverture : 'create' ou 'join' (fenêtre du salon affichée), 'resume' (reprise au chargement)
let lobbyIntent = null;

// la boucle des tours et la fin de partie passent par ce déroulement pour le mode « online » (modes.js)
export function initOnline() {
  setDriver('online', { turn: onlineTurn, send: sendMove, leave: leaveRoom });
}

function openRoom(code, token) {
  net = Net.connect(code, token, { onMessage: onNet, onStatus: onNetStatus });
}

function leaveRoom(resign) {
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

// « Créer le salon » (sans code) ou « Rejoindre le salon » (code validé par le menu)
export async function startOnline(kind, code = '') {
  leaveRoom(false);
  if (kind === 'join') return joinRoom(code);
  lobbyIntent = 'create';
  showLobby('Nouveau salon', 'Création du salon…');
  try {
    const d = await Net.createRoom({ seed: S.worldSeed, terrain: S.worldTerrain, side: cfg.side });
    if (lobbyIntent === 'create') openRoom(d.code, d.token);
  } catch (e) {
    hideLobby();
    V.toast(e.message);
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
  V.emit('menu', code); // le menu affiche le code reçu dans son champ
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
  V.emit('lobby', { title, text, code, canCopy: !!code && lobbyIntent === 'create' });
}
function hideLobby() {
  lobbyIntent = null;
  V.emit('lobby', null);
}

function onNet(msg) {
  switch (msg.type) {
    case 'state': return applyNetState(msg);
    case 'move': queue.push(msg); return wakeTurn();
    case 'reject':
      V.toast(rejectText(msg.code));
      if (phase.is('sending')) phase.to('human');
      return resync();
    case 'over': result = msg; return wakeTurn();
    case 'opponent':
      opponentHere = msg.status === 'joined';
      if (opponentHere && lobbyIntent === 'create') { hideLobby(); enterGame(); return; }
      if (S.inGame && !liveNow().over) V.toast(opponentHere ? 'Votre adversaire est connecté.' : 'Votre adversaire s’est déconnecté.');
      return wakeTurn();
    case 'rematch':
      rematchOffered = true;
      V.emit('rematch');
      V.toast('Votre adversaire propose une revanche.');
      return;
    case 'error': {
      const quiet = lobbyIntent === 'resume';
      hideLobby();
      leaveRoom(false);
      if (!quiet) V.toast(errorText(msg.code));
    }
  }
}

function onNetStatus(status, code) {
  const playing = S.inGame && mode().remote;
  if (status === 'reconnecting' && playing) V.status('Connexion perdue — reconnexion…', liveNow().turn, true);
  if (status !== 'closed') return;
  net = null;
  hideLobby();
  if (code === G.CLOSE.REPLACED) V.toast('La partie a été ouverte dans un autre onglet.');
  else { Net.saveSession(null); if (code === G.CLOSE.EXPIRED) V.toast('Le salon a expiré.'); }
  if (playing && !liveNow().over) { abandonGame(); V.emit('openMenu'); }
}

// relance le tour si rien n'est en cours : partie affichée, pas d'animation, et pas de coup en préparation
function wakeTurn() {
  if (mode().remote && S.inGame && !phase.is('animating') && (!phase.busy() || phase.is('sending')) && S.onScreen) nextTurn();
}

function applyNetState(msg) {
  Net.saveSession({ code: net.code, token: msg.token });
  opponentHere = msg.opponent;
  result = msg.result;
  rematchAsked = !!msg.rematch?.[msg.you];
  rematchOffered = !!msg.rematch?.[1 - msg.you];
  const r = G.replay(msg.seed, msg.terrain, msg.moves);
  if (!r) { V.toast('Partie illisible.'); hideLobby(); leaveRoom(false); return; }
  const n = S.movesLog.length, mv = msg.moves;
  const same = mode().remote && S.inGame && S.worldSeed === msg.seed && S.worldTerrain === msg.terrain && play.side === msg.you
    && n <= mv.length && S.movesLog.every(({ move: m }, k) => G.sameWire(m, mv[k]));
  if (same) {
    // reconnexion : les coups manqués seront joués dans l'ordre ; un coup envoyé resté sans réponse est à rejouer
    queue = mv.slice(n).map((m, k) => ({ ply: n + k, ...m }));
    if (phase.is('sending')) phase.to('human');
    if (!phase.is('animating') && S.onScreen) nextTurn();
    return;
  }
  const intent = lobbyIntent;
  if (intent === 'resume' && (r.state.over || msg.result)) { lobbyIntent = null; leaveRoom(false); return; } // rien à reprendre
  Object.assign(play, { mode: 'online', side: msg.you, level: cfg.level });
  Object.assign(cfg, { mode: 'pvp', where: cfg.where === 'join' ? 'join' : 'create', side: msg.you });
  V.emit('menu');
  queue = [];
  V.emit('over', false);
  installGame(msg.seed, msg.terrain, r);
  if (intent === 'resume') {
    lobbyIntent = null;
    V.toast('Une partie en ligne est en cours : « Reprendre la partie » pour y revenir.');
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
function onlineTurn() {
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
  V.refresh();
  V.status(opponentHere ? `À votre adversaire de jouer (${PLAYER_NAMES[S.state.turn]})…` : 'Votre adversaire est déconnecté : en attente de son retour…', S.state.turn, opponentHere);
  return true;
}

function sendMove(m) {
  if (phase.is('sending')) return;
  const s = S.state;
  if (!net?.send({ type: 'move', ply: s.ply, ...G.toWire(m) })) { V.toast('Connexion perdue : coup non envoyé.'); return; }
  phase.to('sending');
  V.clearSelection();
  V.status('Coup envoyé…', s.turn, true);
  V.refresh();
}

export function proposeRematch() {
  if (!net) return V.toast('Le salon est fermé.');
  net.send({ type: 'rematch' });
  rematchAsked = true;
  V.emit('rematch');
}

/** Où en est la revanche, pour le bouton de la fenêtre de fin (ui/game-over.js). */
export const rematchState = () => ({ online: mode().remote, asked: rematchAsked, offered: rematchOffered, open: !!net });

/** Lien d'invitation au salon ouvert, ou null (bouton « Copier » de la fenêtre du salon). */
export const inviteUrl = () => (net ? Net.inviteLink(net.code) : null);

/** « Annuler » dans la fenêtre du salon : on referme et on quitte le salon. */
export function cancelLobby() {
  hideLobby();
  leaveRoom(false);
  if (S.inGame && mode().remote) abandonGame();
}

/** Retour de la page au premier plan : la socket tombée est rouverte sans attendre. */
export const wakeNet = () => net?.wake();
