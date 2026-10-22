// Les pièces et les coups en mots, sans coordonnées : une pièce se désigne par son type, son camp et, s'il le faut,
// son flanc (vu depuis le côté du plateau d'où regarde le joueur) ; un coup, par ce qu'il fait.
import * as G from '../../core/index.js';
import { TYPE_NAMES, TYPE_GLYPHS } from '../i18n/fr.js';

export const pct = p => `${Math.round(p * 100)} %`;
export const plural = (n, w) => `${n} ${w}${Math.abs(n) > 1 ? 's' : ''}`;
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const lower = s => s.charAt(0).toLowerCase() + s.slice(1);

// ctx = { view : camp d'où l'on regarde (gauche et droite), me : camp à qui l'on parle (« votre »), −1 sinon }
export const DEF_CTX = { view: 0, me: -1 };
const ART = ['l’', 'l’', 'la '];
const COLOR_ADJ = [['rouge', 'bleu'], ['rouge', 'bleue'], ['rouge', 'bleue']];

function flank(s, pi, view) {
  const p = s.pieces[pi];
  const twin = s.pieces.findIndex((q, k) => k !== pi && q.o === p.o && q.t === p.t && q.st === G.ON_BOARD);
  if (twin < 0 || p.st !== G.ON_BOARD) return '';
  const q = s.pieces[twin];
  if (p.x === q.x) {
    const ahead = p.o === 0 ? p.y > q.y : p.y < q.y;
    return ahead ? ' de devant' : ' de derrière';
  }
  const left = view === 0 ? p.x < q.x : p.x > q.x;
  return left ? ' de gauche' : ' de droite';
}

// « votre ▲ Sentinelle de gauche », « l’◆ Avant-garde adverse », « la ▲ Sentinelle bleue »
export function pieceRef(s, pi, ctx = DEF_CTX) {
  const p = s.pieces[pi], name = `${TYPE_GLYPHS[p.t]} ${TYPE_NAMES[p.t]}`, side = flank(s, pi, ctx.view);
  if (ctx.me === p.o) return `votre ${name}${side}`;
  if (ctx.me >= 0) return `${ART[p.t]}${name} adverse${side}`;
  return `${ART[p.t]}${name} ${COLOR_ADJ[p.t][p.o]}${side}`;
}

// déplacement vu par le camp qui joue : rangées gagnées vers l'arrivée, décalage à gauche ou à droite à l'écran
function shift(s, m, view) {
  const p = s.pieces[m.pi], dy = (G.cy(m.to) - p.y) * (p.o === 0 ? 1 : -1), dx = G.cx(m.to) - p.x;
  const side = dx === 0 ? '' : (dx < 0) === (view === 0) ? 'gauche' : 'droite';
  return { dy, dx: Math.abs(dx), side };
}
const rows = n => (n === 1 ? 'd’une rangée' : `de ${n} rangées`);
const cells = n => (n === 1 ? 'd’une case' : `de ${n} cases`);
const special = m => (m.special === 'jump' ? ' (bond)' : m.special === 'diag' ? ' (diagonale)' : '');

// coup à l'indicatif : « Votre ▲ Sentinelle de gauche avance de 2 rangées vers la droite »
export function moveText(s, m, ctx = DEF_CTX) {
  const ref = cap(pieceRef(s, m.pi, ctx));
  if (m.kind === 'exit') return `${ref} franchit l’arrivée`;
  if (m.kind === 'attack') return `${ref} capture ${pieceRef(s, s.cell[m.to], ctx)}${special(m)}`;
  const { dy, dx, side } = shift(s, m, ctx.view), to = side ? ` vers la ${side}` : '';
  if (dy > 0) return `${ref} avance ${rows(dy)}${to}${special(m)}`;
  if (dy < 0) return `${ref} recule ${rows(-dy)}${to}${special(m)}`;
  return `${ref} se décale ${cells(dx)}${to}${special(m)}`;
}

// coup à l'impératif, pour un conseil : « Avancez votre ▲ Sentinelle de gauche de 2 rangées »
export function moveAdvice(s, m, ctx = DEF_CTX) {
  const ref = pieceRef(s, m.pi, ctx);
  if (m.kind === 'exit') return `Faites franchir l’arrivée à ${ref}`;
  if (m.kind === 'attack') return `Capturez ${pieceRef(s, s.cell[m.to], ctx)} avec ${ref}${special(m)}`;
  const { dy, dx, side } = shift(s, m, ctx.view), to = side ? ` vers la ${side}` : '';
  if (dy > 0) return `Avancez ${ref} ${rows(dy)}${to}${special(m)}`;
  if (dy < 0) return `Reculez ${ref} ${rows(-dy)}${to}${special(m)}`;
  return `Décalez ${ref} ${cells(dx)}${to}${special(m)}`;
}

