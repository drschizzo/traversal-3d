// Ce qu'un coup vient de changer sur le plateau, pour le montrer et le faire entendre : renforts, menaces créées,
// pièces mises hors de prise ou laissées en prise, pièce prête à sortir. Pur : compare deux positions.
import { STR, SENTINEL, ON_BOARD } from './constants.js';
import { idx, NEIGH } from './board.js';
import { attacksBy, pieceMoves } from './rules.js';

/**
 * @typedef {{ kind: 'reinforce', pi: number, ally: number, saved: boolean }
 *   | { kind: 'threat', target: number, by: number[] }
 *   | { kind: 'exposed', pi: number, by: number[] }
 *   | { kind: 'safe', pi: number }
 *   | { kind: 'brink', pi: number, decisive: boolean }} MoveEvent
 */
/** @import { State } from './rules.js' */

// pièces alliées (de la pièce pi) adjacentes à la case c
/** @param {State} s @param {number} pi @param {number} c */
function alliesAround(s, pi, c) {
  /** @type {number[]} */
  const res = [];
  const o = s.pieces[pi].o;
  for (const n of NEIGH[c]) {
    const q = s.cell[n];
    if (q >= 0 && q !== pi && s.pieces[q].o === o) res.push(q);
  }
  return res;
}

// la pièce pi pourrait-elle sortir au prochain tour de son camp ?
/** @type {(s: State, pi: number) => boolean} */
const canExit = (s, pi) => s.pieces[pi].st === ON_BOARD && pieceMoves({ ...s, turn: s.pieces[pi].o }, pi, true).some(m => m.kind === 'exit');

/**
 * Événements du coup m, joué depuis before et menant à after (après applyMove). Rien quand la partie s'achève :
 * la fin a ses propres effets.
 * @param {State} before @param {import('./move.js').WireMove} m @param {State} after
 * @returns {MoveEvent[]}
 */
export function moveEvents(before, m, after) {
  if (after.over || m.kind === 'exit') return [];
  const side = before.pieces[m.pi].o, op = 1 - side;
  /** @type {MoveEvent[]} */
  const ev = [];
  const from = idx(before.pieces[m.pi].x, before.pieces[m.pi].y);

  // menaces du camp adverse, avant et après : ce qui est sauvé, ce qui est laissé en prise
  const opBefore = attacksBy(before, op), opAfter = attacksBy(after, op);
  const nowSafe = (/** @type {number} */ pi) => opBefore.has(pi) && !opAfter.has(pi) && after.pieces[pi].st === ON_BOARD;

  // renfort : la pièce arrive à côté d'un allié qu'elle ne touchait pas (+1 à sa défense)
  const wasNear = new Set(alliesAround(before, m.pi, from)), helped = new Set();
  for (const ally of alliesAround(after, m.pi, m.to))
    if (!wasNear.has(ally)) { ev.push({ kind: 'reinforce', pi: m.pi, ally, saved: nowSafe(ally) }); helped.add(ally); }

  // pièces du camp qui joue mises hors de prise (la pièce jouée comprise), hors alliés déjà sauvés par un renfort
  for (const pi of opBefore.keys())
    if (before.pieces[pi].o === side && nowSafe(pi) && !helped.has(pi)) ev.push({ kind: 'safe', pi });
  // pièces du camp qui joue laissées en prise par ce coup
  for (const [pi, by] of opAfter)
    if (after.pieces[pi].o === side && !opBefore.has(pi)) ev.push({ kind: 'exposed', pi, by });

  // menaces nouvelles sur le camp adverse, la plus forte cible d'abord
  const mineBefore = attacksBy(before, side);
  const threats = [...attacksBy(after, side)].filter(([pi]) => !mineBefore.has(pi));
  threats.sort((a, b) => STR[after.pieces[b[0]].t] - STR[after.pieces[a[0]].t]);
  for (const [target, by] of threats) ev.push({ kind: 'threat', target, by });

  // la pièce jouée peut sortir au prochain tour ; decisive : cette sortie déciderait la partie
  // (première pièce sortie et c'est une Sentinelle, ou deuxième sortie avec le score qui suffit)
  if (canExit(after, m.pi) && !canExit(before, m.pi)) {
    const p = after.pieces[m.pi];
    const decisive = after.crossed === 0 ? p.t === SENTINEL : after.score[side] + STR[p.t] > after.score[op];
    ev.push({ kind: 'brink', pi: m.pi, decisive });
  }
  return ev;
}
