import { describe, it, expect } from 'vitest';
import { TERRAINS, mulberry32, startPosition, allMoves, applyMove, toWire, encodeMatch, decodeMatch, replay } from '../core/index.js';

// partie au hasard, reproductible
function randomGame(terrain, seed, maxPlies = 400) {
  const rng = mulberry32(seed ^ 0x5bd1e995);
  let s = startPosition(terrain, seed);
  const moves = [];
  while (!s.over && moves.length < maxPlies) {
    const list = allMoves(s);
    const m = list[Math.floor(rng() * list.length)];
    moves.push(toWire(m));
    s = applyMove(s, m);
  }
  return { moves, state: s };
}

describe('liens de partie', () => {
  it.each(TERRAINS)('aller-retour sur le terrain %s', terrain => {
    const seed = (0xdeadbeef ^ terrain.length) >>> 0;
    const { moves, state } = randomGame(terrain, seed);
    const code = encodeMatch({ seed, terrain, moves });
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const d = decodeMatch(code);
    expect(d).toEqual({ seed, terrain, moves });
    const r = replay(d.seed, d.terrain, d.moves);
    expect(r.state.ply).toBe(state.ply);
    expect(r.state.score).toEqual(state.score);
    expect(r.before).toHaveLength(moves.length);
  });

  it('une partie de 200 coups tient en ~550 caractères', () => {
    const moves = Array.from({ length: 200 }, () => ({ pi: 11, kind: 'attack', to: 99 }));
    expect(encodeMatch({ seed: 2 ** 32 - 1, terrain: 'desert', moves }).length).toBeLessThan(550);
  });

  it('refuse un lien abîmé', () => {
    expect(() => decodeMatch('')).toThrow();
    expect(() => decodeMatch('AAAA')).toThrow(); // version 0
    expect(() => encodeMatch({ seed: 1, terrain: 'lune', moves: [] })).toThrow();
  });

  it('le rejeu s’arrête au premier coup illégal', () => {
    const { moves } = randomGame('random', 12, 10);
    moves[5] = { ...moves[5], to: (moves[5].to + 50) % 100 };
    expect(replay(12, 'random', moves)).toBeNull();
  });
});
