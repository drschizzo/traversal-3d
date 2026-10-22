// Ce qui se trouve sous le pointeur : une case accessible (son coup), une pièce, ou une case du plateau
import * as THREE from 'three';
import { camera } from './context.js';
import { overlayGroup } from './overlays.js';
import { piecesGroup, pieceObject } from './pieces.js';
import { terrainObject, cellOfInstance } from './board.js';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/** @returns {{ move: any, pi: number, cell: number }} move : coup d'une case accessible ; pi : pièce ; cell : case */
export function pick(ev) {
  pointer.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const res = { move: null, pi: -1, cell: -1 };
  const terrain = terrainObject();
  const ov = raycaster.intersectObjects(overlayGroup.children, false)[0];
  const pc = raycaster.intersectObjects(piecesGroup.children, true).find(h => h.object.parent.visible);
  const tr = terrain ? raycaster.intersectObject(terrain, false)[0] : null;
  const dOv = ov ? ov.distance : Infinity, dPc = pc ? pc.distance : Infinity, dTr = tr ? tr.distance : Infinity;
  if (pc && dPc <= dOv + 0.3 && dPc <= dTr + 0.01) {
    res.pi = pc.object.userData.pi;
    res.cell = pieceObject(res.pi).cell;
  } else if (ov && dOv <= dTr + 0.05) {
    res.move = ov.object.userData.move;
    res.cell = res.move.to;
  } else if (tr) res.cell = cellOfInstance(tr.instanceId);
  return res;
}
