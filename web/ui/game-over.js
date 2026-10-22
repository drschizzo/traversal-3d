// Fenêtre de fin de partie : vainqueur, scores, pièces arrivées et perdues, fautes à revoir
import * as G from '../../core/index.js';
import { PLAYER_NAMES, TYPE_GLYPHS, endReason } from '../i18n/fr.js';
import { isError } from '../coach/review.js';
import { S, play, phase, mode } from '../session/store.js';
import { recordProgress } from '../session/review.js';
import { updateRematchButton } from '../session/online.js';
import { $ } from './dom.js';
import { setStatus } from './hud.js';
import { TEAM } from './colors.js';

export function showGameOver() {
  if (phase.is('review', 'puzzle') || S.viewPly !== null) return;
  const s = S.state, w = s.winner, seated = mode().seated;
  let title;
  if (w === G.DRAW) title = 'Match nul';
  else if (seated) title = w === play.side ? 'Victoire' : 'Défaite';
  else title = `${PLAYER_NAMES[w]} l’emporte`;
  $('overTitle').textContent = title;
  // couleur d'ambiance : le gagnant (or pour un nul, gris pour une défaite contre le bot)
  const lost = seated && w !== G.DRAW && w !== play.side;
  $('overCard').style.setProperty('--win', w === G.DRAW ? '#f2c46d' : lost ? '#9aa1b2' : TEAM[w].css);
  $('overReason').textContent = endReason(s) + '.';
  const glyphs = (o, st) => s.pieces.filter(p => p.o === o && p.st === st).map(p => TYPE_GLYPHS[p.t]).join('');
  for (let o = 0; o < 2; o++) {
    $('overS' + o).textContent = s.score[o];
    $('overName' + o).textContent = $('name' + o).textContent;
    const arrived = glyphs(o, G.SCORED), captured = glyphs(o, G.CAPTURED);
    $('overLine' + o).innerHTML = [arrived && `Arrivée <b>${arrived}</b>`, captured ? `Pertes <b>${captured}</b>` : 'Aucune perte'].filter(Boolean).join(' · ');
    $('overTeam' + o).classList.toggle('win', w === o);
    $('overTeam' + o).classList.toggle('lose', w !== G.DRAW && w !== o);
  }
  const caps = S.movesLog.filter(x => x.move.kind === 'attack').length;
  $('overStats').textContent = `${s.ply} coups · ${caps} capture${caps > 1 ? 's' : ''} · ${S.worldLabel}`;
  $('btnReview').classList.toggle('hidden', !S.movesLog.some(x => x.human));
  // entraînement : les coups déjà jugés donnent tout de suite le nombre de fautes à revoir
  const live = S.movesLog.filter(x => x.human).map(x => S.liveReviews.get(x.before));
  const faults = live.filter(r => r && isError(r)).length;
  $('btnReview').innerHTML = `<span aria-hidden="true">✦</span> Analyser la partie${faults ? ` · ${faults} faute${faults > 1 ? 's' : ''} à revoir` : ''}`;
  if (live.length && live.every(Boolean)) recordProgress(live, s);
  updateRematchButton();
  $('over').classList.remove('hidden');
  setStatus(title, w === G.DRAW ? 0 : w);
}
