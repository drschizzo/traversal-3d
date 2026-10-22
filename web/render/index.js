// Rendu 3D du jeu (Three.js) : ce que le reste du jeu peut demander à la scène.
// Le rendu ne connaît pas les règles ni l'état de la partie : on lui donne des positions et des coups à montrer.
import { buildTerrain, riseTerrain } from './board.js';
import { buildPieces, dropPieces } from './pieces.js';

export { compactMQ, wake } from './context.js';
export { startRendering, setQualityPref, qualityState, onQualityChange, resize } from './loop.js';
export { applyTheme, THEMES, themeById, currentTheme } from './theme.js';
export { showHeights, rising } from './board.js';
export { syncPieces, dropPieces, highlightPiece, liftPiece, PIP_DEFAULT } from './pieces.js';
export { showOverlays, clearOverlays, showHover, setSelectionRing, showPath, showHint, showPlan, clearPlan } from './overlays.js';
export { animateMove } from './fx.js';
export { panTo, revealCells, turnCameraTo, zoomedIn, autoRotate, shiftView, boardHalfWidthPx } from './camera.js';
export { pick } from './picking.js';
export { tween, easeIO, wait } from './tween.js';

/** Affiche un nouveau monde (hauteurs h, mode de terrain) avec les pièces de la position s : le plateau monte de la
 *  brume et les pièces tombent dessus. */
export function showWorld(h, mode, s) {
  buildTerrain(h, mode);
  buildPieces(s);
  riseTerrain(h);
  dropPieces();
}
