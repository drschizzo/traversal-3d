// L'espace des plateaux possibles. Le plateau joué se dresse sur un socle au milieu d'un pavage infini d'autres
// plateaux possibles, tous produits par le même générateur. Ce pavage est rendu en raymarching volumétrique
// (glsl/field.frag.glsl) : une brume dont la densité épouse le relief en colonnes de chaque plateau, et qui se perd
// dans le brouillard d'horizon. Il est rendu à part, en basse résolution et flouté, puis sert de fond à la scène.
//
// Chaque thème dit ce que sont ces plateaux voisins (DECORS) : des vallées de brume, les ébauches posées sur
// l'établi, un récif, des coulées de lave, une banquise, des croquis à la craie, les pièces d'une galerie, une ville
// en contrebas, les pierres d'un jardin sec. Le relief ne change pas : la matière qui l'habille, oui.
//
// Fond simple (qualité basse, thèmes épurés) : à cette résolution le pavage ne serait qu'une bouillie, et il coûte
// cher là où il faut économiser. On le remplace alors par le ciel du thème (sky.frag.glsl) et son sol, qui ne
// coûtent qu'une passe triviale et restent nets.
import * as THREE from 'three';
import { TERRAINS, generateTerrain, randomSeed, cx, cy } from '../../core/index.js';
import { renderer, scene, camera, gfx, HORIZON, HAZE_BAND, FLOOR_Y, fullScreenMesh } from './context.js';
import { NOISE_N } from './glsl/chunks.js';
import floorFrag from './glsl/floor.frag.glsl?raw';
import fieldVert from './glsl/field.vert.glsl?raw';
import fieldFrag from './glsl/field.frag.glsl?raw';
import skyFrag from './glsl/sky.frag.glsl?raw';
import blurFrag from './glsl/blur.frag.glsl?raw';

const TILE_PITCH = 12;                  // un plateau 10×10 + une allée de brume
const ATLAS_N = 8;                      // atlas de 8×8 = 64 plateaux distincts
const FIELD_TOP = FLOOR_Y + 3.3;

// décors (theme.decor) : chacun compile sa variante du shader du pavage (#ifdef DECOR_* dans field.frag.glsl) ;
// « valleys » est le décor par défaut, celui du #else, donc sans define
const DECORS = {
  valleys: '', bench: 'DECOR_BENCH', reef: 'DECOR_REEF', lava: 'DECOR_LAVA', floes: 'DECOR_FLOES',
  chalk: 'DECOR_CHALK', gallery: 'DECOR_GALLERY', grid: 'DECOR_GRID', garden: 'DECOR_GARDEN',
};
let decorDefine = '';
let theme = null;     // thème appliqué
let simple = false;   // fond simple : ciel et sol du thème, sans pavage
// brume du pavage au pied du socle (board.js) : il n'y en a pas quand il n'y a pas de pavage
export const mistAmount = { value: 0.85 };

// sol sombre sous la brume, qui se fond dans l'horizon
// couleurs du décor qui portent un fond simple : le gros de la brume et le halo de ses sommets
const backdropHaze = { value: new THREE.Color() }, backdropGlow = { value: new THREE.Color() };
const floorMat = new THREE.ShaderMaterial({
  uniforms: {
    base: { value: new THREE.Color(0x0a0c16) }, fogc: { value: HORIZON }, band: { value: HAZE_BAND },
    haze: backdropHaze, glow: backdropGlow,
  },
  vertexShader: 'varying vec3 vWp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: floorFrag,
});
// Sous le pavage, le sol n'écrit que la profondeur (la brume le recouvre) ; avec un fond simple, il devient
// visible et donne au plateau une surface où poser.
const hiddenFloorMat = new THREE.MeshBasicMaterial({ colorWrite: false });
/** @type {THREE.Mesh<THREE.PlaneGeometry, THREE.Material>} */
const floor = new THREE.Mesh(new THREE.PlaneGeometry(440, 440), hiddenFloorMat);
{
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  scene.add(floor);
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.4 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = FLOOR_Y + 0.005;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);
}

