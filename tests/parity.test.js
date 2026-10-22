// Parité des règles JavaScript (core/) et Rust (engine/) : le bot calcule avec les secondes, le jeu et le serveur
// appliquent les premières. Le banc natif rejoue des parties au hasard et liste, à chaque coup, les coups légaux ;
// les règles JavaScript doivent trouver exactement les mêmes.
// Prérequis : cd engine && cargo build --release (fait par la CI ; le test est sauté sinon).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KINDS, END, TIEBREAK, generateTerrain, newGame, allMoves, applyMove, findEquivalent } from '../core/index.js';

const BIN = fileURLToPath(new URL('../engine/target/release/selfplay', import.meta.url));
const run = args => execFileSync(BIN, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
const REASONS = [null, END.SENTINEL, END.TWO, END.PLIES, END.STUCK];
const TIEBREAKS = [null, TIEBREAK.CLOSEST, TIEBREAK.STRONGEST];

describe.skipIf(!existsSync(BIN))('parité avec le moteur Rust', () => {
  it('génère les mêmes terrains', () => {
    for (const line of run(['terrain', 'n=40']).trim().split('\n')) {
      const [mode, seed, h] = line.split(' ');
      expect([...generateTerrain(mode, Number(seed))].join(','), `${mode} ${seed}`).toBe(h);
    }
  });

  it('trouve les mêmes coups légaux et la même fin de partie', () => {
    const games = run(['dump', 'games=60']).trim().split('\n').map(l => JSON.parse(l));
    for (const g of games) {
      let s = newGame(generateTerrain(g.mode, g.seed));
      for (const [k, ply] of g.plies.entries()) {
        const where = `${g.mode} ${g.seed}, coup ${k}`;
        const keys = allMoves(s, true).map(m => `${m.pi}:${KINDS.indexOf(m.kind)}:${m.kind === 'exit' ? 0 : m.to}`).sort();
        expect(keys.join(' '), where).toBe(ply.legal);
        expect(ply.hash, where).toBe(true);
        const [pi, kind, to] = ply.pick.split(':').map(Number);
        s = applyMove(s, findEquivalent(s, { pi, kind: KINDS[kind], to }));
      }
      expect(s.over).toBe(true);
      expect({ winner: s.winner, reason: s.reason, tiebreak: s.tiebreak, score: s.score })
        .toEqual({ winner: g.winner, reason: REASONS[g.reason], tiebreak: TIEBREAKS[g.tiebreak], score: g.score });
    }
  });
});
