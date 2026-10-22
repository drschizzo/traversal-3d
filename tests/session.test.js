import { describe, it, expect, vi } from 'vitest';
import { MODES, isHuman, judgedSides, viewerSide } from '../web/session/modes.js';
import { createPhase, canGo, PHASES } from '../web/session/phase.js';
import { undoPoint, clampPly, wireMoves } from '../web/session/history.js';
import { addGame, progressStats, PROGRESS_MAX } from '../web/coach/progress.js';

describe('modes de jeu', () => {
  it('chaque mode déclare toutes les capacités', () => {
    const keys = Object.keys(MODES.bot).sort();
    for (const m of Object.values(MODES)) expect(Object.keys(m).sort()).toEqual(keys);
  });
  it('qui joue sur cet écran', () => {
    expect([0, 1].map(t => isHuman({ mode: 'bot', side: 1 }, t))).toEqual([false, true]);
    expect([0, 1].map(t => isHuman({ mode: 'pvp', side: 0 }, t))).toEqual([true, true]);
    expect([0, 1].map(t => isHuman({ mode: 'bvb', side: 0 }, t))).toEqual([false, false]);
    expect([0, 1].map(t => isHuman({ mode: 'online', side: 0 }, t))).toEqual([true, false]);
  });
  it('camps jugés et camp à qui l’on parle', () => {
    expect(judgedSides({ mode: 'bot', side: 1 })).toEqual([1]);
    expect(judgedSides({ mode: 'pvp', side: 0 })).toEqual([0, 1]);
    expect(viewerSide({ mode: 'online', side: 1 })).toBe(1);
    expect(viewerSide({ mode: 'pvp', side: 1 })).toBe(-1);
  });
});

describe('phases de la partie', () => {
  it('un tour peut commencer depuis n’importe quelle phase', () => {
    for (const from of PHASES) for (const to of ['human', 'bot', 'over', 'idle']) expect(canGo(from, to)).toBe(true);
  });
  it('déroulé d’un coup avec entraînement', () => {
    const onInvalid = vi.fn(), onChange = vi.fn();
    const p = createPhase({ onInvalid, onChange });
    for (const to of ['intro', 'human', 'animating', 'judging', 'coach', 'human', 'animating', 'bot', 'animating', 'human']) p.to(to);
    expect(onInvalid).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith('human', 'animating');
  });
  it('signale une transition impossible', () => {
    const onInvalid = vi.fn();
    const p = createPhase({ onInvalid });
    p.to('human');
    p.to('coach');
    expect(onInvalid).toHaveBeenCalledWith('human', 'coach');
  });
  it('dit quand le joueur peut agir', () => {
    const p = createPhase();
    p.to('human'); expect(p.busy()).toBe(false);
    p.to('bot'); expect(p.busy()).toBe(true);
    p.to('over'); expect(p.busy()).toBe(true);
    p.to('paused'); expect(p.busy()).toBe(false);
  });
  it('refuse une phase inconnue', () => {
    expect(() => createPhase().to('lunch')).toThrow();
  });
});

describe('historique', () => {
  const pos = turns => turns.map(turn => ({ turn }));
  it('reprendre un coup revient au dernier tour humain', () => {
    const human = t => t === 0;
    expect(undoPoint(pos([0, 1, 0, 1]), human)).toBe(2); // coup du joueur et réponse du bot repris
    expect(undoPoint(pos([0, 1, 0]), human)).toBe(2);
    expect(undoPoint(pos([1, 0, 1]), human)).toBe(1);
    expect(undoPoint(pos([1]), human)).toBe(0);
    expect(undoPoint([], human)).toBe(-1);
  });
  it('à deux sur un écran, un seul coup est repris', () => {
    expect(undoPoint(pos([0, 1, 0]), () => true)).toBe(2);
  });
  it('borne la navigation et abrège les coups', () => {
    expect([clampPly(-1, 5), clampPly(3, 5), clampPly(9, 5)]).toEqual([0, 3, 5]);
    expect(wireMoves([{ before: {}, move: { pi: 1, kind: 'move', to: 7, path: [1, 7] } }])).toEqual([{ pi: 1, kind: 'move', to: 7 }]);
  });
});

describe('progression', () => {
  const item = (loss, theme = 'safety') => ({ side: 0, grade: loss > 25 ? 'blunder' : 'best', loss, theme });
  it('ajoute une partie, remplace une partie déjà comptée, garde les dernières', () => {
    let list = addGame([], [item(0), item(40)], { id: 'a', side: 0, level: 'hard', now: 1 });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'a', n: 2, solid: 1, themes: { safety: 1 } });
    list = addGame(list, [item(0)], { id: 'a', side: 0, level: 'hard', now: 2 });
    expect(list).toHaveLength(1);
    for (let k = 0; k < 50; k++) list = addGame(list, [item(0)], { id: String(k), side: 0, level: 'hard' });
    expect(list).toHaveLength(PROGRESS_MAX);
    expect(addGame([], [item(0)], { id: 'b', side: 1, level: 'hard' })).toBeNull();
  });
  it('compare les cinq dernières parties aux cinq d’avant', () => {
    const list = [...Array(5).fill({ acc: 60, themes: {} }), ...Array(5).fill({ acc: 80, themes: { race: 2 } })];
    expect(progressStats(list)).toEqual({ games: 10, n: 5, acc: 80, prev: 60, theme: 'race' });
    expect(progressStats([])).toBeNull();
  });
});
