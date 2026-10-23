// Application d'un thème (themes.js) à toute la scène : brume, décor, lumières, post-traitement, particules,
// plateau et pièces
import * as THREE from 'three';
import { THEMES } from './themes.js';
import { renderer, scene, gfx, wake, HORIZON, HAZE_BAND, hemi, sun, fill } from './context.js';
import { applyBackgroundTheme } from './background.js';
import { applyPostTheme } from './postfx.js';
import { applyAmbientTheme } from './ambient.js';
import { applyBoardTheme } from './board.js';
import { applyPiecesTheme } from './pieces.js';

export { THEMES };
export const themeById = id => THEMES.find(t => t.id === id) || THEMES[0];
export const currentTheme = () => gfx.theme;

/** Applique le thème id (le premier s'il est inconnu) ; renvoie le thème appliqué. */
export function applyTheme(id) {
  const theme = gfx.theme = themeById(id);
  HORIZON.set(theme.horizon);
  scene.fog.color.copy(HORIZON);
  // brume sur le plateau lui-même : repoussée au loin dans un thème épuré, où rien ne doit voiler la lecture
  const fog = /** @type {THREE.Fog} */ (scene.fog);
  [fog.near, fog.far] = theme.fog || [34, 120];
  const band = new THREE.Color(theme.band);
  HAZE_BAND.set(band.r, band.g, band.b);
  applyBackgroundTheme(theme);
  const bloom = applyPostTheme(theme);
  applyAmbientTheme(theme);
  fill.intensity = 0.8; hemi.intensity = 0.6;
  hemi.color.set(theme.light.sky); hemi.groundColor.set(theme.light.ground);
  sun.color.set(theme.light.sun); fill.color.set(theme.light.fill);
  renderer.toneMappingExposure = theme.exposure ?? 1;
  applyPiecesTheme(bloom.threshold ?? 0.85);
  applyBoardTheme(theme);
  wake(1200);   // le temps de compiler les shaders du nouveau décor et de redessiner, même en rendu à la demande
  return theme;
}
