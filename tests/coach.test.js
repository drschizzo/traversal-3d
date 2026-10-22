import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SENTINEL, EXPLORER, VANGUARD, idx, newGame, pieceMoves, allMoves, applyMove, startPosition, sameMove } from '../core/index.js';
import { explain, winProb } from '../web/coach/explain.js';
import { reviewMove, summary, keyMoments, isError, missedChance } from '../web/coach/review.js';
import { moveText, pieceRef } from '../web/coach/wording.js';
import { rich } from '../web/ui/html.js';
import { loadEngine, think } from '../web/bot/wasm-bridge.js';
import { flat, fullPosition as position } from './helpers.js';

const ex = await loadEngine(readFileSync(new URL('../engine/traversal.wasm', import.meta.url)));
const analyse = s => think(ex, s, 'review', true, 1);
const ME = { view: 0, me: 0 };

describe('les pièces et les coups en mots', () => {
  const s = startPosition('random', 1);
  it('nomme une pièce sans coordonnées, par son flanc', () => {
    expect(pieceRef(s, 0, ME)).toBe('votre ▲ Sentinelle de gauche');
    expect(pieceRef(s, 5, ME)).toBe('votre ▲ Sentinelle de droite');
    expect(pieceRef(s, 6, ME)).toBe('la ▲ Sentinelle adverse de gauche');
    expect(pieceRef(s, 6, { view: 1, me: -1 })).toBe('la ▲ Sentinelle bleue de droite');
  });
  it('décrit un coup par ce qu’il fait', () => {
    const s = newGame(flat());
    const m = pieceMoves(s, 0).find(x => x.to === idx(2, 2));
    expect(moveText(s, m, ME)).toBe('Votre ▲ Sentinelle de gauche avance de 2 rangées');
  });
});

describe('explication d’un coup', () => {
  it('une capture devient l’idée du coup', () => {
    const s = position({ pieces: [{ t: SENTINEL, o: 0, x: 4, y: 4 }, { t: VANGUARD, o: 1, x: 4, y: 5 }, { t: SENTINEL, o: 1, x: 9, y: 9 }] });
    const m = pieceMoves(s, 0).find(x => x.kind === 'attack');
    const a = explain(s, m, analyse(s).info, { ctx: ME });
    expect(a.idea.theme).toBe('capture');
    expect(a.idea.idea).toMatch(/^Capturer l’◆ Avant-garde adverse/);
  });

  it('une Sentinelle première arrivée gagne la partie', () => {
    const s = position({ pieces: [{ t: SENTINEL, o: 0, x: 3, y: 9 }, { t: SENTINEL, o: 1, x: 3, y: 4 }] });
    const m = pieceMoves(s, 0, true).find(x => x.kind === 'exit');
    const a = explain(s, m, analyse(s).info, { ctx: ME });
    expect(a.idea.weight).toBe(100);
    expect(a.verdict.pSide).toBe(1);
  });

  it('un coup jugé signale la pièce laissée en prise', () => {
    // l'Explorateur avance à portée de la Sentinelle adverse
    const s = position({ pieces: [{ t: EXPLORER, o: 0, x: 0, y: 2 }, { t: SENTINEL, o: 1, x: 0, y: 7 }, { t: SENTINEL, o: 0, x: 9, y: 0 }] });
    const m = pieceMoves(s, 0).find(x => x.to === idx(0, 5));
    const a = explain(s, m, analyse(s).info, { judged: true, ctx: ME });
    expect(a.idea).toMatchObject({ theme: 'safety', tone: 'bad' });
  });

  it('les textes sont du texte enrichi, sans HTML', () => {
    const s = startPosition('mountains', 4);
    const r = analyse(s);
    const a = explain(s, r.move, r.info, { ctx: ME });
    for (const t of [a.verdict.text, ...a.reasons.map(x => x.text)]) expect(t).not.toMatch(/</);
  });

  it('les chances de gain croissent avec l’évaluation', () => {
    expect(winProb(0)).toBe(0.5);
    expect(winProb(60)).toBeGreaterThan(0.8);
    expect(winProb(-60)).toBeLessThan(0.2);
  });
});

