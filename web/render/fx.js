// Animation d'un coup : la pièce saute de case en case, une capture fait voler des éclats, une sortie s'envole
import * as THREE from 'three';
import { STR } from '../../core/index.js';
import { scene, camera, gfx, LEVEL, topY, cellXZ, exitZ } from './context.js';
import { tween, easeIO, wait } from './tween.js';
import { pieceObject, setPieceOpacity } from './pieces.js';
import { TEAM, GOLD } from '../colors.js';

function hop(obj, from, to, arc, dur) {
  return tween(dur, k => {
    const e = easeIO(k);
    obj.position.lerpVectors(from, to, e);
    obj.position.y += Math.sin(Math.PI * e) * arc;
  });
}

// éclats (capture) et étincelles (sortie), animés par la boucle de rendu
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

// texte qui monte et s'efface au-dessus d'un point du plateau (points marqués)
function floatText(worldPos, text, color) {
  const v = worldPos.clone().project(camera);
  const el = document.createElement('div');
  el.className = 'float';
  el.textContent = text;
  el.style.color = color;
  el.style.left = ((v.x + 1) / 2) * innerWidth + 'px';
  el.style.top = ((1 - v.y) / 2) * innerHeight + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

// anime le coup m joué depuis la position before (les pièces sont ensuite replacées par syncPieces)
export async function animateMove(m, before) {
  const obj = pieceObject(m.pi), grp = obj.grp, p = before.pieces[m.pi];
  const pos = i => { const [x, z] = cellXZ(i); return new THREE.Vector3(x, topY(before.h[i]), z); };
  const cells = m.path;
  const defender = m.kind === 'attack' ? pieceObject(before.cell[m.to]) : null;

  for (let k = 1; k < cells.length; k++) {
    const a = grp.position.clone(), b = pos(cells[k]);
    const final = k === cells.length - 1;
    const dh = Math.abs(before.h[cells[k]] - before.h[cells[k - 1]]);
    const arc = m.special ? 0.9 : 0.16 + dh * LEVEL * 0.55;
    const dur = m.special ? 0.5 : 0.17 + dh * 0.04;
    if (final && defender) {
      const dPos = defender.grp.position.clone();
      const hit = hop(grp, a, b, arc + 0.25, dur + 0.08);
      await wait((dur + 0.08) * 650);
      burst(dPos.clone().add(new THREE.Vector3(0, 0.4, 0)), TEAM[1 - p.o].main, 30);
      const tb = gfx.theme.burst || {};
      burst(dPos.clone().add(new THREE.Vector3(0, 0.4, 0)), tb.color ?? 0xffe0a0, tb.count ?? 12, !tb.shards, tb.gravity ?? null, tb.speed ?? 1);
      tween(0.35, e => { defender.grp.scale.setScalar(1 - e); defender.grp.rotation.y += 0.25; }).then(() => { defender.grp.visible = false; });
      await hit;
    } else await hop(grp, a, b, arc, dur);
  }

  if (m.kind === 'exit') {
    const a = grp.position.clone();
    const b = new THREE.Vector3(a.x, 0.05, exitZ(p.o));
    await hop(grp, a, b, 0.4, 0.35);
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
