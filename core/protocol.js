// Protocole des parties en ligne, partagé par le client (web/net.js) et le serveur (server/).
// Le serveur ne produit aucun texte : refus et erreurs sont des codes, que le client traduit (web/i18n/fr.js).
//
// Client → serveur (WebSocket, JSON) :
//   { type: 'join', v, token }          prendre (ou reprendre, avec son jeton) une place dans le salon
//   { type: 'move', ply, pi, kind, to } jouer un coup au tour ply
//   { type: 'resign' } · { type: 'rematch' }
//   'ping' (texte)                       battement de cœur, auquel le serveur répond 'pong' sans se réveiller
// Serveur → client :
//   { type: 'state', v, seed, terrain, moves, you, token, turn, opponent, result, rematch }
//   { type: 'move', ply, pi, kind, to } · { type: 'reject', ply, code } · { type: 'over', winner, reason, … }
//   { type: 'opponent', status: 'joined' | 'left' } · { type: 'rematch' } · { type: 'error', code }
import { KINDS } from './constants.js';

// À augmenter quand un message change de forme : un client d'une autre version est invité à recharger la page.
export const PROTOCOL = 1;

// codes de salon : six lettres, sans I ni O (trop proches de 1 et 0)
export const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;
export const CODE_RE = /^[A-HJ-NP-Z]{6}$/;
export const normalizeCode = s => (s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);

// fermetures de la WebSocket décidées par le serveur (le client ne se reconnecte pas)
export const CLOSE = { REPLACED: 4000, VERSION: 4001, FULL: 4003, NOT_FOUND: 4004, EXPIRED: 4010 };
export const isFinalClose = code => code >= 4000 && code < 4100;

// refus d'un coup, erreurs d'accès, erreurs de création de salon
export const REJECT = { OVER: 'over', DESYNC: 'desync', NOT_YOUR_TURN: 'turn', ILLEGAL: 'illegal' };
export const ERROR = { NOT_FOUND: 'notfound', FULL: 'full', VERSION: 'version', RATE: 'rate', UNAVAILABLE: 'unavailable', BAD_CODE: 'badcode', NOT_WEBSOCKET: 'websocket' };

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** Message d'un client, validé ; null s'il est illisible ou mal formé. */
export function parseClientMessage(raw) {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  let msg;
  try { msg = JSON.parse(raw); } catch { return null; }
  if (!msg || typeof msg !== 'object') return null;
  switch (msg.type) {
    case 'join':
      if (msg.token != null && typeof msg.token !== 'string') return null;
      return { type: 'join', v: msg.v ?? PROTOCOL, token: msg.token || null };
    case 'move':
      if (!isInt(msg.ply, 0, 10_000) || !isInt(msg.pi, 0, 11) || !KINDS.includes(msg.kind) || !isInt(msg.to, 0, 99)) return null;
      return { type: 'move', ply: msg.ply, pi: msg.pi, kind: msg.kind, to: msg.to };
    case 'resign':
    case 'rematch':
      return { type: msg.type };
    default:
      return null;
  }
}
