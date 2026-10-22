import { describe, it, expect } from 'vitest';
import {
  EXPLORER, VANGUARD, SENTINEL, CAPTURED, SCORED, MAX_PLIES, DRAW, END, TIEBREAK,
  newGame, allMoves, pieceMoves, applyMove, combat, idx, generateTerrain, findMove,
} from '../core/index.js';
import { flat, position, targets } from './helpers.js';
import { withResult } from '../core/index.js';

describe('position de départ', () => {
  const s = newGame(flat());
  it('six pièces par camp, Rouge au trait', () => {
    expect(s.pieces.filter(p => p.o === 0)).toHaveLength(6);
    expect(s.pieces.filter(p => p.o === 1)).toHaveLength(6);
    expect(s.turn).toBe(0);
  });
  it('seules les pièces du camp au trait jouent', () => {
    expect(allMoves(s).every(m => s.pieces[m.pi].o === 0)).toBe(true);
  });
});

describe('déplacements', () => {
  it('une Sentinelle sur terrain plat atteint les cases à distance ≤ 3', () => {
    const s = position({ pieces: [{ t: SENTINEL, o: 0, x: 4, y: 4 }] });
    const reach = targets(pieceMoves(s, 0), 'move');
    const expected = [];
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const d = Math.abs(x - 4) + Math.abs(y - 4);
      if (d > 0 && d <= 3) expected.push(idx(x, y));
    }
    expect(reach).toEqual(expected.sort((a, b) => a - b));
  });

  it('un pas coûte 1 + la différence de hauteur', () => {
    const h = flat();
    h[idx(5, 4)] = 2; // monter coûte 3
    const s = position({ h, pieces: [{ t: SENTINEL, o: 0, x: 4, y: 4 }] });
    const m = pieceMoves(s, 0).find(x => x.kind === 'move' && x.to === idx(5, 4));
    expect(m.cost).toBe(3);
    expect(pieceMoves(s, 0).some(x => x.to === idx(6, 4))).toBe(false); // 6 points par la bosse, 4 par le détour
  });

  it('on ne traverse aucune pièce', () => {
    const s = position({ pieces: [{ t: SENTINEL, o: 0, x: 0, y: 4 }, { t: SENTINEL, o: 0, x: 1, y: 4 }, { t: SENTINEL, o: 0, x: 0, y: 5 }, { t: SENTINEL, o: 0, x: 0, y: 3 }] });
    expect(pieceMoves(s, 0)).toHaveLength(0);
  });

  it('l’Explorateur bondit ou passe en diagonale sans coût de hauteur', () => {
    const h = flat(8);
    h[idx(4, 4)] = 0;
    const s = position({ h, pieces: [{ t: EXPLORER, o: 0, x: 4, y: 4 }] });
    const special = pieceMoves(s, 0).filter(m => m.special);
    expect(special.filter(m => m.special === 'diag')).toHaveLength(4);
    expect(special.filter(m => m.special === 'jump')).toHaveLength(4);
  });

  it('un coup spécial ne double jamais un déplacement normal', () => {
    const s = position({ pieces: [{ t: EXPLORER, o: 0, x: 4, y: 4 }] });
    expect(pieceMoves(s, 0).filter(m => m.special)).toHaveLength(0);
  });
});

describe('combat', () => {
  it('attaque = force + hauteur + alliés ; défense = force + renforts', () => {
    const h = flat();
    h[idx(4, 4)] = 1;
    const s = position({ h, pieces: [
      { t: VANGUARD, o: 0, x: 4, y: 4 }, { t: EXPLORER, o: 0, x: 6, y: 4 },
      { t: SENTINEL, o: 1, x: 5, y: 4 }, { t: EXPLORER, o: 1, x: 5, y: 3 },
    ] });
    const c = combat(s, 0, idx(5, 4), false);
    expect(c).toMatchObject({ base: 2, height: 1, allies: 1, att: 4, dBase: 3, reinf: 1, def: 4, defender: 2 });
  });

  it('l’attaque n’est permise que si Attaque ≥ Défense', () => {
    const s = position({ pieces: [{ t: EXPLORER, o: 0, x: 4, y: 4 }, { t: SENTINEL, o: 1, x: 4, y: 5 }] });
    expect(targets(pieceMoves(s, 0), 'attack')).toEqual([]);
    const s2 = position({ pieces: [{ t: SENTINEL, o: 0, x: 4, y: 4 }, { t: EXPLORER, o: 1, x: 4, y: 5 }] });
    expect(targets(pieceMoves(s2, 0), 'attack')).toEqual([idx(4, 5)]);
  });

  it('l’Avant-garde gagne +1 si le chemin coûte exactement 4', () => {
    const s = position({ pieces: [{ t: VANGUARD, o: 0, x: 0, y: 0 }, { t: SENTINEL, o: 1, x: 4, y: 0 }] });
    const m = pieceMoves(s, 0).find(x => x.kind === 'attack');
    expect(m.cost).toBe(4);
    expect(m.combat.vb).toBe(1);
    expect(m.combat.att).toBe(3);
  });

  it('une capture retire la pièce adverse', () => {
    const s = position({ pieces: [{ t: SENTINEL, o: 0, x: 4, y: 4 }, { t: EXPLORER, o: 1, x: 4, y: 5 }, { t: SENTINEL, o: 1, x: 9, y: 9 }] });
    const after = applyMove(s, pieceMoves(s, 0).find(m => m.kind === 'attack'));
    expect(after.pieces[1].st).toBe(CAPTURED);
    expect(after.cell[idx(4, 5)]).toBe(0);
  });
});

