// Signaux passagers après un coup (core/events.js) : ce que le coup vient de changer, montré une seconde puis effacé.
//   renfort       arc clair de la pièce jouée vers l'allié, onde à son pied, « +1 » ; vert s'il le met hors de prise
//   menace        arc rouge de l'attaquant vers sa cible, viseur au-dessus d'elle, la cible frémit
//   en prise      onde rouge discrète au pied de la pièce laissée attaquable
//   à l'abri      onde verte au pied de la pièce sauvée
//   prête à sortir  ondes dorées (trois si sa sortie déciderait la partie), battement de cœur
import * as THREE from 'three';
import { scene, topY } from './context.js';
import { tween } from './tween.js';
import { pieceObject } from './pieces.js';
import { floatText, calm } from './fx.js';
import { TEX } from './textures.js';
import * as Sound from '../audio/sound.js';
import { GOLD, BEST } from '../colors.js';

const SUPPORT = 0xbfe6ff, DANGER = 0xff4a4a;

const cueGroup = new THREE.Group();
scene.add(cueGroup);
const ringGeo = new THREE.PlaneGeometry(1.2, 1.2);

// les signaux à venir d'un coup repris ou d'une partie quittée n'apparaissent plus (clearCues)
let generation = 0;
const later = (s, fn) => { const g = generation; setTimeout(() => { if (g === generation) fn(); }, s * 1000); };
const footOf = pi => { const o = pieceObject(pi); return new THREE.Vector3(o.grp.position.x, topY(o.h) + 0.03, o.grp.position.z); };

function drop(obj) {
  cueGroup.remove(obj);
  if (!(obj instanceof THREE.Sprite) && obj.geometry !== ringGeo) obj.geometry.dispose();
  obj.material.dispose();
}

// onde qui s'élargit et s'efface au pied d'une pièce
function ripple(pi, color, { delay = 0, from = 0.6, to = 1.6, dur = 0.9, opacity = 1 } = {}) {
  later(delay, () => {
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: TEX.ring, color, transparent: true, depthWrite: false, opacity: 0 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(footOf(pi));
    cueGroup.add(ring);
    tween(dur, k => {
      ring.scale.setScalar(from + (to - from) * (1 - Math.pow(1 - k, 2)));
      ring.material.opacity = opacity * (1 - k);
    }).then(() => drop(ring));
  });
}

// arc tendu d'une pièce à l'autre : il se trace, reste un instant, puis s'efface
function arc(fromPi, toPi, color, delay = 0) {
  later(delay, () => {
    const a = pieceObject(fromPi).grp.position.clone().setY(topY(pieceObject(fromPi).h) + 0.45);
    const b = pieceObject(toPi).grp.position.clone().setY(topY(pieceObject(toPi).h) + 0.45);
    const mid = a.clone().lerp(b, 0.5);
    mid.y += 0.35 + a.distanceTo(b) * 0.18;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const geo = new THREE.TubeGeometry(curve, 32, 0.035, 6, false);
    const tube = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    tube.renderOrder = 5;
    const total = geo.index.count;
    geo.setDrawRange(0, 0);
    cueGroup.add(tube);
    tween(1.3, k => {
      geo.setDrawRange(0, Math.ceil(Math.min(1, k / 0.3) * total / 6) * 6);
      tube.material.opacity = k < 0.6 ? 0.95 : 0.95 * (1 - (k - 0.6) / 0.4);
    }).then(() => drop(tube));
  });
}

// viseur au-dessus d'une pièce menacée : il apparaît en rebondissant, puis s'efface
function aim(pi, delay = 0) {
  later(delay, () => {
    const o = pieceObject(pi);
    const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.target, color: DANGER, transparent: true, depthTest: false }));
    mark.renderOrder = 10;
    const y = topY(o.h) + 1.5;
    mark.position.set(o.grp.position.x, y, o.grp.position.z);
    cueGroup.add(mark);
    tween(1.4, k => {
      const pop = k < 0.2 ? Math.sin((k / 0.2) * Math.PI * 0.75) / Math.sin(Math.PI * 0.75) : 1;
      mark.scale.setScalar(0.75 * Math.min(1.25, pop));
      mark.position.y = y + 0.06 * Math.sin(k * 12);
      mark.material.opacity = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    }).then(() => drop(mark));
  });
}

// la pièce menacée frémit
function shiver(pi, delay = 0) {
  if (calm()) return;
  later(delay, () => {
    const g = pieceObject(pi).grp;
    tween(0.5, k => { g.rotation.z = Math.sin(k * Math.PI * 9) * 0.07 * (1 - k); }).then(() => { g.rotation.z = 0; });
  });
}

const headOf = pi => footOf(pi).add(new THREE.Vector3(0, 1.1, 0));

/**
 * Montre et fait entendre les événements d'un coup qui vient d'être joué (pièces déjà à leur place).
 * @param {import('../../core/events.js').MoveEvent[]} events
 * @param {number} me camp du joueur assis devant l'écran (-1 : aucun, ou les deux) : une menace contre lui sonne l'alerte
 */
export function showCues(events, me = -1) {
  let threatSounded = false;
  for (const e of events) {
    if (e.kind === 'reinforce') {
      const color = e.saved ? BEST : SUPPORT;
      arc(e.pi, e.ally, color);
      ripple(e.ally, color, { delay: 0.3 });
      later(0.3, () => floatText(headOf(e.ally), '+1', '#' + new THREE.Color(color).getHexString(), 'small'));
      Sound.reinforce(e.saved, 0.3);
    } else if (e.kind === 'safe') {
      ripple(e.pi, BEST, { delay: 0.1 });
      Sound.relief(0.1);
    } else if (e.kind === 'exposed') {
      ripple(e.pi, DANGER, { delay: 0.2, opacity: 0.6 });
      ripple(e.pi, DANGER, { delay: 0.55, opacity: 0.45 });
    } else if (e.kind === 'threat') {
      for (const by of e.by) arc(by, e.target, DANGER, 0.35);
      aim(e.target, 0.6);
      shiver(e.target, 0.65);
      ripple(e.target, DANGER, { delay: 0.6 });
      // une alerte suffit, pour la menace la plus forte
      if (!threatSounded) Sound.threat(me >= 0 && pieceObject(e.target).o === me, 0.6);
      threatSounded = true;
    } else if (e.kind === 'brink') {
      for (let k = 0; k < (e.decisive ? 3 : 2); k++) ripple(e.pi, GOLD, { delay: 0.5 + k * 0.6, from: 0.5, to: 1.9, dur: 1.1 });
      Sound.heartbeat(e.decisive, 0.5);
    }
  }
}

/** Efface les signaux encore visibles (coup repris, nouvelle partie, navigation). */
export function clearCues() {
  generation++;
  for (const o of [...cueGroup.children]) drop(/** @type {any} */ (o));
}
