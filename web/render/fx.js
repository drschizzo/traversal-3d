// Animation d'un coup : la pièce saute de case en case, une capture fait voler des éclats, une sortie s'envole.
// Chaque pas sonne (plus aigu en montée), la pièce s'écrase un peu en se posant, une capture fige l'image un instant
// et secoue la caméra (sauf si le système demande moins d'animations).
import * as THREE from 'three';
import { STR } from '../../core/index.js';
import { scene, camera, gfx, LEVEL, topY, cellXZ, exitZ } from './context.js';
import { tween, easeIO, wait, hitStop } from './tween.js';
import { pieceObject, setPieceOpacity } from './pieces.js';
import * as Sound from '../audio/sound.js';
import { TEAM, GOLD } from '../colors.js';

// moins d'animations demandé par le système : ni secousse, ni arrêt sur image
const calmMQ = matchMedia('(prefers-reduced-motion: reduce)');
export const calm = () => calmMQ.matches;

function hop(obj, from, to, arc, dur) {
  return tween(dur, k => {
    const e = easeIO(k);
    obj.position.lerpVectors(from, to, e);
    obj.position.y += Math.sin(Math.PI * e) * arc;
  });
}

// la pièce s'écrase en touchant sa case, puis reprend sa forme
function squash(grp, amount, dur) {
  return tween(dur, k => {
    const s = Math.sin(Math.PI * k) * amount * (1 - k * 0.4);
    grp.scale.set(1 + s * 0.6, 1 - s, 1 + s * 0.6);
  }).then(() => grp.scale.setScalar(1));
}

// ---------------------------------------------------------------- secousse de la caméra
let shakeAmp = 0;
const shakeVec = new THREE.Vector3();
export function shake(amp) { if (!calm()) shakeAmp = Math.max(shakeAmp, amp); }
export const shaking = () => shakeAmp > 0;
/** Décalage de la caméra pour cette image (ajouté avant le rendu, retiré après : loop.js). */
export function shakeOffset(dt) {
  if (shakeAmp < 0.003) { shakeAmp = 0; return shakeVec.set(0, 0, 0); }
  const a = shakeAmp;
  shakeAmp *= Math.exp(-dt * 10);
  return shakeVec.set((Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * 2 * a);
}

// éclats (capture), étincelles (sortie) et poussière (atterrissage), animés par la boucle de rendu
const particles = [];
export const bursting = () => particles.length > 0;
const shardGeo = new THREE.TetrahedronGeometry(0.07);
const sparkGeo = new THREE.OctahedronGeometry(0.05);
function burst(pos, color, n = 26, spark = false, gravity = null, speed = 1) {
  for (let i = 0; i < n; i++) {
    const mat = spark
      ? new THREE.MeshBasicMaterial({ color, transparent: true })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.4, transparent: true, flatShading: true });
    const m = new THREE.Mesh(spark ? sparkGeo : shardGeo, mat);
    m.position.copy(pos);
    const a = Math.random() * Math.PI * 2, sp = (spark ? 0.6 + Math.random() * 1.2 : 1.2 + Math.random() * 2.2) * speed;
    m.userData = { v: new THREE.Vector3(Math.cos(a) * sp, ((spark ? 1.5 : 2.5) + Math.random() * 2.5) * speed, Math.sin(a) * sp), life: 0, max: spark ? 1.4 : 1.1, spark, g: gravity };
    scene.add(m);
    particles.push(m);
  }
}
// petit nuage au pied d'une pièce qui se pose : des grains qui glissent à ras de la case
function puff(pos, n) {
  const color = gfx.theme.dust?.color ?? '#d8d0c0';
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(pos);
    m.scale.setScalar(0.6 + Math.random() * 0.5);
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, sp = 0.7 + Math.random() * 0.5;
    m.userData = { v: new THREE.Vector3(Math.cos(a) * sp, 0.25 + Math.random() * 0.3, Math.sin(a) * sp), life: 0, max: 0.45, spark: true, g: 0.6 };
    scene.add(m);
    particles.push(m);
  }
}
export function stepBursts(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i], u = p.userData;
    u.life += dt;
    u.v.y -= (u.g ?? (u.spark ? 1.2 : 9)) * dt;
    p.position.addScaledVector(u.v, dt);
    p.rotation.x += dt * 6; p.rotation.y += dt * 4;
    p.material.opacity = Math.max(0, 1 - u.life / u.max);
    if (u.life >= u.max) { scene.remove(p); p.material.dispose(); particles.splice(i, 1); }
  }
}

