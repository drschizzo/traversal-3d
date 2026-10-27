// Les pièces : la forme dit les règles. Boules d'or aux sommets du haut = Force (attaque),
// boules d'argent aux sommets de la base = Mouvement (5, 4 ou 3 points).
import * as THREE from 'three';
import { ON_BOARD, idx } from '../../core/index.js';
import { scene, gfx, topY, cellXZ } from './context.js';
import { tween } from './tween.js';
import { radialTexture } from './textures.js';
import { TEAM } from '../colors.js';

function vanguardGeometry() {
  const r = 0.4, H = 0.5, t = 0.27, b = 0.06;
  const B = [[r, b, 0], [0, b, r], [-r, b, 0], [0, b, -r]], T = [[0, b + H, t], [0, b + H, -t]];
  const faces = [[B[0], B[1], T[0]], [B[1], B[2], T[0]], [B[2], B[3], T[1]], [B[3], B[0], T[1]], [B[0], T[0], T[1]], [B[2], T[1], T[0]], [B[0], B[2], B[1]], [B[0], B[3], B[2]]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(faces.flat(2), 3));
  g.computeVertexNormals();
  return { geo: g, tips: T, feet: B };
}
// sommets d'un polygone régulier de n côtés (même orientation que les géométries de Three.js)
const ring = (n, r, y) => Array.from({ length: n }, (_, k) => [r * Math.sin((k * 2 * Math.PI) / n), y, r * Math.cos((k * 2 * Math.PI) / n)]);
const PIECE_GEO = [
  (() => { const g = new THREE.ConeGeometry(0.27, 0.95, 5); g.translate(0, 0.535, 0); return { geo: g, tips: [[0, 1.01, 0]], feet: ring(5, 0.27, 0.06) }; })(),
  vanguardGeometry(),
  (() => {
    const g = new THREE.CylinderGeometry(0.31, 0.36, 0.6, 3); g.translate(0, 0.36, 0);
    return { geo: g, tips: ring(3, 0.27, 0.68), feet: ring(3, 0.36, 0.06) };
  })(),
];
const baseGeo = new THREE.CylinderGeometry(0.37, 0.4, 0.06, 40); baseGeo.translate(0, 0.03, 0);
// repères : [sommets du haut, coins de la base] ; ceux de la base sont plus petits et à moitié enfoncés dans le socle
const PIP_GEO = {
  sphere: [new THREE.SphereGeometry(0.05, 16, 12), new THREE.SphereGeometry(0.034, 12, 8)],
  octa: [new THREE.OctahedronGeometry(0.065), new THREE.OctahedronGeometry(0.044)],
  peg: [new THREE.CylinderGeometry(0.038, 0.044, 0.07, 14), new THREE.CylinderGeometry(0.028, 0.032, 0.04, 12)],
};
export const PIP_DEFAULT = { shape: 'sphere', top: { color: '#ffd27a', metalness: 1, roughness: 0.25, emissive: '#3a2600' }, base: { color: '#e4ebf2', metalness: 0.9, roughness: 0.3 } };
// Les repères sont minuscules : s'ils dépassaient le seuil du halo lumineux (bloom), ses niveaux en basse
// résolution les étaleraient en petits carrés. Leur luminosité est donc plafonnée sous ce seuil (pipCap, réglé
// par thème), et la lueur des thèmes lumineux est dessinée à part, par un halo rond et doux.
const pipCap = { value: 0.8 };
// Un matériau par repère, gardé d'un thème à l'autre : le jeter libérerait son shader compilé, et le thème
// suivant le recompilerait en figeant l'image (warmup.js).
const pipMaterial = () => {
  const m = new THREE.MeshStandardMaterial();
  m.onBeforeCompile = sh => {
    sh.uniforms.uPipCap = pipCap;
    sh.fragmentShader = 'uniform float uPipCap;\n' + sh.fragmentShader.replace('#include <dithering_fragment>',
      '#include <dithering_fragment>\n\tgl_FragColor.rgb = min(gl_FragColor.rgb, vec3(uPipCap));');
  };
  m.customProgramCacheKey = () => 'pip-cap';
  return m;
};
const stylePip = (m, spec) => {
  m.color.set(spec.color);
  m.metalness = spec.metalness ?? 0;
  m.roughness = spec.roughness ?? 0.5;
  m.emissive.set(spec.emissive ?? '#000000');
  m.emissiveIntensity = spec.glow ?? 1;
};
const haloTex = radialTexture(64);

