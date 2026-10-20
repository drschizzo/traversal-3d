// Traversal — IA : negamax alpha-bêta, approfondissement itératif et recherche de quiescence
import { allMoves, applyMove, exitDistances, idx, MOVE, STR, SENTINEL, ON_BOARD } from './game.js';

const WIN = 100000;
const VAL = [16, 24, 36];
const PROG = [3, 4, 6];
const LEVELS = {
  easy: { depth: 1, time: 400, noise: 40, quiesce: false },
  medium: { depth: 2, time: 1200, noise: 6, quiesce: true },
  hard: { depth: 8, time: 2600, noise: 0, quiesce: true },
};

class Timeout extends Error {}

export function chooseMove(state, level = 'medium') {
  const cfg = LEVELS[level] || LEVELS.medium;
  const ed = [exitDistances(state.h, 0), exitDistances(state.h, 1)];
  const deadline = Date.now() + cfg.time;
  let nodes = 0;

  const turnsLeft = p => Math.ceil(ed[p.o][idx(p.x, p.y)] / MOVE[p.t]);

  function evaluate(s, pov) {
    if (s.over) return terminal(s, pov);
    const side = [0, 0];
    for (const p of s.pieces) {
      if (p.st !== ON_BOARD) continue;
      const t = turnsLeft(p);
      let w = PROG[p.t];
      if (p.t === SENTINEL && s.crossed === 0) w = 11;
      side[p.o] += VAL[p.t] + w * Math.max(0, 12 - t) + (t <= 1 ? 6 * STR[p.t] : 0);
    }
    side[0] += s.score[0] * 60;
    side[1] += s.score[1] * 60;
    return side[pov] - side[1 - pov];
  }

  function terminal(s, pov) {
    if (s.winner === 2) return 0;
    return (s.winner === pov ? 1 : -1) * (WIN - s.ply);
  }

  function order(s, moves) {
    const sc = m => {
      const p = s.pieces[m.pi];
      if (m.kind === 'exit') return 1000 + (p.t === SENTINEL && s.crossed === 0 ? 5000 : 0) + STR[p.t] * 10;
      if (m.kind === 'attack') return 500 + 20 * STR[s.pieces[s.cell[m.to]].t] - STR[p.t];
      return ed[p.o][idx(p.x, p.y)] - ed[p.o][m.to];
    };
    for (const m of moves) m._s = sc(m);
    return moves.sort((a, b) => b._s - a._s);
  }

  function child(s, m, pov, depth, alpha, beta, q) {
    const c = applyMove(s, m);
    if (c.over) return terminal(c, pov);
    if (c.turn === pov) return q ? quiesce(c, alpha, beta, q - 1) : search(c, depth, alpha, beta);
    return -(q ? quiesce(c, -beta, -alpha, q - 1) : search(c, depth, -beta, -alpha));
  }

  function quiesce(s, alpha, beta, q) {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
    const stand = evaluate(s, s.turn);
    if (q <= 0 || stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const moves = order(s, allMoves(s, true).filter(m => m.kind !== 'move'));
    for (const m of moves) {
      const v = child(s, m, s.turn, 0, alpha, beta, q);
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  function search(s, depth, alpha, beta) {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
    if (depth <= 0) return cfg.quiesce ? quiesce(s, alpha, beta, 4) : evaluate(s, s.turn);
    const moves = order(s, allMoves(s, true));
    if (!moves.length) return evaluate(s, s.turn);
    let best = -Infinity;
    for (const m of moves) {
      const v = child(s, m, s.turn, depth - 1, alpha, beta, 0);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  let rootMoves = order(state, allMoves(state, true));
  if (!rootMoves.length) return null;
  let bestMove = rootMoves[0];
  const pov = state.turn;

  for (let depth = 1; depth <= cfg.depth; depth++) {
    try {
      const scored = [];
      let alpha = -Infinity;
      for (const m of rootMoves) {
        const noise = cfg.noise ? (Math.random() - 0.5) * cfg.noise : 0;
        // avec du bruit, on évalue chaque coup avec une fenêtre complète
        const v = child(state, m, pov, depth - 1, cfg.noise ? -Infinity : alpha, Infinity, 0) + noise;
        scored.push([v, m]);
        if (v > alpha) alpha = v;
      }
      scored.sort((a, b) => b[0] - a[0]);
      rootMoves = scored.map(x => x[1]);
      bestMove = rootMoves[0];
      if (scored[0][0] >= WIN - 1000) break; // victoire forcée trouvée
    } catch (e) {
      if (e instanceof Timeout) break;
      throw e;
    }
    if (Date.now() > deadline) break;
  }
  const { _s, ...clean } = bestMove;
  return clean;
}
