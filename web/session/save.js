// Sauvegarde de la partie locale en cours, pour la reprendre après un rechargement : ce qui est gardé, et sa relecture
import * as G from '../../core/index.js';
import { isLevel } from '../bot/levels.js';
import { load, save } from '../storage.js';
import { MODES } from './modes.js';
import { wireMoves } from './history.js';
import { S, play, mode, gameActive } from './store.js';

export function saveGame() {
  if (!mode().local) return; // la partie en ligne est gardée par le serveur (session dans net.js)
  if (!gameActive()) return save('game', null);
  save('game', { v: 1, seed: S.worldSeed, terrain: S.worldTerrain, play, moves: wireMoves(S.movesLog) });
}

// partie sauvegardée, rejouée sur le monde reconstruit à partir de sa graine ; null si elle manque, est inutilisable
// ou déjà finie
export function savedGame() {
  const d = load('game');
  if (!d || !G.isTerrain(d.terrain)) return null;
  if (!MODES[d.play?.mode]?.local || ![0, 1].includes(d.play.side) || !isLevel(d.play.level)) return null;
  const seed = d.seed >>> 0, r = G.replay(seed, d.terrain, d.moves);
  if (!r) { save('game', null); return null; }
  if (r.state.over) return null;
  return { seed, terrain: d.terrain, play: d.play, replay: r };
}