/** @type {{ grp: THREE.Group, body: THREE.Mesh, base: THREE.Mesh, pips: any[], o: number, cell: number, h: number }[]} */
let pieceObjs = [];
export const pieceObject = pi => pieceObjs[pi];
export const piecesGroup = new THREE.Group();
scene.add(piecesGroup);

// couleurs des pièces : celles du thème s'il en définit, sinon les couleurs d'équipe
const pieceColors = o => (gfx.theme.pieces?.teams || TEAM)[o];
// finition des pièces : laque brillante par défaut, bois peint pour le thème Atelier
function finishPiece(m) {
  const f = gfx.theme.pieces || {};
  m.roughness = f.roughness ?? 0.3;
  // jamais tout à fait nul : sans vernis, le shader des pièces serait une autre variante, à compiler au changement
  // de thème en figeant l'image (warmup.js) ; un millième de vernis ne se voit pas
  m.clearcoat = Math.max(f.clearcoat ?? 1, 0.001);
  m.clearcoatRoughness = f.clearcoatRoughness ?? 0.12;
}

// applique le style du thème aux repères et aux couleurs d'une pièce
function stylePiece(obj) {
  const st = gfx.theme.pips || PIP_DEFAULT, shape = PIP_GEO[st.shape] ? st.shape : 'sphere';
  for (const pip of obj.pips) {
    const spec = pip.role === 0 ? st.top : st.base;
    pip.mesh.geometry = PIP_GEO[shape][pip.role];
    stylePip(pip.mesh.material, spec);
    pip.mesh.rotation.y = shape === 'octa' ? Math.PI / 4 : 0;
    // halo doux pour les repères lumineux ; le repère lui-même en masque le centre (test de profondeur)
    if (spec.glow && !pip.halo) {
      pip.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      pip.halo.position.copy(pip.mesh.position);
      pip.halo.raycast = () => {}; // le halo ne compte pas pour le survol des pièces
      obj.grp.add(pip.halo);
    }
    if (pip.halo) {
      pip.halo.visible = !!spec.glow;
      pip.halo.material.color.set(spec.emissive ?? '#000000');
      pip.halo.material.opacity = Math.min(0.8, 0.45 + (spec.glow ?? 0) * 0.4);
      pip.halo.scale.setScalar(pip.role === 0 ? 0.26 : 0.17);
      pip.halo.userData.baseOpacity = pip.halo.material.opacity;
    }
  }
  const c = pieceColors(obj.o);
  obj.body.material.color.set(c.main);
  obj.base.material.color.set(c.dark);
  finishPiece(obj.body.material);
}

// thème : repères, couleurs et finition ; bloomThreshold : seuil du halo, sous lequel restent les repères
export function applyPiecesTheme(bloomThreshold) {
  pipCap.value = 0.85 * bloomThreshold;
  pieceObjs.forEach(stylePiece);
}

