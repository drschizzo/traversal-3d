// Le plateau sous les doigts et la souris : sélection d'une pièce, survol, coup joué d'un clic ou d'un toucher,
// et raccourcis clavier
import * as G from '../../core/index.js';
import * as R from '../render/index.js';
import * as Sound from '../audio/sound.js';
import { S, phase, mode, isHuman } from '../session/store.js';
import { performMove, undo } from '../session/turns.js';
import { tryPuzzle } from '../session/review.js';
import { goTo, viewIndex, stepForward } from '../session/playback.js';
import { $, shown, isTouch } from './dom.js';
import { showCard, showTip, hideTip, showMoveTip, setTools } from './hud.js';
import { closeConfirm } from './menu.js';

const canvas = $('scene');

export function select(pi, preview = false) {
  clearSelection();
  S.selected = pi;
  S.previewing = preview;
  S.selMoves = G.pieceMoves(S.state, pi);
  Sound.select(preview);
  R.showOverlays(S.selMoves, preview);
  R.liftPiece(pi);
  R.setSelectionRing(pi, preview);
  showCard(pi);
  // au doigt et zoomé : la vue glisse juste assez pour montrer la pièce et ses cases accessibles
  if (S.lastPointer !== 'mouse' && R.zoomedIn()) {
    const p = S.state.pieces[pi];
    R.revealCells([G.idx(p.x, p.y), ...S.selMoves.map(m => m.to)]);
  }
}

export function clearSelection() {
  S.selected = -1; S.selMoves = []; S.previewing = false;
  R.liftPiece(-1);
  R.setSelectionRing(-1);
  R.clearOverlays();
  R.showPath(S.hintMove);
  hideTip();
  showCard(-1);
}

// sous le pointeur : une pièce ou une case et, si une pièce est sélectionnée, le coup qui y mène (une pièce adverse : sa capture)
function pick(ev) {
  const res = R.pick(ev);
  if (!res.move && res.cell >= 0 && S.selected >= 0) {
    res.move = S.selMoves.find(m => m.to === res.cell && m.kind !== 'exit') || null;
  }
  return res;
}

// le joueur peut-il jouer ? Pendant l'analyse de partie, seulement pour chercher un meilleur coup (exercice).
const canPlay = () => {
  const s = S.state, pz = S.puzzle;
  if (!s || s.over || !isHuman(s.turn)) return false;
  return phase.is('human', 'coach') || (phase.is('puzzle') && !!pz && !pz.solved && !pz.showSolution);
};

let hoveredMove = null;
function onHover(e) {
  if (!S.state || !shown('hud')) return;
  const h = pick(e), busy = phase.busy();
  // un tic à peine audible en passant d'une case accessible à une autre
  if (h.move && h.move !== hoveredMove && !busy) Sound.tick();
  hoveredMove = h.move;
  R.highlightPiece(h.pi, S.selected);
  canvas.style.cursor = ((h.move && !S.previewing) || h.pi >= 0) && !busy ? 'pointer' : 'default';
  R.showHover(busy ? -1 : h.cell, h.move);
  // chemin et infobulle
  R.showPath(h.move || S.hintMove);
  if (h.move) showMoveTip(h.move, e);
  else if (h.cell >= 0 && S.showHeights) showTip(`Hauteur <b>${S.state.h[h.cell]}</b>`, e);
  else hideTip();
  if (S.selected < 0) showCard(h.pi);
}

// Au toucher, pas de survol : tant que le doigt est posé sur une case, son chemin s'affiche ;
// relâcher joue le coup, glisser l'annule (et tourne la vue), un second doigt aussi (zoom, déplacement).
let downAt = null, toolsWereOpen = false, pendingMove = null;
const fingers = new Set();
function cancelTap() {
  downAt = null;
  hideTip();
  R.showPath(S.hintMove);
}
const releaseFinger = e => fingers.delete(e.pointerId);
const moved = e => Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6;

export function initInput() {
  canvas.addEventListener('pointerdown', e => {
    S.lastPointer = e.pointerType;
    toolsWereOpen = $('hud').classList.contains('tools-open');
    setTools(false);
    if (isTouch(e)) {
      fingers.add(e.pointerId);
      if (fingers.size > 1) return cancelTap();
    }
    downAt = [e.clientX, e.clientY];
    if (isTouch(e) && !toolsWereOpen && S.selected >= 0 && canPlay()) onHover(e);
  });
  canvas.addEventListener('pointercancel', e => { releaseFinger(e); cancelTap(); });
  canvas.addEventListener('pointerup', e => {
    releaseFinger(e);
    if (!downAt || moved(e)) return;
    downAt = null;
    if (toolsWereOpen || !canPlay()) return;
    const h = pick(e);
    if (h.move && S.selected >= 0 && !S.previewing) return void (S.puzzle ? tryPuzzle(h.move) : performMove(h.move));
    // une pièce adverse (ou une des siennes hors de son tour) s'ouvre en aperçu : ses coups sont montrés, pas jouables
    if (h.pi >= 0) return void (h.pi === S.selected ? clearSelection() : select(h.pi, S.state.pieces[h.pi].o !== S.state.turn));
    clearSelection();
  });
  canvas.addEventListener('pointermove', e => {
    if (isTouch(e)) {
      if (downAt && moved(e)) cancelTap();
      return;
    }
    if (!pendingMove) requestAnimationFrame(() => { const ev = pendingMove; pendingMove = null; onHover(ev); });
    pendingMove = e;
  });

  addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (shown('confirm')) return closeConfirm(false);
      clearSelection();
      $('rules').classList.add('hidden');
    }
    if (mode().playback && shown('hud') && !shown('menu')) {
      if (e.key === 'ArrowLeft') goTo(viewIndex() - 1);
      if (e.key === 'ArrowRight') stepForward();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') undo();
  });
}