describe('sorties et fin de partie', () => {
  it('une Sentinelle première arrivée gagne aussitôt', () => {
    const s = position({ pieces: [{ t: SENTINEL, o: 0, x: 3, y: 9 }, { t: SENTINEL, o: 1, x: 3, y: 5 }] });
    const exit = pieceMoves(s, 0, true).find(m => m.kind === 'exit');
    const after = applyMove(s, exit);
    expect(after).toMatchObject({ over: true, winner: 0, reason: END.SENTINEL });
    expect(after.pieces[0].st).toBe(SCORED);
  });

  it('dedupeExit ne garde que la sortie la moins coûteuse', () => {
    const s = position({ pieces: [{ t: EXPLORER, o: 0, x: 3, y: 9 }] });
    expect(pieceMoves(s, 0).filter(m => m.kind === 'exit').length).toBeGreaterThan(1);
    expect(pieceMoves(s, 0, true).filter(m => m.kind === 'exit')).toHaveLength(1);
  });

  it('deux pièces arrivées : le meilleur score l’emporte', () => {
    const s = position({ pieces: [{ t: VANGUARD, o: 0, x: 3, y: 9 }, { t: EXPLORER, o: 1, x: 3, y: 0 }, { t: SENTINEL, o: 1, x: 6, y: 6 }], crossed: 1, score: [0, 1], turn: 0 });
    const after = applyMove(s, pieceMoves(s, 0, true).find(m => m.kind === 'exit'));
    expect(after).toMatchObject({ over: true, winner: 0, reason: END.TWO, score: [2, 1] });
  });

  it('égalité sans point : la pièce la plus proche de l’arrivée départage', () => {
    const s = position({ pieces: [{ t: EXPLORER, o: 0, x: 0, y: 7 }, { t: EXPLORER, o: 1, x: 9, y: 4 }], ply: MAX_PLIES - 1 });
    const after = applyMove(s, pieceMoves(s, 0).find(m => m.kind === 'move' && m.to === idx(0, 6)));
    expect(after).toMatchObject({ over: true, winner: 0, reason: END.PLIES, tiebreak: TIEBREAK.CLOSEST });
  });

  it('égalité parfaite : nul', () => {
    const s = position({ pieces: [{ t: EXPLORER, o: 0, x: 0, y: 5 }, { t: EXPLORER, o: 1, x: 9, y: 5 }], ply: MAX_PLIES - 1 });
    const after = applyMove(s, pieceMoves(s, 0).find(m => m.kind === 'move' && m.to === idx(0, 4)));
    expect(after.winner).toBe(DRAW);
  });

  it('un camp sans coup passe son tour', () => {
    // la Sentinelle bleue est murée dans son coin par des Sentinelles rouges qui se renforcent (Défense 4 > Attaque 3)
    const s = position({ pieces: [
      { t: SENTINEL, o: 0, x: 4, y: 4 }, { t: SENTINEL, o: 0, x: 1, y: 9 }, { t: SENTINEL, o: 0, x: 0, y: 8 }, { t: SENTINEL, o: 0, x: 1, y: 8 },
      { t: SENTINEL, o: 1, x: 0, y: 9 },
    ] });
    const after = applyMove(s, pieceMoves(s, 0).find(m => m.kind === 'move' && m.to === idx(4, 3)));
    expect(after.passed).toBe(true);
    expect(after.turn).toBe(0);
  });

  it('applyMove ne modifie pas la position de départ', () => {
    const s = newGame(generateTerrain('random', 7));
    const snapshot = JSON.stringify({ ...s, cell: [...s.cell], h: [...s.h] });
    applyMove(s, allMoves(s)[0]);
    expect(JSON.stringify({ ...s, cell: [...s.cell], h: [...s.h] })).toBe(snapshot);
  });
});

describe('résultat imposé', () => {
  it('garde le camp qui abandonne', () => {
    const s = withResult(newGame(flat()), { winner: 1, reason: END.RESIGN, resigned: 0 });
    expect(s).toMatchObject({ over: true, winner: 1, reason: END.RESIGN, resigned: 0, tiebreak: null });
  });
});

describe('identité des coups', () => {
  it('findMove retrouve le coup complet depuis sa forme courte', () => {
    const s = newGame(generateTerrain('valleys', 3));
    for (const m of allMoves(s)) expect(findMove(s, { pi: m.pi, kind: m.kind, to: m.to })).toEqual(m);
  });
  it('findMove refuse un coup illégal ou mal formé', () => {
    const s = newGame(flat());
    expect(findMove(s, { pi: 6, kind: 'move', to: 50 })).toBeNull(); // pièce bleue, Rouge au trait
    expect(findMove(s, { pi: '0', kind: 'move', to: 10 })).toBeNull();
    expect(findMove(s, null)).toBeNull();
  });
});
