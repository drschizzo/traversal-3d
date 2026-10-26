import { describe, it, expect } from 'vitest';
import { EXPLORER, VANGUARD, SENTINEL, pieceMoves, applyMove, moveEvents, idx } from '../core/index.js';
import { position } from './helpers.js';

// joue la pièce pi vers (x, y) et renvoie les événements du coup
function play(s, pi, x, y, kind = 'move') {
  const m = pieceMoves(s, pi).find(c => c.kind === kind && c.to === idx(x, y));
  if (!m) throw new Error(`coup introuvable vers ${x},${y}`);
  return moveEvents(s, m, applyMove(s, m));
}
const kinds = ev => ev.map(e => e.kind);

describe('événements d’un coup', () => {
  it('renfort : la pièce arrive à côté d’un allié', () => {
    const s = position({ pieces: [{ t: SENTINEL, o: 0, x: 4, y: 4 }, { t: EXPLORER, o: 0, x: 2, y: 2 }, { t: EXPLORER, o: 1, x: 9, y: 9 }] });
    expect(play(s, 1, 5, 4)).toEqual([{ kind: 'reinforce', pi: 1, ally: 0, saved: false }]);
  });

  it('pas de renfort pour un allié déjà touché avant le coup', () => {
    const s = position({ pieces: [{ t: SENTINEL, o: 0, x: 4, y: 4 }, { t: EXPLORER, o: 0, x: 4, y: 3 }, { t: EXPLORER, o: 1, x: 9, y: 9 }] });
    expect(kinds(play(s, 1, 5, 4))).not.toContain('reinforce');
  });

  it('un renfort qui met l’allié hors de prise le dit, sans le répéter en « sauvé »', () => {
    // Avant-garde rouge (défense 2) attaquable par l'Avant-garde bleue (attaque 2) ; l'Explorateur la porte à 3
    const s = position({ pieces: [{ t: VANGUARD, o: 0, x: 4, y: 4 }, { t: EXPLORER, o: 0, x: 2, y: 4 }, { t: VANGUARD, o: 1, x: 4, y: 6 }] });
    const ev = play(s, 1, 3, 4);
    expect(ev).toContainEqual({ kind: 'reinforce', pi: 1, ally: 0, saved: true });
    expect(ev.filter(e => e.kind === 'safe')).toEqual([]);
  });

  it('menace : une pièce adverse devient capturable', () => {
    const s = position({ pieces: [{ t: SENTINEL, o: 0, x: 4, y: 0 }, { t: EXPLORER, o: 1, x: 4, y: 6 }] });
    expect(play(s, 0, 4, 3)).toEqual([{ kind: 'threat', target: 1, by: [0] }]);
  });

  it('en prise : la pièce jouée se met à portée d’une attaque', () => {
    const s = position({ pieces: [{ t: EXPLORER, o: 0, x: 4, y: 0 }, { t: SENTINEL, o: 1, x: 4, y: 8 }] });
    expect(play(s, 0, 4, 5)).toEqual([{ kind: 'exposed', pi: 0, by: [1] }]);
  });

  it('à l’abri : une pièce menacée s’éloigne', () => {
    const s = position({ pieces: [{ t: EXPLORER, o: 0, x: 4, y: 5 }, { t: SENTINEL, o: 1, x: 4, y: 8 }] });
    expect(play(s, 0, 4, 0)).toEqual([{ kind: 'safe', pi: 0 }]);
  });

  it('au bord de la sortie : décisif pour une Sentinelle qui sortirait la première', () => {
    const s = position({ pieces: [{ t: SENTINEL, o: 0, x: 4, y: 5 }, { t: EXPLORER, o: 0, x: 0, y: 2 }, { t: EXPLORER, o: 1, x: 9, y: 0 }] });
    expect(play(s, 0, 4, 7)).toEqual([{ kind: 'brink', pi: 0, decisive: true }]);
    expect(play(s, 1, 0, 5)).toEqual([{ kind: 'brink', pi: 1, decisive: false }]);
  });

  it('une seconde sortie n’est décisive que si elle donne l’avantage au score', () => {
    const pieces = [{ t: EXPLORER, o: 0, x: 4, y: 2 }, { t: EXPLORER, o: 1, x: 9, y: 0 }];
    expect(play(position({ pieces, crossed: 1, score: [0, 1] }), 0, 4, 5)[0].decisive).toBe(false);
    expect(play(position({ pieces, crossed: 1, score: [1, 1] }), 0, 4, 5)[0].decisive).toBe(true);
  });

  it('rien pour une sortie', () => {
    const s = position({ pieces: [{ t: SENTINEL, o: 0, x: 4, y: 9 }, { t: EXPLORER, o: 1, x: 9, y: 0 }] });
    const m = pieceMoves(s, 0).find(c => c.kind === 'exit');
    expect(moveEvents(s, m, applyMove(s, m))).toEqual([]);
  });
});
