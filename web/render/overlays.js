// Ce qui se dessine sur le plateau : cases accessibles, case survolée, anneau de sélection, conseil (case cerclée
// d'or), chemin d'un coup, et suite de coups prévue (tubes numérotés)
import * as THREE from 'three';
import { scene, topY, cellXZ, exitZ } from './context.js';
import { heights } from './board.js';
import { pieceObject } from './pieces.js';
import { TEX, numberTexture } from './textures.js';
import { TEAM, GOLD } from '../colors.js';

const COLORS = { move: 0x6fdcff, attack: 0xff4a4a, exit: GOLD, hover: 0xffffff };
const ownerOf = m => pieceObject(m.pi).o;
const surface = i => topY(heights()[i]);

export const overlayGroup = new THREE.Group();
scene.add(overlayGroup);
/** @returns {THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]} */
const overlayMeshes = () => /** @type {any} */ (overlayGroup.children);
const tileGeo = new THREE.PlaneGeometry(0.92, 0.92);

const hoverTile = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({ map: TEX.tile, color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
hoverTile.rotation.x = -Math.PI / 2;
hoverTile.visible = false;
scene.add(hoverTile);

const selRing = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: TEX.ring, color: GOLD, transparent: true, depthWrite: false }));
selRing.rotation.x = -Math.PI / 2;
selRing.visible = false;
scene.add(selRing);

// conseil du bot : pièce soulevée, chemin tracé et case d'arrivée cerclée de doré, jusqu'au coup joué
let hintMove = null;
const hintMark = new THREE.Group();
const hintTile = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({ map: TEX.tile, color: GOLD, transparent: true, depthWrite: false }));
const hintRing = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: TEX.ring, color: GOLD, transparent: true, depthWrite: false }));
hintTile.rotation.x = hintRing.rotation.x = -Math.PI / 2;
hintRing.position.y = 0.01;
hintMark.add(hintTile, hintRing);
hintMark.visible = false;
scene.add(hintMark);

let pathMesh = null, hoverMove = null;
const pathMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });

// pièces menacées par une pièce adverse en aperçu : anneau rouge au pied et viseur flottant au-dessus
const threatGroup = new THREE.Group();
scene.add(threatGroup);
const threatRingMat = new THREE.MeshBasicMaterial({ map: TEX.ring, color: COLORS.attack, transparent: true, depthWrite: false });
const threatMarkMat = new THREE.SpriteMaterial({ map: TEX.target, color: COLORS.attack, transparent: true, depthTest: false });
const threatRingGeo = new THREE.PlaneGeometry(1.4, 1.4);
function showThreat(cell) {
  const [x, z] = cellXZ(cell), y = surface(cell);
  const ring = new THREE.Mesh(threatRingGeo, threatRingMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, y + 0.03, z);
  const mark = new THREE.Sprite(threatMarkMat);
  mark.scale.setScalar(0.75);
  mark.position.set(x, y + 1.55, z);
  mark.userData.y = mark.position.y;
  mark.renderOrder = 10;
  threatGroup.add(ring, mark);
}

const exitHitGeo = new THREE.PlaneGeometry(1, 2);
// cases accessibles ; preview : coups d'une pièce adverse, dessinés en contour et plus discrets que les coups jouables,
// sauf ses captures : case pleine et pièce menacée signalée par un viseur
export function showOverlays(moves, preview = false) {
  clearOverlays();
  const arrow = matchMedia('(pointer: coarse)').matches ? 0.85 : 0.62;
  for (const m of moves) {
    const isExit = m.kind === 'exit';
    const base = m.kind === 'move' ? 0.8 : 0.9, faint = preview && m.kind !== 'attack';
    if (preview && m.kind === 'attack') showThreat(m.to);
    const mat = new THREE.MeshBasicMaterial({ map: isExit ? TEX.arrow : faint ? TEX.ring : TEX.tile, color: COLORS[m.kind], transparent: true, opacity: faint ? base - 0.25 : base, depthWrite: false });
    const mesh = new THREE.Mesh(isExit ? new THREE.PlaneGeometry(arrow, arrow) : tileGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    const [x, z] = cellXZ(m.to);
    if (isExit) {
      const o = ownerOf(m);
      mesh.rotation.z = o === 0 ? 0 : Math.PI;
      mesh.position.set(x, 0.06, exitZ(o));
      // invisible mais touchée par le rayon : toute la bande au-delà du bord, dans la colonne de la pièce
      const hit = new THREE.Mesh(exitHitGeo, mat);
      hit.visible = false;
      hit.rotation.x = -Math.PI / 2;
      hit.position.set(x, 0.06, o === 0 ? -6 : 6);
      hit.userData = { move: m, baseOpacity: mat.opacity };
      overlayGroup.add(hit);
    } else mesh.position.set(x, surface(m.to) + 0.015, z);
    mesh.userData.move = m;
    mesh.userData.baseOpacity = mat.opacity;
    overlayGroup.add(mesh);
  }
}
export function clearOverlays() { overlayGroup.clear(); threatGroup.clear(); }

// survol : case éclairée et coup mis en avant parmi les cases accessibles
export function showHover(cell, move) {
  hoverMove = move;
  if (cell >= 0) {
    const [x, z] = cellXZ(cell);
    hoverTile.position.set(x, surface(cell) + 0.02, z);
    hoverTile.visible = true;
  } else hoverTile.visible = false;
  overlayMeshes().forEach(o => { o.material.opacity = o.userData.move === move ? 1 : o.userData.baseOpacity; });
}

// anneau sous la pièce sélectionnée ; preview : pièce adverse en aperçu, anneau à sa couleur
export function setSelectionRing(pi, preview = false) {
  if (pi < 0) return void (selRing.visible = false);
  selRing.material.color.setHex(preview ? TEAM[pieceObject(pi).o].main : GOLD);
}

function pathPoints(m) {
  const pts = m.path.map(i => { const [x, z] = cellXZ(i); return new THREE.Vector3(x, surface(i) + 0.12, z); });
  if (m.kind === 'exit') {
    const last = pts[pts.length - 1], o = ownerOf(m);
    pts.push(new THREE.Vector3(last.x, 0.15, o === 0 ? -5.5 : 5.5));
  }
  if (m.special) {
    const a = pts[0], b = pts[1];
    pts.splice(1, 0, a.clone().lerp(b, 0.5).setY(Math.max(a.y, b.y) + 0.6));
  }
  // marches : on insère des points intermédiaires au niveau le plus haut pour suivre le relief
  const out = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    const a = out[out.length - 1], b = pts[k];
    if (!m.special && Math.abs(a.y - b.y) > 0.01) {
      const mid = a.clone().lerp(b, 0.5); mid.y = Math.max(a.y, b.y) + 0.04;
      out.push(mid);
    }
    out.push(b);
  }
  return out;
}