describe('jugement des coups', () => {
  const s = startPosition('valleys', 21);
  const thinkAsync = st => Promise.resolve(analyse(st));

  it('le coup du moteur est le meilleur coup', async () => {
    const best = analyse(s).move;
    const r = await reviewMove(thinkAsync, s, best, ME);
    expect(r).toMatchObject({ isBest: true, grade: 'best', loss: 0, why: null });
  });

  it('un coup qui laisse capturer une pièce est une faute, expliquée par la réponse adverse', async () => {
    const s2 = position({ pieces: [
      { t: VANGUARD, o: 0, x: 4, y: 2 }, { t: SENTINEL, o: 0, x: 0, y: 0 },
      { t: SENTINEL, o: 1, x: 4, y: 7 }, { t: SENTINEL, o: 1, x: 9, y: 9 },
    ] });
    const bad = pieceMoves(s2, 0).find(x => x.to === idx(4, 5));
    const best = pieceMoves(s2, 1).find(x => x.to === idx(0, 3));
    // évaluations imposées : le meilleur coup garde l'équilibre, le coup joué perd l'Avant-garde
    const fake = st => {
      const { info } = analyse(st);
      if (st === s2) return Promise.resolve({ move: best, info: { ...info, score: 0, alts: [{ move: best, score: 0 }], pv: [{ move: best, before: s2 }] } });
      const capture = pieceMoves(st, 6).find(x => x.kind === 'attack');
      return Promise.resolve({ move: capture, info: { ...info, score: 80, pv: [{ move: capture, before: st }] } });
    };
    const r = await reviewMove(fake, s2, bad, ME);
    expect(r.grade).toBe('blunder');
    expect(r.why).toBe('L’adversaire répond en capturant votre ◆ Avant-garde.');
    expect(r.theme).toBe('safety');
  });

  it('le bilan et les moments clés se calculent sur les coups jugés', async () => {
    const moves = allMoves(s);
    const items = [await reviewMove(thinkAsync, s, moves[0], ME), await reviewMove(thinkAsync, s, analyse(s).move, ME)];
    const sum = summary(items, 0);
    expect(sum.n).toBe(2);
    expect(sum.accuracy).toBeGreaterThan(0);
    expect(keyMoments(items, [0]).every(i => isError(items[i]))).toBe(true);
    expect(sameMove(items[1].best, items[1].move)).toBe(true);
  });
});

describe('occasion manquée', () => {
  it('reprend l’idée du meilleur coup quand c’est une action', () => {
    expect(missedChance({ idea: { tone: 'good', idea: 'Capturer l’◆ Avant-garde adverse' }, title: '…' }))
      .toBe('Occasion manquée : il fallait capturer l’◆ Avant-garde adverse.');
  });
  it('décrit le meilleur coup quand son idée n’est qu’un constat', () => {
    expect(missedChance({ idea: { tone: 'info', idea: 'Course inchangée' }, title: 'Votre ⬟ Explorateur de droite avance d’une rangée' }))
      .toBe('Occasion manquée : le bot aurait joué ainsi : votre ⬟ Explorateur de droite avance d’une rangée.');
  });
});

describe('texte enrichi', () => {
  it('échappe le HTML et met en gras', () => {
    expect(rich('**Capture** de <script>')).toBe('<b>Capture</b> de &lt;script&gt;');
  });
});

it('applyMove reste utilisé tel quel par les explications (pas de mutation)', () => {
  const s = startPosition('random', 8);
  const before = JSON.stringify(s.pieces);
  explain(s, allMoves(s)[0], analyse(s).info, { ctx: ME });
  applyMove(s, allMoves(s)[0]);
  expect(JSON.stringify(s.pieces)).toBe(before);
});
