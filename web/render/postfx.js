// Post-traitement : halo lumineux puis étalonnage (le flou du décor est fait directement sur le pavage, background.js)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { renderer, scene, camera, gfx } from './context.js';
import gradeFrag from './glsl/grade.frag.glsl?raw';

export const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: gfx.Q.msaa, type: THREE.HalfFloatType }));
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
// halo lumineux autour des sources vives (braises, lucioles, éclats de givre…), réglé par thème
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// étalonnage final, en espace écran : une seule passe plein écran, tous les effets pilotés par le thème
const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.3 }, uVigColor: { value: new THREE.Color(0) },
    uShadowTint: { value: new THREE.Color(0) }, uHighTint: { value: new THREE.Color(0) },
    uSat: { value: 1 }, uContrast: { value: 1 }, uGrain: { value: 0 }, uCA: { value: 0 },
    uFrost: { value: 0 }, uLeak: { value: new THREE.Color(0) }, uHeat: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: gradeFrag,
});
composer.addPass(gradePass);

export function sizePostFx() {
  composer.setSize(innerWidth, innerHeight);
  gradePass.uniforms.uRes.value.set(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
}
sizePostFx();

export const setPostTime = t => { gradePass.uniforms.uTime.value = t; };

const bloomOf = theme => theme.post?.bloom || { strength: 0.35, radius: 0.5, threshold: 0.85 };
const updateBloom = () => { bloom.enabled = gfx.Q.bloom && bloomOf(gfx.theme).strength > 0; };

export function applyPostTheme(theme) {
  const pp = theme.post || {};
  const gu = gradePass.uniforms;
  gu.uVignette.value = pp.vignette ?? 0.3;
  // couleurs d'étalonnage en espace écran : prises telles quelles, sans conversion linéaire
  const raw = (c, hex) => c.setHex(parseInt((hex || '#000000').slice(1), 16), THREE.LinearSRGBColorSpace);
  raw(gu.uVigColor.value, pp.vignetteColor);
  raw(gu.uShadowTint.value, pp.shadows);
  raw(gu.uHighTint.value, pp.highlights);
  gu.uSat.value = pp.saturation ?? 1;
  gu.uContrast.value = pp.contrast ?? 1;
  gu.uGrain.value = pp.grain ?? 0;
  gu.uCA.value = pp.aberration ?? 0;
  gu.uFrost.value = pp.frost ?? 0;
  raw(gu.uLeak.value, pp.leak);
  gu.uHeat.value = pp.heat ?? 0;
  const bl = bloomOf(theme);
  bloom.strength = bl.strength; bloom.radius = bl.radius ?? 0.5; bloom.threshold = bl.threshold ?? 0.85;
  updateBloom();
  return bl;
}

// changement de niveau de qualité : résolution, MSAA, halo
export function applyPostQuality() {
  composer.setPixelRatio(renderer.getPixelRatio());
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) { rt.samples = gfx.Q.msaa; rt.dispose(); }
  sizePostFx();
  updateBloom();
}
