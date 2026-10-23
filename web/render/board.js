// Le plateau joué : colonnes de cases empilées (une instance par niveau), socle, bandes d'arrivée, hauteurs affichées,
// et la matérialisation du monde (les cases montent de la brume, du centre vers les bords)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../../core/index.js';
import { scene, gfx, LEVEL, topY, cellXZ, FLOOR_Y } from './context.js';
import { withSurface, surfaceId } from './surfaces.js';
import { mistColor, mistAmount } from './background.js';
import { numberTexture } from './textures.js';
import { TEAM } from '../colors.js';

const terrainSurface = { uSurface: { value: 0 } };
const plinthSurface = { uSurface: { value: 0 }, uGlowAmt: { value: 0 }, uMistAmt: mistAmount, uMistCol: { value: mistColor } };
export const terrainMat = withSurface(new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, envMapIntensity: 0.2 }), terrainSurface);

// socle : le plateau joué s'élève au-dessus de la brume des autres mondes
export const plinth = new THREE.Mesh(new RoundedBoxGeometry(11.2, -FLOOR_Y, 11.2, 4, 0.2), withSurface(new THREE.MeshStandardMaterial({ color: 0x23242f, roughness: 0.45, metalness: 0.35 }), plinthSurface));
plinth.position.y = FLOOR_Y / 2;
plinth.receiveShadow = plinth.castShadow = true;
scene.add(plinth);

for (let o = 0; o < 2; o++) {
  // bande d'arrivée : celle du Rouge est au fond (rangée 10), celle du Bleu devant
  const strip = new THREE.Mesh(new THREE.BoxGeometry(10, 0.05, 0.18),
    new THREE.MeshStandardMaterial({ color: TEAM[o].main, emissive: TEAM[o].main, emissiveIntensity: 0.7, roughness: 0.4 }));
  strip.position.set(0, 0.02, o === 0 ? -5.32 : 5.32);
  scene.add(strip);
}

const terrainGroup = new THREE.Group();
scene.add(terrainGroup);
let terrainMesh = null, instToCell = [], heightLabels = null, heightsShown = false;
let board = null; // { h, mode } du monde affiché

/** Hauteurs du monde affiché. */
export const heights = () => board?.h;
export const terrainObject = () => terrainMesh;
export const cellOfInstance = id => instToCell[id];

const paletteFor = mode => gfx.theme.modes?.[mode] || gfx.theme.terrain;

// couleurs des couches du terrain selon le thème (même ordre d'instances que buildTerrain)
function colorTerrain() {
  if (!terrainMesh || !board) return;
  const { h, mode } = board, pal = paletteFor(mode);
  const c = new THREE.Color(), rng = mulberry32(h.reduce((a, b) => a * 31 + b, 7) >>> 0);
  let n = 0;
  for (let i = 0; i < 100; i++)
    for (let k = 0; k <= h[i]; k++) {
      if (k === h[i]) c.set(pal.top[Math.min(h[i], pal.top.length - 1)]).offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.04);
      else c.set(pal.strata[Math.min(k, pal.strata.length - 1)]).offsetHSL(0, 0, (k % 2) * 0.035 - (rng() * 0.02));
      terrainMesh.setColorAt(n++, c);
    }
  terrainMesh.instanceColor.needsUpdate = true;
}

export function buildTerrain(h, mode) {
  terrainGroup.clear();
  if (terrainMesh) terrainMesh.geometry.dispose();
  board = { h, mode };
  let count = 0;
  for (const v of h) count += v + 1;
  const geo = new RoundedBoxGeometry(0.97, LEVEL, 0.97, 2, 0.04);
  terrainMesh = new THREE.InstancedMesh(geo, terrainMat, count);
  instToCell = [];
  const m = new THREE.Matrix4(), rest = new Float32Array(count * 3);
  let n = 0;
  for (let i = 0; i < 100; i++) {
    const [x, z] = cellXZ(i);
    for (let k = 0; k <= h[i]; k++) {
      m.makeTranslation(x, (k + 0.5) * LEVEL, z);
      terrainMesh.setMatrixAt(n, m);
      rest.set([x, (k + 0.5) * LEVEL, z], n * 3);
      instToCell[n++] = i;
    }
  }
  geo.setAttribute('aRest', new THREE.InstancedBufferAttribute(rest, 3));
  colorTerrain();
  terrainMesh.castShadow = terrainMesh.receiveShadow = true;
  terrainGroup.add(terrainMesh);

  heightLabels = new THREE.Group();
  heightLabels.visible = heightsShown;
  for (let i = 0; i < 100; i++) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: numberTexture(h[i]), transparent: true, depthWrite: false }));
    const [x, z] = cellXZ(i);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x - 0.31, topY(h[i]) + 0.012, z + 0.31);
    heightLabels.add(mesh);
  }
  terrainGroup.add(heightLabels);
}

export function showHeights(on) {
  heightsShown = on;
  if (heightLabels) heightLabels.visible = on;
}

export function applyBoardTheme(theme) {
  plinth.material.color.set(theme.plinth);
  plinthSurface.uSurface.value = surfaceId(theme.plinthSurface);
  terrainSurface.uSurface.value = surfaceId(theme.surface);
  terrainMat.roughness = theme.roughness ?? 0.8;
  terrainMat.envMapIntensity = theme.envIntensity ?? 0.2;
  colorTerrain();
}

// ---------------------------------------------------------------- matérialisation du plateau
let riseAnim = null;
export const rising = () => !!riseAnim;
export function riseTerrain(h) {
  const items = [];
  let n = 0;
  for (let i = 0; i < 100; i++) {
    const [x, z] = cellXZ(i);
    const d = Math.hypot(x, z) * 0.075 + Math.random() * 0.08;
    for (let k = 0; k <= h[i]; k++) items.push({ n: n++, x, z, k, d: d + k * 0.035 });
  }
  riseAnim = { t: 0, items, end: Math.max(...items.map(it => it.d)) + 0.6 };
  stepRise(0);
}
const _rm = new THREE.Matrix4(), _rs = new THREE.Vector3(), _rp = new THREE.Vector3(), _rq = new THREE.Quaternion();
export function stepRise(dt) {
  if (!riseAnim) return;
  riseAnim.t += dt;
  for (const it of riseAnim.items) {
    const e = Math.min(1, Math.max(0, (riseAnim.t - it.d) / 0.55));
    const b = 1 - Math.pow(1 - e, 3);
    _rm.compose(_rp.set(it.x, ((it.k + 0.5) * LEVEL) * b - (1 - b) * 0.2, it.z), _rq, _rs.set(1, Math.max(b, 0.001), 1));
    terrainMesh.setMatrixAt(it.n, _rm);
  }
  terrainMesh.instanceMatrix.needsUpdate = true;
  if (riseAnim.t >= riseAnim.end) { riseAnim = null; terrainMesh.boundingSphere = null; }
}
