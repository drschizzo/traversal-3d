// Mouvements de caméra : vue d'un camp, déplacement dans le plan du plateau, cases à garder à l'écran,
// et décalage de la vue pour laisser la place aux panneaux de l'interface
import * as THREE from 'three';
import { camera, controls, compactMQ, topY, cellXZ } from './context.js';
import { tween, easeIO } from './tween.js';
import { heights } from './board.js';

// déplacement de la vue (cible et caméra ensemble) ; le centre de la vue reste au-dessus du plateau
const PAN_MAX = 4;
const clampPan = v => Math.max(-PAN_MAX, Math.min(PAN_MAX, v));
export function panTo(x, z, dur = 0.45) {
  const from = controls.target.clone(), to = new THREE.Vector3(clampPan(x), from.y, clampPan(z));
  const at = from.clone(), step = new THREE.Vector3();
  return tween(dur, k => {
    step.lerpVectors(from, to, easeIO(k)).sub(at);
    at.add(step);
    controls.target.add(step);
    camera.position.add(step);
  });
}

// la caméra est-elle rapprochée du plateau (zoom) ?
export const zoomedIn = () => camera.position.distanceTo(controls.target) < controls.maxDistance * 0.9;

// Fait glisser la vue du minimum nécessaire pour que ces cases soient à l'écran, hors des colonnes du HUD :
// on essaie des fractions croissantes du chemin vers leur centre et on garde la première qui suffit.
const probeCam = new THREE.PerspectiveCamera(), probe = new THREE.Vector3();
export function revealCells(cells) {
  const h = heights();
  const pts = cells.map(i => { const [x, z] = cellXZ(i); return [x, topY(h[i]), z]; });
  const mid = k => (Math.min(...pts.map(q => q[k])) + Math.max(...pts.map(q => q[k]))) / 2;
  const cx = mid(0), cz = mid(2), t = controls.target;
  // zone confortable : à l'écart des bords (et des colonnes du HUD en paysage), le doigt n'y cache rien
  const side = compactMQ.matches && innerWidth > innerHeight ? 190 : 40, my = Math.max(48, innerHeight * 0.14);
  const box = [side, my, innerWidth - side, innerHeight - my];
  const fits = (dx, dz) => {
    probeCam.copy(camera);
    probeCam.position.x += dx; probeCam.position.z += dz;
    probeCam.updateMatrixWorld();
    return pts.every(([x, y, z]) => {
      probe.set(x, y, z).project(probeCam);
      const sx = (probe.x + 1) / 2 * innerWidth, sy = (1 - probe.y) / 2 * innerHeight;
      return sx >= box[0] && sx <= box[2] && sy >= box[1] && sy <= box[3];
    });
  };
  for (let f = 0; f <= 1.001; f += 0.1) {
    const dx = (cx - t.x) * f, dz = (cz - t.z) * f;
    if (fits(dx, dz)) return void (f > 0 && panTo(t.x + dx, t.z + dz));
  }
  panTo(cx, cz);
}

// à chaque image : la vue ne sort pas du plateau, et revient au centre quand on dézoome complètement
const panFix = new THREE.Vector3();
export function keepPanInBounds() {
  const t = controls.target;
  panFix.set(clampPan(t.x) - t.x, 0, clampPan(t.z) - t.z);
  if (camera.position.distanceTo(t) > controls.maxDistance * 0.97) panFix.set(-t.x * 0.12, 0, -t.z * 0.12);
  if (panFix.lengthSq() < 1e-8) return;
  t.add(panFix);
  camera.position.add(panFix);
}

// rotation douce de la caméra vers un camp
export function turnCameraTo(side, dur = 1.1) {
  const off = camera.position.clone().sub(controls.target);
  const sph = new THREE.Spherical().setFromVector3(off);
  const from = sph.theta;
  let to = side === 0 ? 0 : Math.PI;
  let d = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  if (Math.abs(d) < 0.01) return Promise.resolve();
  return tween(dur, k => {
    const s2 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    s2.theta = from + d * easeIO(k);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s2));
  });
}

// La rotation automatique fait tourner le plateau sous le menu ; elle s'arrête pendant la partie.
export const autoRotate = on => { controls.autoRotate = on; };

// ---------------------------------------------------------------- décalage de la vue
// Sur grand écran, la vue 3D glisse latéralement (en pixels) pour rester dégagée des panneaux.
let viewShift = 0, shiftTween = 0;
function applyViewShift(px) {
  viewShift = px;
  if (Math.abs(px) < 0.5) camera.clearViewOffset();
  else camera.setViewOffset(innerWidth, innerHeight, -px, 0, innerWidth, innerHeight);
}
export function shiftView(to, animated = true) {
  const from = viewShift, id = ++shiftTween;
  if (!animated || from === to) return applyViewShift(to);
  tween(0.8, k => { if (id === shiftTween) applyViewShift(from + (to - from) * easeIO(k)); });
}
// demi-largeur à l'écran du socle, vue non décalée
const boardCorner = new THREE.Vector3();
export function boardHalfWidthPx() {
  const cam = camera.clone();
  cam.clearViewOffset();
  let half = 0;
  for (const x of [-5.6, 5.6]) for (const z of [-5.6, 5.6]) for (const y of [0, 3]) {
    boardCorner.set(x, y, z).project(cam);
    half = Math.max(half, Math.abs(boardCorner.x) * innerWidth / 2);
  }
  return half;
}
