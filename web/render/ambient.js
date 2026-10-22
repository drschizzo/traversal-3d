// Ambiance : une poussière et un second système de particules (étincelles, lucioles, flocons…) selon le thème,
// et la lumière qui vacille pour les thèmes de feu. Les particules sont animées dans le vertex shader ;
// chaque point a une valeur aléatoire (taille, phase, vitesse).
import * as THREE from 'three';
import { mulberry32 } from '../../core/index.js';
import { scene, renderer, gfx, FLOOR_Y, fill, hemi } from './context.js';
import { radialTexture } from './textures.js';

const dotTex = radialTexture(32);
const time = { value: 0 };
const particleMaxPx = { value: 64 }; // taille maximale d'une particule à l'écran, en pixels (selon la qualité)
// visibilité des particules (0 à 1) : en rendu à la demande, elles s'effacent avant que l'image se fige (loop.js)
export const particleFade = { value: 1 };

function makeParticles(n, rMin, rMax, seed) {
  const rng = mulberry32(seed);
  const dp = new Float32Array(n * 3), rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, r = rMin + rng() * (rMax - rMin);
    dp.set([Math.cos(a) * r, FLOOR_Y + rng() * 20, Math.sin(a) * r], i * 3);
    rnd[i] = rng();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const u = { uSpeed: { value: 0.25 }, uSway: { value: 0 }, uSizeVar: { value: 0 }, uFlicker: { value: 0 }, uSpeedVar: { value: 0 }, uMaxPx: particleMaxPx };
  const mat = new THREE.PointsMaterial({ size: 0.16, map: dotTex, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u, { uTime: time, uPartFade: particleFade });
    sh.vertexShader = 'uniform float uTime, uSpeed, uSway, uSizeVar, uFlicker, uSpeedVar, uMaxPx;\nattribute float aRnd;\nvarying float vFlick;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', `vec3 transformed = position;
        float spd = uSpeed * mix(1.0, 0.5 + aRnd, uSpeedVar);
        transformed.y = ${FLOOR_Y.toFixed(2)} + mod(position.y - ${FLOOR_Y.toFixed(2)} + uTime * spd, 20.0);
        transformed.xz += vec2(sin(uTime * 0.7 + aRnd * 6.28 + position.z), cos(uTime * 0.6 + aRnd * 4.0 + position.x)) * uSway;
        vFlick = mix(1.0, pow(0.5 + 0.5 * sin(uTime * (2.0 + aRnd * 5.0) + aRnd * 40.0), 2.0), uFlicker);`)
      .replace('gl_PointSize = size;', 'gl_PointSize = size * mix(1.0, 0.35 + 1.3 * aRnd, uSizeVar);')
      // près de la caméra, un point deviendrait un grand disque transparent : coûteux à remplir, surtout sur mobile
      .replace('#include <fog_vertex>', 'gl_PointSize = min(gl_PointSize, uMaxPx);\n#include <fog_vertex>');
    sh.fragmentShader = 'uniform float uPartFade;\nvarying float vFlick;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vFlick * uPartFade;');
  };
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 2;
  scene.add(pts);
  return { pts, mat, u };
}
const dust = makeParticles(700, 4, 44, 1234);
const extra = makeParticles(260, 3, 26, 777);

// moins de particules aux niveaux de qualité inférieurs (elles se superposent en transparence)
export function applyAmbientQuality() {
  particleMaxPx.value = gfx.Q.pointPx * renderer.getPixelRatio();
  for (const sys of [dust, extra]) sys.pts.geometry.setDrawRange(0, Math.round(sys.pts.geometry.attributes.position.count * gfx.Q.particles));
}
applyAmbientQuality();

function configParticles(sys, cfg) {
  sys.pts.visible = !!cfg;
  if (!cfg) return;
  sys.mat.color.set(cfg.color);
  sys.mat.size = cfg.size ?? 0.16;
  sys.mat.opacity = cfg.opacity ?? 0.7;
  sys.u.uSpeed.value = cfg.speed ?? 0.25;
  sys.u.uSway.value = cfg.sway ?? 0;
  sys.u.uSizeVar.value = cfg.sizeVar ?? 0.6;
  sys.u.uFlicker.value = cfg.flicker ?? 0;
  sys.u.uSpeedVar.value = cfg.speedVar ?? 0.5;
}

export function applyAmbientTheme(theme) {
  configParticles(dust, theme.dust);
  configParticles(extra, theme.extra);
}

export function updateAmbient(t) {
  time.value = t;
  // lumière qui vacille (feu) pour les thèmes qui le demandent
  const fl = gfx.theme.flicker || 0;
  if (fl) {
    const k = 1 + fl * (Math.sin(t * 7.3) * 0.5 + Math.sin(t * 13.1 + 1.7) * 0.3 + Math.sin(t * 3.1) * 0.4);
    fill.intensity = 0.8 * k;
    hemi.intensity = 0.6 * (1 + (k - 1) * 0.5);
  }
}
