import { describe, it, expect } from 'vitest';
import { TERRAINS, NC, NEIGH, generateTerrain, positionKey, startPosition, applyMove, allMoves, replay, toWire } from '../core/index.js';

describe('terrain', () => {
  it('est déterminé par le mode et la graine', () => {
    for (const mode of TERRAINS) expect(generateTerrain(mode, 99)).toEqual(generateTerrain(mode, 99));
    expect(generateTerrain('random', 1)).not.toEqual(generateTerrain('random', 2));
  });

  it('reste identique d’une version à l’autre (mondes partagés par lien)', () => {
    // relevés du moteur Rust (selfplay terrain n=1), qui fait foi pour la génération
    expect([...generateTerrain('random', 0)].join(',')).toBe('4,3,2,3,3,2,1,2,2,1,3,3,2,3,3,3,2,2,2,0,2,2,3,3,4,3,3,2,1,0,1,1,2,4,5,4,3,2,1,0,1,1,2,4,6,5,4,2,1,0,0,1,2,4,5,6,4,2,1,1,0,1,2,3,4,5,4,2,1,1,0,1,2,3,3,4,3,3,2,2,0,2,2,2,3,3,3,2,3,3,1,2,2,1,2,3,3,2,3,4');
    expect([...generateTerrain('mountains', 0)].join(',')).toBe('0,0,1,1,1,1,1,1,0,0,0,1,1,2,3,2,2,1,0,0,0,1,2,4,5,4,3,2,1,0,1,1,3,5,7,6,5,3,1,0,1,2,4,6,8,8,6,4,2,0,0,2,4,6,8,8,6,4,2,1,0,1,3,5,6,7,5,3,1,1,0,1,2,3,4,5,4,2,1,0,0,0,1,2,2,3,2,1,1,0,0,0,1,1,1,1,1,1,0,0');
  });

  it.each(TERRAINS)('%s : hauteurs de 0 à 8, voisines à 2 près au plus', mode => {
    for (let seed = 0; seed < 50; seed++) {
      const h = generateTerrain(mode, seed * 7919);
      expect(h).toHaveLength(NC);
      for (let i = 0; i < NC; i++) {
        expect(h[i]).toBeGreaterThanOrEqual(0);
        expect(h[i]).toBeLessThanOrEqual(8);
        for (const n of NEIGH[i]) expect(Math.abs(h[i] - h[n])).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('clé de position', () => {
  it('ne dépend pas du chemin suivi pour reconstruire la position', () => {
    let s = startPosition('woods', 5);
    const moves = [];
    for (let k = 0; k < 8; k++) { const m = allMoves(s)[k * 3]; moves.push(toWire(m)); s = applyMove(s, m); }
    expect(positionKey(replay(5, 'woods', moves).state)).toBe(positionKey(s));
  });
  it('distingue deux positions différentes', () => {
    const s = startPosition('woods', 5);
    expect(positionKey(applyMove(s, allMoves(s)[0]))).not.toBe(positionKey(s));
    expect(positionKey(startPosition('woods', 6))).not.toBe(positionKey(s));
  });
});
