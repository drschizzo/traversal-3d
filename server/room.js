// Un salon de partie en ligne, sans rien de Cloudflare : deux places, la partie et ses coups, et les décisions
// (qui prend quelle place, quel coup est accepté, fin de partie, revanche). Le Durable Object (worker.js) s'occupe
// des sockets et du stockage : il applique ce que renvoient ces méthodes. Testé dans tests/room.test.js.
import { END, PROTOCOL, REJECT, ERROR, applyMove, findMove, startPosition, toWire } from '../core/index.js';

/**
 * @typedef {{ terrain: string, seed: number, tokens: (string | null)[], createdAt: number,
 *   result: { winner: number, reason: string, tiebreak?: string | null, resigned?: number } | null, rematch: boolean[] }} RoomMeta
 * @typedef {{ pi: number, kind: string, to: number }} WireMove
 */

export class RoomGame {
  /** @param {Partial<RoomMeta>} meta @param {WireMove[]} moves */
  constructor(meta = {}, moves = []) {
    this.meta = /** @type {RoomMeta} */ (meta);
    this.moves = moves;
    this.game = this.exists ? this.rebuild() : null;
  }

  get exists() { return this.meta.seed !== undefined; }

  /** Réglages d'un nouveau salon ; le créateur occupe la place side. @returns {RoomMeta} */
  static create({ terrain, seed, side, token, now }) {
    const tokens = [null, null];
    tokens[side] = token;
    return { terrain, seed, tokens, createdAt: now, result: null, rematch: [false, false] };
  }

  // position reconstruite en rejouant les coups (au réveil du salon)
  rebuild() {
    let s = startPosition(this.meta.terrain, this.meta.seed);
    for (const m of this.moves) {
      const lm = findMove(s, m);
      if (!lm) break; // ne peut pas arriver : chaque coup a été validé avant d'être écrit
      s = applyMove(s, lm);
    }
    return s;
  }

  /**
   * Un joueur arrive avec son jeton (reprise de sa place) ou sans (première place libre).
   * @returns {{ side: number, patch?: Partial<RoomMeta> } | { error: string }} patch : réglages modifiés à enregistrer
   */
  join({ v, token }, newToken) {
    if (!this.exists) return { error: ERROR.NOT_FOUND };
    if (v !== PROTOCOL) return { error: ERROR.VERSION };
    const tokens = this.meta.tokens;
    const side = token ? tokens.indexOf(token) : -1;
    if (side >= 0) return { side };
    const free = tokens.indexOf(null);
    if (free < 0) return { error: ERROR.FULL };
    const next = tokens.slice();
    next[free] = newToken();
    this.meta.tokens = next;
    return { side: free, patch: { tokens: next } };
  }

  /**
   * Coup proposé par le camp side.
   * @returns {{ reject: string } | { ply: number, move: WireMove, result: RoomMeta['result'] }}
   */
  play(side, { ply, pi, kind, to }) {
    const g = this.game;
    if (this.meta.result || g.over) return { reject: REJECT.OVER };
    if (ply !== g.ply) return { reject: REJECT.DESYNC };
    if (g.turn !== side) return { reject: REJECT.NOT_YOUR_TURN };
    const lm = findMove(g, { pi, kind, to });
    if (!lm) return { reject: REJECT.ILLEGAL };
    this.game = applyMove(g, lm);
    const move = toWire(lm);
    this.moves.push(move);
    const s = this.game;
    const result = s.over ? this.end({ winner: s.winner, reason: s.reason, tiebreak: s.tiebreak }) : null;
    return { ply: g.ply, move, result };
  }

  /** Abandon du camp side ; null si la partie est déjà finie. */
  resign(side) {
    if (this.meta.result || this.game.over) return null;
    return this.end({ winner: 1 - side, reason: END.RESIGN, resigned: side });
  }

  end(result) {
    this.meta.result = result;
    this.meta.rematch = [false, false];
    return result;
  }

  /**
   * Le camp side propose (ou accepte) une revanche. Quand les deux l'ont demandée : nouveau monde sur le même terrain,
   * couleurs échangées.
   * @returns {null | { started: false } | { started: true }}
   */
  rematch(side, newSeed) {
    if (!this.meta.result) return null;
    const rematch = this.meta.rematch.slice();
    rematch[side] = true;
    this.meta.rematch = rematch;
    if (!rematch[0] || !rematch[1]) return { started: false };
    const [a, b] = this.meta.tokens;
    Object.assign(this.meta, { seed: newSeed, tokens: [b, a], result: null, rematch: [false, false] });
    this.moves = [];
    this.game = this.rebuild();
    return { started: true };
  }

  /** Message d'état complet pour le camp side (à l'arrivée d'un joueur, après une revanche). */
  stateFor(side, opponentHere) {
    return {
      type: 'state', v: PROTOCOL, seed: this.meta.seed, terrain: this.meta.terrain, moves: this.moves, you: side,
      token: this.meta.tokens[side], turn: this.game.turn, opponent: opponentHere,
      result: this.meta.result, rematch: this.meta.rematch,
    };
  }
}
