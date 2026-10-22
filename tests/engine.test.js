// Le vrai moteur WebAssembly, à travers le pont du jeu : vérifie le contrat du tampon partagé (engine/layout.json)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadEngine, think } from '../web/bot/wasm-bridge.js';
import { startPosition, allMoves, applyMove, sameMove } from '../core/index.js';

const ex = await loadEngine(readFileSync(new URL('../engine/traversal.wasm', import.meta.url)));

describe('moteur WebAssembly', () => {
  it('joue un coup légal, avec son analyse', () => {
    const s = startPosition('mountains', 42);
    const { move, info } = think(ex, s, 'review', true, 1);
    expect(allMoves(s, true).some(m => sameMove(m, move))).toBe(true);
    expect(info.depth).toBeGreaterThan(0);
    expect(info.alts.length).toBeGreaterThan(0);
    expect(sameMove(info.alts[0].move, move)).toBe(true);
    expect(sameMove(info.pv[0].move, move)).toBe(true);
    expect(info.turns).toHaveLength(600);
  });

  it('suit la partie : chaque coup proposé est légal dans la position donnée', () => {
    let s = startPosition('woods', 9);
    for (let k = 0; k < 12 && !s.over; k++) {
      const { move } = think(ex, s, 'easy', false, k);
      expect(move, `coup ${k}`).toBeTruthy();
      s = applyMove(s, move);
    }
  });

  it('trouve une victoire immédiate', () => {
    // Rouge peut sortir sa Sentinelle en premier : victoire
    let s = startPosition('random', 3);
    s = { ...s, pieces: s.pieces.map((p, i) => (i === 0 ? { ...p, x: 0, y: 9 } : p)), cell: s.cell.map((c, i) => (i === 2 ? -1 : i === 90 ? 0 : c)) };
    const { move } = think(ex, s, 'review', true, 1);
    expect(move.kind).toBe('exit');
    expect(move.pi).toBe(0);
  });
});
