// L'espace des plateaux possibles. Le plateau joué se dresse sur un socle au milieu d'un pavage infini d'autres
// plateaux possibles, tous produits par le même générateur. Ce pavage est rendu en raymarching volumétrique
// (glsl/field.frag.glsl) : une brume dont la densité épouse le relief en colonnes de chaque plateau, et qui se perd
// dans le brouillard d'horizon. Il est rendu à part, en basse résolution et flouté, puis sert de fond à la scène.
//
// Trois familles de décor, selon ce que le thème dit du jeu.
//
// « Un monde parmi les mondes possibles » (DECORS, le pavage ci-dessus) : le plateau est un paysage, et le même
// générateur fabrique tous les autres. Vallées de brume, récif noyé, coulées de lave, banquise, ville en
// contrebas, jardin sec — le relief ne change pas, la matière qui l'habille, oui.
//
// « Un objet posé quelque part » (theme.room) : le plateau est une chose fabriquée, posée sur une table, dans
// une pièce qui tombe dans le noir. Un jeu en bois n'a rien à faire au milieu d'une plaine infinie d'autres jeux
// en bois : il est sur l'établi. La table est un matériau éclairé, de la même fabrique que le plateau
// (surfaces.js) ; pas de raymarching du tout, donc ces décors tiennent même en qualité basse.
//
// « Rien que le jeu » (sky.frag.glsl) : le ciel et le sol du thème, et c'est tout. C'est aussi ce que devient le
// pavage en qualité basse, où il ne serait qu'une bouillie pour un coût qu'on ne peut pas payer là.
//
// Par-dessus les trois, les deux camps à l'horizon (trv_camps) : une lueur sourde derrière chaque ligne
// d'arrivée, qui dit d'où l'on vient et où il faut aller.
import * as THREE from 'three';
import { TERRAINS, generateTerrain, randomSeed, cx, cy } from '../../core/index.js';
import { renderer, scene, camera, gfx, HORIZON, HAZE_BAND, FLOOR_Y, fullScreenMesh } from './context.js';
import { TEAM } from '../colors.js';
import { noiseUniform } from './noise.js';
import { withSurface, surfaceId } from './surfaces.js';
import floorFrag from './glsl/floor.frag.glsl?raw';
import fieldVert from './glsl/field.vert.glsl?raw';
import fieldFrag from './glsl/field.frag.glsl?raw';
import skyFrag from './glsl/sky.frag.glsl?raw';
import blurFrag from './glsl/blur.frag.glsl?raw';

const TILE_PITCH = 12;                  // un plateau 10×10 + une allée de brume
const ATLAS_N = 8;                      // atlas de 8×8 = 64 plateaux distincts
const FIELD_TOP = FLOOR_Y + 3.3;

// décors du pavage (theme.decor) : chacun compile sa variante du shader (#ifdef DECOR_* dans field.frag.glsl) ;
// « valleys » est le décor par défaut, celui du #else, donc sans define
const DECORS = {
  valleys: '', reef: 'DECOR_REEF', lava: 'DECOR_LAVA', floes: 'DECOR_FLOES', grid: 'DECOR_GRID', garden: 'DECOR_GARDEN',
};
let decorDefine = '';
let theme = null;       // thème appliqué
let backdrop = 'field'; // 'field' (pavage) · 'room' (une table dans une pièce) · 'sky' (le ciel du thème seul)
// brume du pavage au pied du socle (board.js) : il n'y en a pas quand il n'y a pas de pavage
export const mistAmount = { value: 0.85 };

// sol sombre sous la brume, qui se fond dans l'horizon
// couleurs du décor qui portent un fond sans pavage : le gros de la brume et le halo de ses sommets
const backdropHaze = { value: new THREE.Color() }, backdropGlow = { value: new THREE.Color() };
// les deux camps à l'horizon : le Rouge au fond (−Z), le Bleu devant (+Z), comme les bandes d'arrivée
const campRed = { value: new THREE.Color() }, campBlue = { value: new THREE.Color() }, campAmount = { value: 0 };
const campUniforms = { uRed: campRed, uBlue: campBlue, uCamps: campAmount };
const floorVert = 'varying vec3 vWp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
const floorMat = new THREE.ShaderMaterial({
  uniforms: {
    base: { value: new THREE.Color(0x0a0c16) }, fogc: { value: HORIZON }, band: { value: HAZE_BAND },
    haze: backdropHaze, glow: backdropGlow, ...campUniforms,
  },
  vertexShader: floorVert,
  fragmentShader: floorFrag,
});