/** Texte qui monte et s'efface au-dessus d'un point du plateau (points marqués, rapport de force, renfort). */
export function floatText(worldPos, text, color, cls = '') {
  const v = worldPos.clone().project(camera);
  const el = document.createElement('div');
  el.className = 'float' + (cls ? ' ' + cls : '');
  el.textContent = text;
  el.style.color = color;
  el.style.left = ((v.x + 1) / 2) * innerWidth + 'px';
  el.style.top = ((1 - v.y) / 2) * innerHeight + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

/** Fin de partie : pluie d'étincelles aux couleurs du vainqueur et d'or au-dessus du plateau. */
export function celebrate(color) {
  const n = Math.round(30 * Math.max(0.5, gfx.Q.particles));
  for (let k = 0; k < 5; k++)
    setTimeout(() => {
      const p = new THREE.Vector3((Math.random() - 0.5) * 7, 2.5 + Math.random(), (Math.random() - 0.5) * 7);
      burst(p, k % 2 ? GOLD : color, n, true, 1.6, 1.3);
    }, k * 180);
}

// anime le coup m joué depuis la position before (les pièces sont ensuite replacées par syncPieces)
export async function animateMove(m, before) {
  const obj = pieceObject(m.pi), grp = obj.grp, p = before.pieces[m.pi];
  const pos = i => { const [x, z] = cellXZ(i); return new THREE.Vector3(x, topY(before.h[i]), z); };
  const cells = m.path;
  const defender = m.kind === 'attack' ? pieceObject(before.cell[m.to]) : null;
  if (m.special) Sound.leap();

  for (let k = 1; k < cells.length; k++) {
    const a = grp.position.clone(), b = pos(cells[k]);
    const final = k === cells.length - 1;
    const rise = before.h[cells[k]] - before.h[cells[k - 1]], dh = Math.abs(rise);
    const arc = m.special ? 0.9 : 0.16 + dh * LEVEL * 0.55;
    const dur = m.special ? 0.5 : 0.17 + dh * 0.04;
    if (final && defender) {
      const dPos = defender.grp.position.clone(), at = dPos.clone().add(new THREE.Vector3(0, 0.4, 0));
      const hit = hop(grp, a, b, arc + 0.25, dur + 0.08);
      await wait((dur + 0.08) * 650);
      const dp = before.pieces[before.cell[m.to]];
      Sound.capture(STR[dp.t]);
      if (m.combat?.vb) Sound.zap(0.05);
      if (!calm()) hitStop(70);
      shake(0.12 + STR[dp.t] * 0.04);
      burst(at, TEAM[1 - p.o].main, 30);
      const tb = gfx.theme.burst || {};
      burst(at, tb.color ?? 0xffe0a0, tb.count ?? 12, !tb.shards, tb.gravity ?? null, tb.speed ?? 1);
      // le rapport de force qui a permis la capture
      if (m.combat) floatText(at.clone().add(new THREE.Vector3(0, 0.6, 0)), `${m.combat.att} ≥ ${m.combat.def}`, '#fff', 'small');
      tween(0.35, e => { defender.grp.scale.setScalar(1 - e); defender.grp.rotation.y += 0.25; }).then(() => { defender.grp.visible = false; });
      await hit;
      Sound.land();
      await squash(grp, 0.2, 0.18);
    } else {
      await hop(grp, a, b, arc, dur);
      if (final && m.kind !== 'exit') {
        Sound.land();
        puff(b.clone().add(new THREE.Vector3(0, 0.05, 0)), Math.round(10 * gfx.Q.particles));
        await squash(grp, m.special ? 0.22 : 0.16, 0.16);
      } else {
        Sound.step(rise);
        squash(grp, 0.06, 0.1);
      }
    }
  }

  if (m.kind === 'exit') {
    const a = grp.position.clone();
    const b = new THREE.Vector3(a.x, 0.05, exitZ(p.o));
    await hop(grp, a, b, 0.4, 0.35);
    Sound.exit(STR[p.t]);
    burst(b.clone().add(new THREE.Vector3(0, 0.3, 0)), GOLD, 34, true);
    floatText(b.clone().add(new THREE.Vector3(0, 0.8, 0)), '+' + STR[p.t], TEAM[p.o].css);
    setPieceOpacity(obj, 1);
    const start = grp.position.clone();
    await tween(0.8, e => {
      grp.position.set(start.x, start.y + e * 2.2, start.z + (p.o === 0 ? -1 : 1) * e * 0.6);
      grp.rotation.y += 0.12;
      setPieceOpacity(obj, 1 - e);
    });
    grp.visible = false;
  }
}