// chemin d'un coup (null : aucun) ; le coup conseillé est tracé plus épais, en or
export function showPath(m) {
  if (pathMesh) { scene.remove(pathMesh); pathMesh.geometry.dispose(); pathMesh = null; }
  if (!m) return;
  const pts = pathPoints(m);
  if (pts.length < 2) return;
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3), isHint = m === hintMove;
  pathMat.color.setHex(isHint ? GOLD : COLORS[m.kind]);
  pathMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 12, isHint ? 0.06 : 0.035, 8, false), pathMat);
  scene.add(pathMesh);
}

// coup conseillé (null : aucun) : case d'arrivée cerclée d'or et chemin tracé
export function showHint(m) {
  hintMove = m;
  hintMark.visible = !!m;
  if (m) {
    const [x, z] = cellXZ(m.to);
    if (m.kind === 'exit') hintMark.position.set(x, 0.08, exitZ(ownerOf(m)));
    else hintMark.position.set(x, surface(m.to) + 0.035, z);
  }
  showPath(m);
}
export const hintShown = () => hintMark.visible;

// ---------------------------------------------------------------- suite prévue
// un tube par coup, de plus en plus transparent ; items : [{ move, side, color? }]
const planGroup = new THREE.Group();
scene.add(planGroup);
export function clearPlan() {
  // les sprites partagent une géométrie commune à Three.js : on ne libère que leur matériau
  for (const o of /** @type {any[]} */ (planGroup.children)) { if (!o.isSprite) o.geometry.dispose(); o.material.dispose(); }
  planGroup.clear();
}
export function showPlan(items) {
  clearPlan();
  items.forEach(({ move: m, side, color }, i) => {
    const pts = pathPoints(m);
    if (pts.length < 2) return;
    pts.forEach(p => { p.y += 0.04 * (i + 1); });
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3);
    const mat = new THREE.MeshBasicMaterial({ color: color ?? TEAM[side].main, transparent: true, opacity: color ? 0.95 : Math.max(0.3, 0.95 - i * 0.18), depthWrite: false });
    planGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 12, 0.05, 8, false), mat));
    const [x, z] = m.kind === 'exit' ? [pts[pts.length - 1].x, pts[pts.length - 1].z] : cellXZ(m.to);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 24), new THREE.MeshBasicMaterial({ color: color ?? TEAM[side].main, transparent: true, opacity: mat.opacity, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, (m.kind === 'exit' ? 0.1 : surface(m.to)) + 0.03, z);
    planGroup.add(ring);
    // suite de plusieurs coups : un numéro flotte au-dessus de chaque arrivée, à la place de coordonnées
    if (items.length > 1 && !color) {
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(i + 1), transparent: true, depthTest: false, opacity: Math.max(0.6, mat.opacity) }));
      badge.scale.setScalar(0.36);
      badge.position.set(x, ring.position.y + 0.45, z);
      badge.renderOrder = 10;
      planGroup.add(badge);
    }
  });
}

// à chaque image : anneau sous la pièce soulevée, conseil qui pulse, cibles d'attaque qui pulsent
export function updateOverlays(t, lifted) {
  if (lifted) {
    const g = lifted.grp;
    selRing.position.set(g.position.x, topY(lifted.h) + 0.025, g.position.z);
    selRing.scale.setScalar(1 + Math.sin(t * 4) * 0.05);
    selRing.visible = true;
  } else if (selRing.visible) selRing.visible = false;
  if (hintMark.visible) {
    const k = Math.sin(t * 3.5);
    hintRing.scale.setScalar(1 + 0.12 * k);
    hintRing.material.opacity = 0.75 + 0.25 * k;
    hintTile.material.opacity = 0.6 + 0.25 * k;
  }
  if (threatGroup.children.length) {
    threatRingMat.opacity = 0.7 + 0.3 * Math.sin(t * 5);
    for (const o of threatGroup.children) if (o instanceof THREE.Sprite) o.position.y = o.userData.y + 0.08 * Math.sin(t * 3);
  }
  for (const o of overlayMeshes())
    if (o.userData.move.kind !== 'move' && o.userData.move !== hoverMove) o.material.opacity = o.userData.baseOpacity - 0.15 + 0.15 * Math.sin(t * 5);
}