// La table des thèmes-objet : le même plan que le sol, mais un matériau éclairé comme le plateau et le socle,
// avec la même fabrique de surfaces procédurales (surfaces.js). C'est la lumière qui la rend vivante : le fil du
// bois accroche le soleil rasant, le marbre poli renvoie le ciel, et la table reçoit l'ombre du jeu.
const roomSurface = {
  uSurface: { value: 0 }, uGlowAmt: { value: 1 }, uMistAmt: { value: 1 },
  uMistCol: { value: new THREE.Color() }, uAccent: { value: new THREE.Color() }, uFar: { value: 15 },
};
const roomMat = withSurface(new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 }), roomSurface);
// Sous le pavage, le sol n'écrit que la profondeur (la brume le recouvre) ; avec un fond simple, il devient
// visible et donne au plateau une surface où poser.
const hiddenFloorMat = new THREE.MeshBasicMaterial({ colorWrite: false });
// l'ombre du jeu, portée sur un sol qui ne la recevrait pas lui-même (pavage, ciel simple)
const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.4 }));
/** @type {THREE.Mesh<THREE.PlaneGeometry, THREE.Material>} */
const floor = new THREE.Mesh(new THREE.PlaneGeometry(440, 440), hiddenFloorMat);
{
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  scene.add(floor);
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
    uCaus: { value: 0 }, uSparkle: { value: 0 }, uNoise3D: noiseUniform, ...campUniforms,
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
    haze: backdropHaze, glow: backdropGlow, ...campUniforms,
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
  if (backdrop !== 'field') {   // seul le ciel suit la caméra ; il ne coûte qu'une passe plein écran
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
export const fieldFading = () => backdrop === 'field' && fieldMat.uniforms.uFade.value < 1;

// ---------------------------------------------------------------- compilation anticipée (warmup.js)
// le pavage tel qu'il sera dessiné à la prochaine image, s'il l'est
export const fieldPass = () => (backdrop === 'field' ? { scene: fieldScene, target: fieldRT } : null);

// Ce que les autres thèmes dessineraient : leurs fonds, qui ne sont pas dans la scène en ce moment (des
// doublures portant les mêmes matériaux), et le pavage avec chacun de ses autres décors (des copies du matériau,
// gardées : les jeter libérerait les programmes compilés). Le ciel et le sol d'un fond simple ne se dessinent
// qu'à l'écran (thème épuré, qualité basse) ; la table, sur les deux chemins de sortie.
export function backdropVariants() {
  const proxies = mats => {
    const s = new THREE.Scene(), geo = new THREE.PlaneGeometry(1, 1);
    for (const m of mats) s.add(Object.assign(new THREE.Mesh(geo, m), { frustumCulled: false }));
    return s;
  };
  let decors = null;
  if (!gfx.Q.flatSky) {
    decors = new THREE.Scene();
    for (const define of Object.values(DECORS)) {
      if (define === decorDefine) continue;
      const m = fieldMat.clone();
      if (decorDefine) delete m.defines[decorDefine];
      if (define) m.defines[define] = '';
      decors.add(fullScreenMesh(m));
    }
  }
  return { screen: proxies([skyMat, floorMat, roomMat]), room: proxies([roomMat]), decors, fieldTarget: fieldRT };
}

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

// Choisit la famille de décor : la table du thème s'il en a une, sinon le pavage — ou son ciel seul quand le
// thème est épuré ou la qualité basse (les tables, elles, ne coûtent presque rien et restent partout).
function applyBackdrop() {
  if (!theme) return;
  backdrop = theme.room ? 'room' : (theme.lite || gfx.Q.flatSky) ? 'sky' : 'field';
  const field = backdrop === 'field';
  floor.material = field ? hiddenFloorMat : backdrop === 'room' ? roomMat : floorMat;
  shadowCatcher.visible = backdrop !== 'room';   // la table reçoit elle-même l'ombre du jeu
  mistAmount.value = field ? 0.85 : 0;
  scene.background = field ? blurRT.texture : null;
  if (field) { sky.removeFromParent(); fieldMat.uniforms.uFade.value = 0; }   // le pavage revient en fondu
  else scene.add(sky);
}

export function applyBackgroundTheme(t) {
  theme = t;
  floorMat.uniforms.base.value.set(theme.floor);
  skyMat.uniforms.top.value.set(theme.skyTop);
  backdropHaze.value.set(theme.room?.far || theme.field.mid);
  backdropGlow.value.set(theme.room?.glow || theme.field.high);
  // les camps prennent les couleurs des pièces du thème, assombries : une présence, pas une enseigne
  const teams = theme.pieces?.teams || TEAM;
  campRed.value.set(teams[0].main);
  campBlue.value.set(teams[1].main);
  campAmount.value = theme.camps ?? 0.5;
  if (theme.room) {
    roomMat.color.set(theme.room.base);
    roomMat.roughness = theme.room.roughness ?? 0.8;
    roomMat.metalness = theme.room.metalness ?? 0;
    roomMat.envMapIntensity = theme.room.env ?? 0.2;
    roomSurface.uSurface.value = surfaceId(theme.room.kind);
    roomSurface.uAccent.value.set(theme.room.pool);
    // La table s'éteint vers le noir de la pièce. Ce fondu est appliqué après l'étalonnage, donc la couleur est
    // prise telle quelle, sans conversion linéaire (comme les teintes de postfx.js).
    roomSurface.uMistCol.value.setHex(parseInt(theme.room.far.slice(1), 16), THREE.LinearSRGBColorSpace);
  }
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
