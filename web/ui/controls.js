// Barre d'outils de la partie : boutons présents selon le mode, et activés selon ce que la partie attend
import { S, phase, mode, isHuman } from '../session/store.js';
import { viewIndex, canNavigate } from '../session/playback.js';
import { $, icon } from './dom.js';
import { layoutHud } from './hud.js';

const HINT_LABELS = ['Conseil', 'La pièce', 'Le coup', 'Conseil'];
const HINT_TITLES = ['Une piste pour trouver le bon coup', 'Montrer la pièce à jouer', 'Montrer le coup à jouer', 'Le coup conseillé est affiché'];

export function updateControls() {
  const m = mode(), s = S.state, k = viewIndex(), nav = canNavigate(), viewing = S.viewPly !== null;
  for (const id of ['btnFirst', 'btnPrev', 'btnPlay', 'btnNext', 'btnLast']) $(id).classList.toggle('hidden', !m.playback);
  $('btnUndo').classList.toggle('hidden', !m.undo);
  $('btnHint').classList.toggle('hidden', !m.hint);
  $('btnCoach').classList.toggle('hidden', !m.coach);
  $('btnTrain').classList.toggle('hidden', !m.training);
  $('btnTrain').classList.toggle('on', S.training);
  // lecture (bot contre bot)
  const live = viewing ? S.liveState : s;
  const showPlay = S.paused || viewing;
  $('btnPlay').innerHTML = showPlay ? `${icon('play')}<span>Lecture</span>` : `${icon('pause')}<span>Pause</span>`;
  $('btnPlay').title = showPlay ? 'Revenir au présent et reprendre la partie' : 'Mettre en pause après ce coup';
  $('btnPlay').disabled = !live || live.over;
  $('btnFirst').disabled = $('btnPrev').disabled = !nav || k === 0;
  $('btnNext').disabled = viewing ? !nav : !S.paused || phase.busy() || !s || s.over;
  $('btnNext').title = viewing ? 'Coup suivant (déjà joué)' : 'Faire jouer un coup au bot';
  $('btnLast').disabled = !viewing;
  // conseil en trois temps
  $('btnHint').disabled = !s || s.over || !isHuman(s.turn) || !phase.is('human', 'coach') || S.hintPending || S.hintLevel >= 3;
  $('btnHint').querySelector('span').textContent = HINT_LABELS[S.hintLevel];
  $('btnHint').title = HINT_TITLES[S.hintLevel];
  if (s) $('btnUndo').disabled = !S.history.length;
  layoutHud();
}
