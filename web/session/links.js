// Parties par lien (#g=…) et invitations à un salon (#r=CODE)
import * as G from '../../core/index.js';
import * as Net from '../net.js';
import { wireMoves } from './history.js';
import { S, cfg, play } from './store.js';
import { installGame, saveGame, enterGame } from './game.js';
import * as V from './view.js';

const pageUrl = () => location.origin + location.pathname + location.search;
// adresse qui contient toute la partie en cours (monde et coups joués)
export const matchLink = () => `${pageUrl()}#g=${G.encodeMatch({ seed: S.worldSeed, terrain: S.worldTerrain, moves: wireMoves(S.movesLog) })}`;

// lien de partie dans l'adresse : la partie est rejouée en silence et s'affiche, à deux sur cet écran ;
// lien d'invitation (#r=CODE) : renvoie le code du salon à rejoindre. L'adresse est ensuite nettoyée.
export function readLink() {
  const h = new URLSearchParams(location.hash.slice(1)), g = h.get('g'), room = Net.normalizeCode(h.get('r'));
  if (!g && !room) return null;
  window.history.replaceState(null, '', pageUrl());
  if (room) return Net.CODE_RE.test(room) ? { room } : null;
  let d, r = null;
  try { d = G.decodeMatch(g); r = G.replay(d.seed, d.terrain, d.moves); } catch {}
  if (!r) { V.toast('Lien de partie invalide.'); return null; }
  Object.assign(play, { mode: 'pvp', side: 0, level: cfg.level });
  Object.assign(cfg, { mode: 'pvp', where: 'local', terrain: d.terrain });
  V.emit('menu');
  installGame(d.seed, d.terrain, r);
  saveGame();
  enterGame();
  const n = d.moves.length;
  V.toast(r.state.over ? 'Partie terminée chargée depuis le lien.' : `Partie chargée depuis le lien : ${n} coup${n > 1 ? 's' : ''} joué${n > 1 ? 's' : ''}.`);
  return { game: true };
}