// atlas des hauteurs : 64 plateaux générés, entre lesquels chaque case du pavage glisse lentement
const atlas = new THREE.DataTexture(new Uint8Array(ATLAS_N * 10 * ATLAS_N * 10 * 4), ATLAS_N * 10, ATLAS_N * 10, THREE.RGBAFormat);
atlas.magFilter = atlas.minFilter = THREE.NearestFilter;
function writeAtlas(slot, channel, h) {
  const sx = (slot % ATLAS_N) * 10, sy = Math.floor(slot / ATLAS_N) * 10, W = ATLAS_N * 10;
  for (let i = 0; i < 100; i++) atlas.image.data[((sy + cy(i)) * W + sx + cx(i)) * 4 + channel] = h[i];
  atlas.needsUpdate = true;
}
for (let k = 0; k < ATLAS_N * ATLAS_N; k++) writeAtlas(k, 0, generateTerrain(TERRAINS[k % TERRAINS.length], randomSeed()));

// Bruit 3D précalculé (qualité basse) : les valeurs pseudo-aléatoires du réseau sont rangées dans une texture 3D
// et lues par interpolation matérielle, avec le même lissage que le calcul direct : une lecture au lieu de huit hachages.
export const noiseUniform = { value: null };
export function ensureNoiseTex() {
  if (noiseUniform.value) return;
  const n = NOISE_N, data = new Uint8Array(n * n * n), fr = v => v - Math.floor(v), h = v => fr(v * 0.3183099 + 0.1) * 17;
  for (let z = 0, k = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++, k++) {
        const a = h(x), b = h(y), c = h(z);
        data[k] = Math.round(fr(a * b * c * (a + b + c)) * 255);
      }
  const tex = new THREE.Data3DTexture(data, n, n, n);
  tex.format = THREE.RedFormat;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  noiseUniform.value = tex;
}

export const fieldMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  defines: {
    FIELD_STEPS: gfx.Q.steps, FIELD_OCTAVE2: gfx.Q.octave2,
    FIELD_FLOOR: FLOOR_Y.toFixed(2), FIELD_TOP: FIELD_TOP.toFixed(2), FIELD_PITCH: TILE_PITCH.toFixed(1), FIELD_ATLAS: ATLAS_N.toFixed(1),
  },
  uniforms: {
    uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uFloor: { value: floorMat.uniforms.base.value },
    uAtlas: { value: atlas }, uTime: { value: 0 }, uFade: { value: 0 },
    fogc: { value: HORIZON }, band: { value: HAZE_BAND },
    uLow: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHigh: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() },
    uBeam: { value: new THREE.Color(0) }, uBeamDir: { value: new THREE.Vector2(0.8, 0.6) }, uAlley: { value: new THREE.Color(0) },
    uCaus: { value: 0 }, uSparkle: { value: 0 }, uNoise3D: noiseUniform,
  },
  vertexShader: fieldVert,
  fragmentShader: fieldFrag,
});
// couleur des creux du pavage : le pied du socle s'y noie (board.js)
export const mistColor = fieldMat.uniforms.uLow.value;

// ciel du fond simple : un triangle plein écran dessiné avant tout le reste, le sol s'y pose
const skyMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: {
    uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    fogc: { value: HORIZON }, band: { value: HAZE_BAND }, top: { value: new THREE.Color() },
    haze: backdropHaze, glow: backdropGlow,
  },
  vertexShader: fieldVert,
  fragmentShader: skyFrag,
});
const sky = fullScreenMesh(skyMat);
sky.renderOrder = -1;

const fieldScene = new THREE.Scene();
const fieldRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
fieldScene.add(fullScreenMesh(fieldMat));
// flou de profondeur du décor : le pavage (demi-résolution) est réduit au quart avec un filtre doux.
// Bien moins cher qu'une vraie profondeur de champ, et le plateau, au premier plan, reste net.
const blurRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
const blurScene = new THREE.Scene();
const blurMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { tSrc: { value: fieldRT.texture }, uTexel: { value: new THREE.Vector2() } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: blurFrag,
});
blurScene.add(fullScreenMesh(blurMat));
scene.background = blurRT.texture;