export function buildPieces(s) {
  piecesGroup.clear();
  pieceObjs = s.pieces.map((p, pi) => {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(PIECE_GEO[p.t].geo, new THREE.MeshPhysicalMaterial({
      color: TEAM[p.o].main, metalness: 0.05, flatShading: true, side: THREE.DoubleSide,
    }));
    const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: TEAM[p.o].dark, roughness: 0.4, metalness: 0.3 }));
    body.castShadow = base.castShadow = true;
    body.receiveShadow = true;
    grp.add(base, body);
    /** @type {any[]} */
    const pips = [];
    for (const tip of PIECE_GEO[p.t].tips) pips.push({ role: 0, at: tip });
    for (const [x, y, z] of PIECE_GEO[p.t].feet) pips.push({ role: 1, at: [x, y + 0.008, z] });
    for (const pip of pips) {
      pip.mesh = new THREE.Mesh(PIP_GEO.sphere[pip.role], pipMaterial());
      pip.mesh.position.set(...pip.at);
      grp.add(pip.mesh);
    }
    grp.rotation.y = p.o === 1 ? Math.PI : 0;
    grp.traverse(o => { o.userData.pi = pi; });
    piecesGroup.add(grp);
    const obj = { grp, body, base, pips, o: p.o, cell: -1, h: 0 };
    stylePiece(obj);
    return obj;
  });
  syncPieces(s);
}

export function setPieceOpacity(obj, a) {
  obj.grp.traverse(o => {
    if (!o.material) return;
    const halo = o.userData.baseOpacity !== undefined; // halos : toujours transparents, opacité propre
    o.material.transparent = a < 1 || halo;
    o.material.opacity = a * (halo ? o.userData.baseOpacity : 1);
    o.material.depthWrite = a >= 1 && !halo;
  });
}

// pièces placées comme dans la position s (après une animation, un coup repris, une navigation…)
export function syncPieces(s) {
  gfx.shadowDirty = true;
  s.pieces.forEach((p, pi) => {
    const o = pieceObjs[pi];
    o.grp.visible = p.st === ON_BOARD;
    o.grp.scale.setScalar(1);
    o.grp.rotation.set(0, p.o === 1 ? Math.PI : 0, 0);
    setPieceOpacity(o, 1);
    o.cell = p.st === ON_BOARD ? idx(p.x, p.y) : -1;
    if (o.cell >= 0) {
      const [x, z] = cellXZ(o.cell);
      o.h = s.h[o.cell];
      o.grp.position.set(x, topY(o.h), z);
    }
  });
}

// les pièces tombent du ciel sur le plateau qui vient d'apparaître
export function dropPieces(delay0 = 0.75) {
  pieceObjs.forEach((obj, pi) => {
    const g = obj.grp, target = g.position.y;
    const d = delay0 + (pi % 6) * 0.07 + obj.o * 0.2, dur = d + 0.6;
    g.position.y = target + 7;
    tween(dur, k => {
      const e = Math.min(1, Math.max(0, (k * dur - d) / 0.6));
      g.position.y = target + 7 * (1 - e * e * (3 - 2 * e));
    }).then(() => { g.position.y = target; });
  });
}

// pièce survolée, légèrement éclairée (sauf la pièce sélectionnée)
export function highlightPiece(pi, selected) {
  pieceObjs.forEach((o, k) => /** @type {THREE.MeshPhysicalMaterial} */ (o.body.material).emissive.setHex(k === pi && k !== selected ? 0x2a2a2a : 0x000000));
}

// pièce sélectionnée : elle flotte au-dessus de sa case (loop.js), et retrouve sa place quand on la relâche
let lifted = -1;
export const liftedPiece = () => lifted;
export function liftPiece(pi) {
  if (lifted >= 0 && lifted !== pi) {
    const o = pieceObjs[lifted];
    if (o?.cell >= 0) o.grp.position.y = topY(o.h);
  }
  // une pièce qu'on vient de prendre gonfle un instant
  if (pi >= 0 && pi !== lifted) {
    const g = pieceObjs[pi].grp;
    tween(0.22, k => g.scale.setScalar(1 + 0.14 * Math.sin(Math.PI * k))).then(() => g.scale.setScalar(1));
  }
  lifted = pi;
  gfx.shadowDirty = true;
}
export function updateLifted(t) {
  if (lifted < 0) return null;
  const o = pieceObjs[lifted];
  o.grp.position.y = topY(o.h) + 0.1 + Math.sin(t * 4) * 0.05;
  return o;
}
