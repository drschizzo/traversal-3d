// Sérialisation compacte d'une partie : {seed, terrain, moves} ⇄ chaîne base64url (pur, sans DOM)
//
// Octet 0 : version (4 bits hauts) et indice du terrain dans TERRAIN_MODES (4 bits bas)
// Octets 1-4 : graine du monde, entier non signé gros-boutiste
// Puis 2 octets par coup : pi (4 bits) · kind (2 bits) · to (7 bits), gros-boutiste.
// Un coup est identifié sans ambiguïté par {pi, kind, to} : les coups spéciaux de l'Explorateur
// ne visent jamais une case déjà accessible normalement (voir pieceMoves).
import { TERRAIN_MODES, allMoves, applyMove, generateTerrain, newGame } from './game.js';

const VERSION = 1;
export const KINDS = ['move', 'attack', 'exit'];

function toBase64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export function encodeMatch({ seed, terrain, moves }) {
  const t = TERRAIN_MODES.findIndex(m => m[0] === terrain);
  if (t < 0) throw new Error('terrain inconnu');
  const bytes = new Uint8Array(5 + moves.length * 2);
  bytes[0] = (VERSION << 4) | t;
  new DataView(bytes.buffer).setUint32(1, seed >>> 0);
  moves.forEach((m, k) => {
    const v = (m.pi << 9) | (KINDS.indexOf(m.kind) << 7) | m.to;
    bytes[5 + 2 * k] = v >> 8;
    bytes[6 + 2 * k] = v & 0xff;
  });
  return toBase64url(bytes);
}

export function decodeMatch(str) {
  const bytes = fromBase64url(str);
  if (bytes.length < 5 || bytes.length % 2 === 0 || bytes[0] >> 4 !== VERSION) throw new Error('lien de partie invalide');
  const terrain = TERRAIN_MODES[bytes[0] & 15]?.[0];
  if (!terrain) throw new Error('terrain inconnu');
  const seed = new DataView(bytes.buffer).getUint32(1);
  const moves = [];
  for (let k = 5; k < bytes.length; k += 2) {
    const v = (bytes[k] << 8) | bytes[k + 1];
    const kind = KINDS[(v >> 7) & 3];
    if (!kind) throw new Error('coup invalide');
    moves.push({ pi: v >> 9, kind, to: v & 127 });
  }
  return { seed, terrain, moves };
}

// Rejoue la liste de coups depuis le départ. Renvoie les positions avant chaque coup, les coups légaux
// correspondants (objets complets de allMoves) et la position finale ; null au premier coup illégal.
export function replay(seed, terrain, moves) {
  let s = newGame(generateTerrain(terrain, seed >>> 0));
  const before = [], legal = [];
  for (const m of moves) {
    const lm = !s.over && allMoves(s).find(x => x.pi === m.pi && x.kind === m.kind && x.to === m.to);
    if (!lm) return null;
    before.push(s);
    legal.push(lm);
    s = applyMove(s, lm);
  }
  return { before, legal, state: s };
}