export function sizeField() {
  const pr = renderer.getPixelRatio();
  const w = Math.max(1, Math.round(innerWidth * pr * gfx.Q.field)), h = Math.max(1, Math.round(innerHeight * pr * gfx.Q.field));
  fieldRT.setSize(w, h);
  blurRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
  blurMat.uniforms.uTexel.value.set(1 / w, 1 / h);
}
sizeField();

function renderField() {
  const u = fieldMat.uniforms;
  camera.updateMatrixWorld();
  u.uProjInv.value.copy(camera.projectionMatrixInverse);
  u.uCamWorld.value.copy(camera.matrixWorld);
  u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
  renderer.setRenderTarget(fieldRT);
  renderer.render(fieldScene, camera);
  renderer.setRenderTarget(blurRT);
  renderer.render(blurScene, camera);
  renderer.setRenderTarget(null);
}

// le pavage (flou, lent) n'est recalculé qu'une image sur fieldEvery, sauf quand la caméra bouge
let fieldFrame = 0;
const lastView = new THREE.Matrix4(), lastProj = new THREE.Matrix4();
export function updateField(t, dt) {
  camera.updateMatrixWorld();
  if (simple) {   // seul le ciel suit la caméra ; il ne coûte qu'une passe plein écran
    skyMat.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    skyMat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
    return;
  }
  const u = fieldMat.uniforms;
  u.uTime.value = t;
  u.uFade.value = Math.min(1, u.uFade.value + dt * 0.5);
  camera.updateMatrixWorld();
  const moved = !lastView.equals(camera.matrixWorld) || !lastProj.equals(camera.projectionMatrix);
  if (moved) { lastView.copy(camera.matrixWorld); lastProj.copy(camera.projectionMatrix); }
  if (moved || fieldFrame++ % gfx.Q.fieldEvery === 0) renderField();
}
// le pavage apparaît en fondu au chargement
export const fieldFading = () => !simple && fieldMat.uniforms.uFade.value < 1;

export function applyFieldQuality(prev) {
  applyBackdrop();   // le niveau de qualité décide aussi du fond (pavage ou ciel simple)
  if (prev.steps !== gfx.Q.steps || prev.octave2 !== gfx.Q.octave2) {
    fieldMat.defines.FIELD_STEPS = gfx.Q.steps;
    fieldMat.defines.FIELD_OCTAVE2 = gfx.Q.octave2;
    fieldMat.needsUpdate = true;
  }
  sizeField();
  fieldFrame = 0;
}

// Choisit le fond : le pavage, ou le ciel simple du thème quand le thème est épuré ou la qualité basse.
function applyBackdrop() {
  if (!theme) return;
  simple = !!theme.lite || !!gfx.Q.flatSky;
  floor.material = simple ? floorMat : hiddenFloorMat;
  mistAmount.value = simple ? 0 : 0.85;
  scene.background = simple ? null : blurRT.texture;
  if (simple) scene.add(sky);
  else { sky.removeFromParent(); fieldMat.uniforms.uFade.value = 0; }   // le pavage revient en fondu
}

export function applyBackgroundTheme(t) {
  theme = t;
  floorMat.uniforms.base.value.set(theme.floor);
  skyMat.uniforms.top.value.set(theme.skyTop);
  backdropHaze.value.set(theme.field.mid);
  backdropGlow.value.set(theme.field.high);
  applyBackdrop();
  const decor = DECORS[theme.decor] ?? '';
  if (decor !== decorDefine) {
    if (decorDefine) delete fieldMat.defines[decorDefine];
    if (decor) fieldMat.defines[decor] = '';
    decorDefine = decor;
    fieldMat.needsUpdate = true;
  }
  const fu = fieldMat.uniforms;
  fu.uLow.value.set(theme.field.low); fu.uMid.value.set(theme.field.mid);
  fu.uHigh.value.set(theme.field.high); fu.uEdge.value.set(theme.field.edge);
  const fx = theme.fx || {};
  fu.uBeam.value.set(fx.beam || 0).multiplyScalar(fx.beamStrength ?? 1);
  fu.uAlley.value.set(fx.alley || 0).multiplyScalar(fx.alleyStrength ?? 1);
  fu.uCaus.value = fx.caustics || 0;
  fu.uSparkle.value = fx.sparkle || 0;
}
