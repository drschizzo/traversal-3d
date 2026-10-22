// Boucle de rendu, réglage de la qualité et adaptation à la taille de la fenêtre.
//
// Rendu à la demande (niveaux sans « live ») : une image n'est recalculée que si quelque chose bouge
// (animation, caméra, pièce sélectionnée…) ou juste après une action ; sinon l'image affichée reste valable.
// Le temps des animations n'avance que sur les images rendues : rien ne saute à la reprise.
// Les particules, qui sinon resteraient figées en l'air, s'effacent doucement avant l'arrêt et reviennent à la reprise.
import * as THREE from 'three';
import { renderer, scene, camera, controls, gfx, sun, wake, fitCamera } from './context.js';
import { QUALITY, LEVELS_ORDER, levelFor } from './quality.js';
import { composer, applyPostQuality, setPostTime, sizePostFx } from './postfx.js';
import { fieldMat, updateField, fieldFading, applyFieldQuality, ensureNoiseTex, sizeField } from './background.js';
import { terrainMat, plinth, stepRise, rising } from './board.js';
import { particleFade, updateAmbient, applyAmbientQuality } from './ambient.js';
import { setSurfaceTime } from './surfaces.js';
import { stepTweens, tweening } from './tween.js';
import { stepBursts, bursting } from './fx.js';
import { updateLifted, liftedPiece } from './pieces.js';
import { updateOverlays, hintShown } from './overlays.js';
import { keepPanInBounds } from './camera.js';
import { save } from '../storage.js';

// ---------------------------------------------------------------- qualité
const qualityListeners = [];
/** fn(niveau, auto) est appelée à chaque changement de niveau ; auto : baisse décidée par le réglage automatique */
export const onQualityChange = fn => qualityListeners.push(fn);

// bascule bruit calculé / bruit précalculé selon le niveau de qualité (recompile les matériaux concernés)
function applyNoiseMode() {
  if (gfx.Q.bakedNoise) ensureNoiseTex();
  for (const m of [fieldMat, terrainMat, plinth.material]) {
    if (gfx.Q.bakedNoise) m.defines.BAKED_NOISE = '';
    else delete m.defines.BAKED_NOISE;
    m.needsUpdate = true;
  }
}
applyNoiseMode();

function applyQuality(level, auto = false) {
  const prev = gfx.Q;
  wake(1000);
  gfx.level = level;
  gfx.Q = QUALITY[level];
  renderer.setPixelRatio(Math.min(devicePixelRatio, gfx.Q.pr));
  renderer.setSize(innerWidth, innerHeight);
  applyPostQuality();
  applyFieldQuality(prev);
  if (prev.bakedNoise !== gfx.Q.bakedNoise) applyNoiseMode();
  if (prev.shadow !== gfx.Q.shadow || prev.soft !== gfx.Q.soft) {
    sun.shadow.mapSize.set(gfx.Q.shadow, gfx.Q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    renderer.shadowMap.type = gfx.Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    scene.traverse(o => { const mat = /** @type {any} */ (o).material; if (mat) for (const m of [].concat(mat)) m.needsUpdate = true; });
    gfx.shadowDirty = true;
  }
  applyAmbientQuality();
  for (const fn of qualityListeners) fn(gfx.level, auto);
}

/** Préférence du joueur : 'auto', 'high', 'medium' ou 'low' (gardée d'une visite à l'autre). */
export function setQualityPref(pref) {
  gfx.qualityPref = pref;
  save('quality', pref);
  autoQ.until = performance.now() + 3000;
  applyQuality(levelFor(pref));
}
export const qualityState = () => ({ pref: gfx.qualityPref, level: gfx.level, name: gfx.Q.name });

// Réglage automatique : si l'image tourne sous 45 images/s sur deux fenêtres de 2 s d'affilée, un cran de moins.
// Les premières secondes (compilation des shaders) et les onglets en arrière-plan sont ignorés.
const autoQ = { frames: 0, time: 0, bad: 0, until: performance.now() + 4000 };
function autoQuality(rawDt) {
  if (gfx.qualityPref !== 'auto' || gfx.level === 'low' || document.hidden) return;
  const now = performance.now();
  if (now < autoQ.until || rawDt > 1) { autoQ.frames = 0; autoQ.time = 0; return; } // vrai blocage (onglet repris…) : on recommence
  autoQ.frames++;
  autoQ.time += rawDt;
  if (autoQ.time < 2) return;
  const fps = autoQ.frames / autoQ.time;
  autoQ.frames = 0;
  autoQ.time = 0;
  autoQ.bad = fps < 45 ? autoQ.bad + 1 : 0;
  if (autoQ.bad >= 2) { // deux fenêtres lentes d'affilée
    autoQ.bad = 0;
    applyQuality(LEVELS_ORDER[LEVELS_ORDER.indexOf(gfx.level) + 1], true);
    autoQ.until = now + 2500;
  }
}

// ---------------------------------------------------------------- taille de la fenêtre
export function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  sizePostFx();
  sizeField();
  fitCamera();
}

// ---------------------------------------------------------------- boucle
for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'resize', 'fullscreenchange'])
  addEventListener(ev, () => wake(), { capture: true, passive: true });
document.addEventListener('visibilitychange', () => wake());

let animT = 0, frameNo = 0;
function frame(rawDt) {
  const lifted = liftedPiece() >= 0;
  const moving = tweening() || bursting() || rising() || gfx.shadowDirty || lifted || hintShown() || controls.autoRotate || fieldFading();
  if (moving) wake(200);
  const awake = gfx.Q.live || performance.now() <= gfx.wakeUntil;
  if (!awake && particleFade.value <= 0) {
    if (controls.update()) wake(200); // l'inertie de la caméra relance le rendu
    return;
  }
  frameNo++;
  autoQuality(rawDt);
  const dt = Math.min(rawDt, 0.05), t = (animT += dt);
  particleFade.value = awake ? Math.min(1, particleFade.value + dt / 0.5) : Math.max(0, particleFade.value - dt / 0.8);
  stepTweens(dt);
  stepBursts(dt);
  updateOverlays(t, updateLifted(t));
  updateAmbient(t);
  setPostTime(t);
  setSurfaceTime(t);
  // ombres recalculées à la demande ; la pièce sélectionnée qui flotte n'impose pas un recalcul à chaque image
  if (tweening() || rising() || gfx.shadowDirty || (lifted && frameNo % gfx.Q.shadowEvery === 0)) { renderer.shadowMap.needsUpdate = true; gfx.shadowDirty = false; }
  stepRise(dt);
  keepPanInBounds();
  if (controls.update()) wake(200);
  updateField(t, dt);
  if (gfx.Q.post) composer.render();
  else renderer.render(scene, camera);
}

export function startRendering() {
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => frame(clock.getDelta()));
}
