// Socle du rendu 3D : moteur WebGL, scène, caméra et ses contrôles, lumières, et l'état partagé par les modules
// de render/ (qualité, thème, ombres à recalculer, réveil du rendu à la demande).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { cx, cy } from '../../core/index.js';
import { QUALITY, isQualityPref, levelFor } from './quality.js';
import { load } from '../storage.js';
import './glsl/chunks.js';

// ---------------------------------------------------------------- géométrie du plateau
export const LEVEL = 0.3;                       // hauteur d'un niveau de case
export const topY = h => (h + 1) * LEVEL;       // dessus d'une case de hauteur h
export const cellXZ = i => [cx(i) - 4.5, 4.5 - cy(i)];
export const FLOOR_Y = -3.4;                    // sol du décor, sous le socle
const GOAL_Z = 5.6;                      // bandes d'arrivée, de part et d'autre du plateau
export const exitZ = o => (o === 0 ? -GOAL_Z : GOAL_Z);

// ---------------------------------------------------------------- état partagé
const pref = load('quality');
const qualityPref = isQualityPref(pref) ? pref : 'auto';
const level = levelFor(qualityPref);
export const gfx = {
  qualityPref, level, Q: QUALITY[level],
  theme: /** @type {any} */ (null),             // thème appliqué (theme.js)
  shadowDirty: true,                             // ombres à recalculer à la prochaine image
  wakeUntil: performance.now() + 2000,           // rendu à la demande : images à calculer jusqu'à cet instant
};
// demande des images pendant ms millisecondes (rendu à la demande, voir loop.js)
export function wake(ms = 400) { gfx.wakeUntil = Math.max(gfx.wakeUntil, performance.now() + ms); }

// ---------------------------------------------------------------- moteur et scène
export const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('scene'));
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, gfx.Q.pr));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = gfx.Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;   // recalcul à la demande (voir loop.js)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

export const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

export const HORIZON = new THREE.Color(0x1f2238);
// bande lumineuse ajoutée à la brume près de l'horizon (glsl/chunks.js : hazeColor)
export const HAZE_BAND = new THREE.Vector3(0.20, 0.16, 0.27);
scene.fog = new THREE.Fog(HORIZON, 34, 120);

// ---------------------------------------------------------------- caméra
export const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 300);
camera.position.set(0, 12.5, 12.5);
export const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 7;
controls.maxDistance = 34;
controls.maxPolarAngle = Math.PI * 0.3;   // l'horizon reste hors champ
controls.enablePan = true;
controls.screenSpacePanning = false;   // deux doigts (ou clic droit) : le plateau glisse dans son plan
controls.panSpeed = 0.9;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;

// téléphones (paysage ou portrait) : mêmes seuils que la feuille de style
export const compactMQ = matchMedia('(orientation: landscape) and (max-height: 500px), (orientation: portrait) and (max-width: 500px)');

// recule la caméra sur les écrans étroits pour que tout le plateau reste visible
export function fitCamera() {
  const dist = 16.5 * Math.max(1, 1.35 / camera.aspect);
  controls.maxDistance = dist;   // pas de dézoom au-delà du cadrage par défaut
  const off = camera.position.clone().sub(controls.target);
  camera.position.copy(controls.target).add(off.setLength(Math.min(dist, controls.maxDistance)));
}
fitCamera();

// ---------------------------------------------------------------- lumières
export const hemi = new THREE.HemisphereLight(0xc9d3ff, 0x2a2438, 0.6);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xffeccf, 3.0);
sun.position.set(-7, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(gfx.Q.shadow, gfx.Q.shadow);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);
export const fill = new THREE.DirectionalLight(0x8fb4ff, 0.8);
fill.position.set(8, 6, -8);
scene.add(fill);

// triangle couvrant tout l'écran, pour les passes de rendu plein écran (décor, flou)
export function fullScreenMesh(material) {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new THREE.Mesh(tri, material);
  mesh.frustumCulled = false;
  return mesh;
}
