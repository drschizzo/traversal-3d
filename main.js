import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import * as G from './game.js';
import { chooseMove } from './ai.js';
import { THEMES } from './themes.js';
import { explain, renderAnalysis, hintSentence } from './coach.js';
import { reviewMove, renderSummary, renderGraph, renderList, renderDetail } from './review.js';

const LEVEL = 0.3;
const topY = h => (h + 1) * LEVEL;
const cellXZ = i => [G.cx(i) - 4.5, 4.5 - G.cy(i)];
const TEAM = [
  { main: 0xc8323c, dark: 0x5c1117, css: '#e0484f' },
  { main: 0x2c68d6, dark: 0x102c66, css: '#4d8cf0' },
];
const $ = id => document.getElementById(id);

// ================================================================ qualité graphique
// Trois niveaux, plus « auto » (par défaut) : moyen d'emblée sur un appareil tactile, haut sinon, puis un cran de
// moins tant que l'image n'est pas fluide. Les postes qui coûtent sur mobile : le pavage en raymarching (pas,
// résolution, fréquence de mise à jour), le post-traitement en demi-flottants (MSAA, halo, étalonnage : plusieurs
// passes plein écran) et les ombres douces. Au niveau bas, la scène est rendue directement à l'écran.
const QUALITY = {
  // live : l'image est recalculée en continu (brume, lucioles, effets animés) ; sinon seulement quand quelque chose bouge
  // bakedNoise : bruit lu dans une texture précalculée au lieu d'être calculé à chaque pixel
  high: { name: 'haute', live: true, bakedNoise: false, pr: 1.5, msaa: 4, post: true, bloom: true, field: 0.5, steps: 30, octave2: 1, fieldEvery: 1, shadow: 2048, soft: true, particles: 1, pointPx: 48, shadowEvery: 1 },
  medium: { name: 'moyenne', live: true, bakedNoise: false, pr: 1.25, msaa: 2, post: true, bloom: true, field: 0.35, steps: 20, octave2: 0, fieldEvery: 2, shadow: 1024, soft: false, particles: 0.6, pointPx: 32, shadowEvery: 2 },
  low: { name: 'basse', live: false, bakedNoise: true, pr: 1, msaa: 0, post: false, bloom: false, field: 0.25, steps: 14, octave2: 0, fieldEvery: 3, shadow: 1024, soft: false, particles: 0.35, pointPx: 20, shadowEvery: 4 },
};
const LEVELS_ORDER = ['high', 'medium', 'low'];
let qualityPref = 'auto';
try { qualityPref = localStorage.getItem('traversal.quality') || 'auto'; } catch {}
if (qualityPref !== 'auto' && !QUALITY[qualityPref]) qualityPref = 'auto';
// niveau de départ du mode auto : basse sur téléphone, moyenne sur tablette, haute ailleurs
function autoStartLevel() {
  if (!matchMedia('(pointer: coarse)').matches) return 'high';
  return Math.min(screen.width, screen.height) < 600 ? 'low' : 'medium';
}
let qualityLevel = qualityPref === 'auto' ? autoStartLevel() : qualityPref;
let Q = QUALITY[qualityLevel];

// ================================================================ renderer & scène
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;   // recalcul à la demande (voir la boucle)
let shadowDirty = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const HORIZON = new THREE.Color(0x1f2238);
scene.fog = new THREE.Fog(HORIZON, 34, 120);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 300);
camera.position.set(0, 12.5, 12.5);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 7;
controls.maxDistance = 34;
controls.maxPolarAngle = Math.PI * 0.3;   // l'horizon reste hors champ
controls.enablePan = true;
controls.screenSpacePanning = false;   // deux doigts (ou clic droit) : le plateau glisse dans son plan
controls.panSpeed = 0.9;

// téléphones (paysage ou portrait) : mêmes seuils que la feuille de style
const compactMQ = matchMedia('(orientation: landscape) and (max-height: 500px), (orientation: portrait) and (max-width: 500px)');

// recule la caméra sur les écrans étroits pour que tout le plateau reste visible
function fitCamera() {
  const dist = 16.5 * Math.max(1, 1.35 / camera.aspect);
  controls.maxDistance = dist;   // pas de dézoom au-delà du cadrage par défaut
  const off = camera.position.clone().sub(controls.target);
  camera.position.copy(controls.target).add(off.setLength(Math.min(dist, controls.maxDistance)));
}
fitCamera();

// post-traitement : halo lumineux puis étalonnage (le flou du décor est fait directement sur le pavage, voir renderField)
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: Q.msaa, type: THREE.HalfFloatType }));
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
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uSat, uContrast, uGrain, uCA, uFrost, uHeat;
    uniform vec2 uRes; uniform vec3 uVigColor, uShadowTint, uHighTint, uLeak;
    varying vec2 vUv;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    void main(){
      vec2 uv = vUv, c = uv - 0.5;
      float edge = length(c * vec2(uRes.x / uRes.y, 1.0));
      // chaleur : l'air ondule en haut de l'écran (là où il n'y a que le décor)
      float heatW = 0.0, heatN = 0.0;
      if (uHeat > 0.0) {
        // le centre de l'écran (où se trouve le plateau) est presque épargné, pour garder la lisibilité
        heatW = smoothstep(0.2, 0.85, uv.y) * (0.12 + 0.88 * smoothstep(0.28, 0.6, edge)) * uHeat;
        heatN = n2(vec2(uv.x * 9.0, uv.y * 6.0 - uTime * 1.4)) - 0.5;
        uv.x += heatN * 0.014 * heatW;
        uv.y += (n2(vec2(uv.x * 7.0 + 3.0, uv.y * 5.0 - uTime * 1.1)) - 0.5) * 0.01 * heatW;
      }
      // aberration chromatique, seulement vers les bords
      vec3 col;
      if (uCA > 0.0) {
        vec2 o = c * uCA * edge * 0.02;
        col = vec3(texture2D(tDiffuse, uv + o).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - o).b);
      } else col = texture2D(tDiffuse, uv).rgb;
      // teintes : ombres et hautes lumières colorées séparément
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += uShadowTint * (1.0 - smoothstep(0.0, 0.5, l)) + uHighTint * smoothstep(0.45, 1.0, l);
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      // chaleur : en plus de la déformation, des volutes d'air chaud plus claires montent
      col += vec3(0.5, 0.18, 0.04) * max(heatN, 0.0) * heatW * 0.35;
      // fuites de lumière : grand halo qui respire depuis un coin, et un second plus faible en face (mélange « écran »)
      float breathe = 0.7 + 0.3 * sin(uTime * 0.35);
      vec3 leak = uLeak * (smoothstep(1.25, 0.0, length((uv - vec2(1.0, 1.02)) * vec2(1.0, 1.4))) * breathe
                         + 0.5 * smoothstep(0.9, 0.0, length(uv - vec2(-0.05, 0.25))) * (1.0 - breathe * 0.5));
      col = 1.0 - (1.0 - col) * (1.0 - clamp(leak, 0.0, 1.0));
      // givre qui gagne les bords de l'écran
      if (uFrost > 0.0) {
        vec2 fu = uv * vec2(uRes.x / uRes.y, 1.0);
        // le voile dérive lentement
        float fr = n2(fu * 7.0 + vec2(uTime * 0.03, -uTime * 0.02)) * 0.6 + n2(fu * 23.0 - uTime * 0.04) * 0.4;
        // aiguilles de givre qui poussent depuis les bords et avancent / reculent doucement vers le centre
        vec2 pc = c * vec2(uRes.x / uRes.y, 1.0);
        float ang = atan(pc.y, pc.x), rad = length(pc);
        float creep = sin(uTime * 0.22 + ang * 2.0) * 0.5 + 0.5;
        float needles = pow(1.0 - abs(2.0 * n2(vec2(ang * 30.0, rad * 9.0 + fr * 2.0 + uTime * 0.08)) - 1.0), 9.0)
                      + 0.6 * pow(1.0 - abs(2.0 * n2(vec2(ang * 80.0 + 4.0, rad * 16.0 + uTime * 0.12)) - 1.0), 12.0);
        needles *= smoothstep(0.4, 0.75, n2(vec2(ang * 5.0 + uTime * 0.02, rad * 2.0) + 9.0));   // en touffes qui se déplacent
        needles *= 0.75 + 0.25 * sin(uTime * 1.3 + ang * 11.0 + rad * 20.0);                     // lumière qui joue dans les cristaux
        float m = smoothstep(0.5 + 0.06 * creep, 0.9 + 0.04 * creep, edge + (fr - 0.5) * 0.45) * uFrost;
        float glint = step(0.996, h21(floor(fu * 160.0))) * (0.5 + 0.5 * sin(uTime * 3.0 + h21(floor(fu * 160.0) + 7.0) * 30.0));
        col = mix(col, vec3(0.88, 0.94, 1.0), m * (0.25 + 0.4 * fr));
        col += vec3(0.85, 0.95, 1.0) * (needles * 0.6 + glint) * m;
      }
      // vignette
      col = mix(col, uVigColor, smoothstep(0.35, 0.95, edge) * uVignette);
      // grain de film
      if (uGrain > 0.0) col += (h21(uv * uRes + fract(uTime) * 91.7) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
});
composer.addPass(gradePass);
function sizeGrade() { gradePass.uniforms.uRes.value.set(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio()); }
sizeGrade();

// brume d'horizon : même fonction pour le ciel et le sol, pour qu'ils se fondent sans démarcation
const HAZE_BAND = new THREE.Vector3(0.20, 0.16, 0.27);
const HAZE_GLSL = `vec3 hazeColor(vec3 fogc, vec3 band, float elev){ return fogc + band * exp(-abs(elev) * 7.0); }`;

// ciel : dégradé nocturne et halos colorés (presque toujours masqué par la brume du sol)
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    top: { value: new THREE.Color(0x0b0f1d) }, bot: { value: HORIZON }, band: { value: HAZE_BAND },
    gA: { value: new THREE.Color(0x7a4a8c) }, gB: { value: new THREE.Color(0x2c7f8f) }, gC: { value: new THREE.Color(0xb8763c) },
  },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 top, bot, gA, gB, gC, band; varying vec3 vP;
    ${HAZE_GLSL}
    float glow(vec3 d, float p){ return pow(max(dot(vP, normalize(d)), 0.0), p); }
    void main(){
      float h = vP.y;
      vec3 hz = hazeColor(bot, band, h);
      vec3 c = mix(hz, top, smoothstep(0.0, 0.7, h));
      float above = smoothstep(0.0, 0.18, h);
      c += gA * glow(vec3(-1.0, 0.3, -0.6), 5.0) * 0.5 * above;
      c += gB * glow(vec3(1.0, 0.2, 0.4), 5.0) * 0.45 * above;
      c += gC * glow(vec3(0.32, 0.26, -1.0), 9.0) * 0.32 * above;

      c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

// lumières
const hemi = new THREE.HemisphereLight(0xc9d3ff, 0x2a2438, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffeccf, 3.0);
sun.position.set(-7, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(Q.shadow, Q.shadow);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x8fb4ff, 0.8);
fill.position.set(8, 6, -8);
scene.add(fill);

// ---------------------------------------------------------------- l'espace des plateaux possibles
// Le plateau joué se dresse sur un socle au milieu d'un pavage infini d'autres plateaux possibles,
// tous produits par le même générateur. Ce pavage est rendu en raymarching volumétrique : une brume
// dont la densité épouse le relief en colonnes de chaque plateau, et qui se perd dans le brouillard d'horizon.
const FLOOR_Y = -3.4;
const TILE_PITCH = 12;                  // un plateau 10×10 + une allée de brume
const ATLAS_N = 8;                      // atlas de 8×8 = 64 plateaux distincts
const FIELD_TOP = FLOOR_Y + 3.3;
const MODES = G.TERRAIN_MODES.map(m => m[0]);
const randSeed = () => (Math.random() * 2 ** 32) >>> 0;

// sol sombre sous la brume, qui se fond dans l'horizon
const floorMat = new THREE.ShaderMaterial({
  uniforms: { base: { value: new THREE.Color(0x0a0c16) }, fogc: { value: HORIZON }, band: { value: HAZE_BAND } },
  vertexShader: 'varying vec3 vWp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `uniform vec3 base, fogc, band; varying vec3 vWp;
    ${HAZE_GLSL}
    void main(){
      vec3 dir = normalize(vWp - cameraPosition);
      vec3 c = mix(base, hazeColor(fogc, band, dir.y), smoothstep(20.0, 68.0, length(vWp.xz - cameraPosition.xz)));
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
{
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(440, 440), new THREE.MeshBasicMaterial({ colorWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  scene.add(floor);
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.4 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = FLOOR_Y + 0.005;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);
}

// atlas des hauteurs : 64 plateaux générés, entre lesquels chaque case du pavage glisse lentement
const atlas = new THREE.DataTexture(new Uint8Array(ATLAS_N * 10 * ATLAS_N * 10 * 4), ATLAS_N * 10, ATLAS_N * 10, THREE.RGBAFormat);
atlas.magFilter = atlas.minFilter = THREE.NearestFilter;
function writeAtlas(slot, channel, h) {
  const sx = (slot % ATLAS_N) * 10, sy = Math.floor(slot / ATLAS_N) * 10, W = ATLAS_N * 10;
  for (let i = 0; i < 100; i++) atlas.image.data[((sy + G.cy(i)) * W + sx + G.cx(i)) * 4 + channel] = h[i];
  atlas.needsUpdate = true;
}
for (let k = 0; k < ATLAS_N * ATLAS_N; k++) {
  const h = G.generateTerrain(MODES[k % MODES.length], randSeed());
  writeAtlas(k, 0, h);
}

// Bruit 3D précalculé (qualité basse) : les valeurs pseudo-aléatoires du réseau sont rangées dans une texture 3D
// et lues par interpolation matérielle, avec le même lissage que le calcul direct : une lecture au lieu de huit hachages.
const NOISE_N = 128;
const noiseUniform = { value: null };
function ensureNoiseTex() {
  if (noiseUniform.value) return;
  const n = NOISE_N, data = new Uint8Array(n * n * n), fr = v => v - Math.floor(v), h = v => fr(v * 0.3183099 + 0.1) * 17;
  for (let z = 0, k = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++, k++) {
        const a = h(x), b = h(y), c = h(z);
        data[k] = Math.round(fr(a * b * c * (a + b + c)) * 255);
      }
  const tex = new THREE.Data3DTexture(data, n, n, n);
  tex.format = THREE.RedFormat;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  noiseUniform.value = tex;
}
// bruit de valeur lissé : calculé (hachage `hash`) ou lu dans la texture si BAKED_NOISE est défini
const noiseGLSL = (name, hash) => `
  #ifdef BAKED_NOISE
  uniform highp sampler3D uNoise3D;
  float ${name}(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return texture(uNoise3D, (i + f + 0.5) / ${NOISE_N.toFixed(1)}).r; }
  #else
  float ${name}(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(${hash}(i), ${hash}(i + vec3(1, 0, 0)), f.x), mix(${hash}(i + vec3(0, 1, 0)), ${hash}(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(${hash}(i + vec3(0, 0, 1)), ${hash}(i + vec3(1, 0, 1)), f.x), mix(${hash}(i + vec3(0, 1, 1)), ${hash}(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  #endif`;

const fieldMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  defines: { FIELD_STEPS: Q.steps, FIELD_OCTAVE2: Q.octave2 },
  uniforms: {
    uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uFloor: { value: floorMat.uniforms.base.value },
    uAtlas: { value: atlas }, uTime: { value: 0 }, uFade: { value: 0 },
    fogc: { value: HORIZON }, band: { value: HAZE_BAND },
    uLow: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHigh: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() },
    uBeam: { value: new THREE.Color(0) }, uBeamDir: { value: new THREE.Vector2(0.8, 0.6) }, uAlley: { value: new THREE.Color(0) },
    uCaus: { value: 0 }, uSparkle: { value: 0 }, uNoise3D: noiseUniform,
  },
  vertexShader: `uniform mat4 uProjInv, uCamWorld; varying vec3 vDir;
    void main(){
      vec4 v = uProjInv * vec4(position.xy, 1.0, 1.0);
      vDir = (uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D uAtlas; uniform float uTime, uFade, uCaus, uSparkle; uniform vec3 fogc, band, uLow, uMid, uHigh, uEdge, uBeam, uAlley, uFloor, uCamPos; uniform vec2 uBeamDir;
    varying vec3 vDir;
    ${HAZE_GLSL}
    const float FLOOR = ${FLOOR_Y.toFixed(2)}, TOP = ${FIELD_TOP.toFixed(2)}, PITCH = ${TILE_PITCH.toFixed(1)}, AN = ${ATLAS_N.toFixed(1)};
    float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    ${noiseGLSL('noise3', 'hash3')}
    const float PERIOD = 10.0, HOLD = 0.2;   // transition de 8 s (inchangée), pause réduite de 8 s à 2 s
    vec4 cKey = vec4(-9999.0);
    float cH = 0.0;
    float heightAt(float slot, vec2 cell){
      vec2 so = vec2(mod(slot, AN), floor(slot / AN)) * 10.0;
      return texture2D(uAtlas, (so + cell + 0.5) / (AN * 10.0)).r * 255.0;
    }
    // relief au point xz : hauteur du sommet de colonne (monde), masque du plateau, proximité d'une arête de case
    vec3 field(vec2 xz){
      vec2 tile = floor(xz / PITCH + 0.5);
      if (tile == vec2(0.0)) return vec3(FLOOR, 0.0, 0.0);              // emplacement du socle
      vec2 lp = xz - tile * PITCH;
      vec2 g = vec2(lp.x + 5.0, 5.0 - lp.y);
      float mask = smoothstep(-1.0, 0.9, min(min(g.x, g.y), min(10.0 - g.x, 10.0 - g.y)));
      vec2 cell = clamp(floor(g), 0.0, 9.0);
      vec4 key = vec4(tile, cell);
      if (key != cKey) {                     // le rayon reste souvent dans la même case : on garde la hauteur
        cKey = key;
        // chaque plateau a son propre cycle : il garde un monde un moment, puis glisse vers le suivant
        float cyc = uTime / PERIOD + hash2(tile + 7.31);
        float ep = floor(cyc), fr = fract(cyc);
        float hA = heightAt(floor(hash2(tile + ep * 13.17) * AN * AN), cell);
        float t = 0.0;
        float prog = max(fr - HOLD, 0.0) / (1.0 - HOLD) * 1.3;
        if (prog > 0.0) {
          float hB = heightAt(floor(hash2(tile + (ep + 1.0) * 13.17) * AN * AN), cell);
          t = clamp((prog - (cell.x + cell.y) / 18.0 * 0.7) / 0.6, 0.0, 1.0);
          hA = mix(hA, hB, t * t * (3.0 - 2.0 * t));
        }
        cH = hA;
      }
      float h = cH;
      vec2 e = abs(fract(g) - 0.5);
      return vec3(FLOOR + (h + 1.0) * 0.3, mask, smoothstep(0.38, 0.5, max(e.x, e.y)));
    }
    void main(){
      vec3 ro = uCamPos, rd = normalize(vDir);
      // couleur du sol sous la brume (fondu dans l'horizon), visible là où la brume est transparente
      float tf = (FLOOR - ro.y) / min(rd.y, -1e-4);
      vec3 floorCol = mix(uFloor, hazeColor(fogc, band, rd.y), smoothstep(20.0, 68.0, tf * length(rd.xz)));
      // intersection avec la tranche FLOOR..TOP
      float ta = (TOP - ro.y) / rd.y, tb = (FLOOR - ro.y) / rd.y;
      // la caméra est bridée (inclinaison ≤ 54°) : les rayons traversent la tranche en pente raide,
      // sur une douzaine d'unités au plus, donc une trentaine de pas suffisent
      float t0 = max(min(ta, tb), 0.0), t1 = min(max(ta, tb), t0 + 16.0);
      if (t1 <= t0) { gl_FragColor = vec4(floorCol, 1.0); return; }
      const int STEPS = FIELD_STEPS;
      float dt = (t1 - t0) / float(STEPS);
      float t = t0 + dt * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      vec3 acc = vec3(0.0);
      float T = 1.0;
      for (int i = 0; i < STEPS; i++){
        vec3 p = ro + rd * t;
        if (max(abs(p.x), abs(p.z)) < 5.6) break;                              // le rayon bute sur le socle
        float dist = length(p.xz - ro.xz);
        if (dist > 70.0) break;                                                // au-delà, tout est brume
        vec3 f = field(p.xz);
        float H = f.x, dy = p.y - H;
        if (dy > 0.5 && p.y - FLOOR > 2.2) { t += dt; continue; }             // air vide au-dessus du relief : pas de bruit
        vec3 q = p * vec3(0.45, 0.8, 0.45) + vec3(uTime * 0.04, -uTime * 0.05, uTime * 0.02);
        float n = noise3(q);
        #if FIELD_OCTAVE2
        n = dist < 30.0 ? n * 0.65 + noise3(q * 2.3 + 4.7) * 0.35 : n;        // 2e octave seulement de près
        #endif
        float body = smoothstep(0.12, -0.25, dy + (n - 0.5) * 0.35) * f.y;      // colonnes de brume
        float hint = exp(-abs(dy) * 8.0) * f.z * f.y * 0.8 * (1.0 - smoothstep(18.0, 45.0, t));   // arêtes des cases (estompées au loin)
        float ground = exp(-(p.y - FLOOR) * 1.3) * (0.25 + 0.75 * smoothstep(0.35, 0.8, n)) * 0.35;   // brume rampante (comble les allées)
        float dens = (body * (0.3 + 0.8 * n) + hint + ground) * (1.0 - smoothstep(42.0, 70.0, dist));   // distance de vue réduite, sans coupure
        if (dens > 0.002) {
          float k = clamp((H - FLOOR - 0.3) / 2.4, 0.0, 1.0);
          vec3 col = mix(uLow, uMid, smoothstep(0.0, 0.5, k));
          col = mix(col, uHigh, smoothstep(0.55, 1.0, k));
          col *= 0.55 + 0.9 * clamp(0.55 + dy * 0.9 + (n - 0.5) * 0.4, 0.0, 1.0);
          col += uEdge * hint * 0.5;
          if (uCaus > 0.0) {                                                     // reflets ondulants (caustiques)
            float cs = (0.5 + 0.5 * sin(p.x * 2.1 + sin(p.z * 1.7 + uTime * 0.6) * 1.6)) * (0.5 + 0.5 * sin(p.z * 2.3 + sin(p.x * 1.3 - uTime * 0.5) * 1.6));
            col += uHigh * pow(cs, 3.0) * uCaus * exp(-abs(dy) * 4.0);
          }
          if (uSparkle > 0.0) {                                                  // paillettes de givre qui scintillent
            float hs = hash3(floor(p * 7.0));
            col += vec3(1.0) * step(0.992, hs) * (0.5 + 0.5 * sin(uTime * 2.5 + hs * 60.0)) * exp(-abs(dy) * 6.0) * uSparkle;
          }
          col = mix(col, hazeColor(fogc, band, rd.y), smoothstep(22.0, 66.0, dist));   // perspective atmosphérique
          float a = 1.0 - exp(-dens * dt * 1.5);
          acc += T * a * col;
          T *= 1.0 - a;
          if (T < 0.03) break;
        }
        float fadeD = 1.0 - smoothstep(30.0, 60.0, dist);
        if (uAlley.r + uAlley.g + uAlley.b > 0.0) {                              // braises : lueurs diffuses qui couvent sous la brume
          float ember = smoothstep(0.55, 0.9, noise3(vec3(p.xz * 0.11, uTime * 0.06)));
          acc += T * uAlley * ember * exp(-(p.y - FLOOR) * 2.0) * (0.6 + 0.8 * n) * dt * 0.3 * fadeD;
        }
        if (uBeam.r + uBeam.g + uBeam.b > 0.0) {                                 // halos de lumière chaude qui dérivent lentement
          float pool = smoothstep(0.5, 0.85, noise3(vec3(p.xz * 0.06 + uBeamDir * uTime * 0.04, uTime * 0.02)));
          acc += T * uBeam * pool * exp(-max(dy, 0.0) * 1.5) * dt * 0.06 * fadeD;
        }
        t += dt;
      }
      float a = (1.0 - T) * uFade;
      gl_FragColor = vec4(acc * uFade + floorCol * (1.0 - a), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
// le pavage est rendu à part, en demi-résolution, puis sert de fond à la scène (il est très flou de toute façon)
const fieldScene = new THREE.Scene();
const fieldRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
{
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(tri, fieldMat);
  quad.frustumCulled = false;
  fieldScene.add(quad);
}
// flou de profondeur du décor : le pavage (demi-résolution) est réduit au quart avec un filtre doux.
// Bien moins cher qu'une vraie profondeur de champ, et le plateau, au premier plan, reste net.
const blurRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
const blurScene = new THREE.Scene();
const blurMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { tSrc: { value: fieldRT.texture }, uTexel: { value: new THREE.Vector2() } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
    void main(){
      vec2 o = uTexel * 1.5;
      vec3 c = texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb
             + texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb;
      gl_FragColor = vec4(c * 0.25, 1.0);
    }`,
});
{
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const q = new THREE.Mesh(tri, blurMat);
  q.frustumCulled = false;
  blurScene.add(q);
  scene.background = blurRT.texture;
}
function sizeFieldRT() {
  const pr = renderer.getPixelRatio();
  const w = Math.max(1, Math.round(innerWidth * pr * Q.field)), h = Math.max(1, Math.round(innerHeight * pr * Q.field));
  fieldRT.setSize(w, h);
  blurRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
  blurMat.uniforms.uTexel.value.set(1 / w, 1 / h);
}
sizeFieldRT();
function renderField() {
  const u = fieldMat.uniforms;
  camera.updateMatrixWorld();
  u.uProjInv.value.copy(camera.projectionMatrixInverse);
  u.uCamWorld.value.copy(camera.matrixWorld);
  u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
  renderer.setRenderTarget(fieldRT);
  renderer.render(fieldScene, camera);
  renderer.setRenderTarget(blurRT);
  renderer.render(blurScene, camera);
  renderer.setRenderTarget(null);
}

// socle : le plateau joué s'élève au-dessus de la brume des autres mondes
// ---------------------------------------------------------------- surfaces procédurales
// Motif calculé dans le fragment shader à partir de la position monde : aucune texture à charger
// (en qualité basse, le bruit est lu dans la texture précalculée, voir noiseGLSL).
// 0 mat · 1 bois · 2 pierre · 3 glace · 4 céramique · 5 sable · 6 planche (fil droit, pour les grandes surfaces)
// 7 ardoise + craie · 8 marbre veiné d'or · 9 néon (arêtes lumineuses) · 10 paysage (herbe, roche, neige, terre)
const SURFACES = { matte: 0, wood: 1, stone: 2, ice: 3, ceramic: 4, sand: 5, plank: 6, slate: 7, marble: 8, neon: 9, landscape: 10 };
const SURFACE_GLSL = `
  uniform int uSurface;
  uniform float uSurfTime;
  uniform float uGlowAmt;
  uniform float uMistAmt;
  uniform vec3 uMistCol;
  varying vec3 vSurfP;
  varying vec3 vSurfN;
  float gPits = 0.0, gGold = 0.0;
  // distance au bord de la case (les cases sont centrées sur des demi-entiers)
  float cellEdge(vec3 p){ vec2 f = fract(p.xz); return min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)); }
  float sHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  ${noiseGLSL('sNoise', 'sHash')}
  vec3 surfaceTint(vec3 base, inout float rough){
    vec3 p = vSurfP;
    if (uSurface == 1) {                       // bois : cernes et fibres, sens du fil alterné d'un bloc à l'autre
      float h = sHash(vec3(floor(p.x + 0.5), floor(p.y / ${LEVEL.toFixed(2)}), floor(p.z + 0.5)));
      vec3 q = h > 0.5 ? p : p.zyx;
      float ring = length(vec2(q.z, q.y * 2.6) + h * 17.0) * 4.5 + sNoise(q * vec3(0.7, 3.0, 3.0)) * 1.8;
      float g = smoothstep(0.05, 0.5, abs(fract(ring) - 0.5));
      float fib = sNoise(q * vec3(1.2, 36.0, 36.0));
      base *= mix(0.8, 1.05, g) * (0.94 + 0.1 * fib);
      rough = mix(rough * 0.75, rough, g);
    } else if (uSurface == 2) {                // pierre volcanique : marbrures irrégulières, grain et petites alvéoles
      vec3 w = vec3(sNoise(p * 1.6), sNoise(p * 1.6 + 5.2), sNoise(p * 1.6 + 9.1));
      float m = sNoise(p * 3.1 + w * 1.6) * 0.6 + sNoise(p * 7.3 + w) * 0.3 + sNoise(p * 19.0) * 0.1;
      float pits = smoothstep(0.8, 0.92, sNoise(p * 27.0 + w * 2.0));
      base *= (0.8 + 0.32 * m) * (1.0 - 0.3 * pits);
      gPits = smoothstep(0.82, 0.97, sNoise(p * 4.2 + 11.0 + w * 0.8));    // foyers : pierre calcinée qui couve
      base *= 1.0 - 0.6 * gPits;
      rough = mix(rough, 1.0, pits);
    } else if (uSurface == 3) {                // glace : marbrures bleutées, poli irrégulier
      float n1 = sNoise(p * 4.5);
      base = mix(base, base * vec3(0.84, 0.93, 1.1), 0.6 * n1) * (0.95 + 0.1 * sNoise(p * 16.0));
      rough = 0.12 + 0.3 * n1;
    } else if (uSurface == 4) {                // céramique : émail satiné légèrement nuancé
      base *= 0.95 + 0.09 * sNoise(p * 2.8);
    } else if (uSurface == 6) {                // planche : fil droit et fibres, sans cernes (évite les grands arcs sur le socle)
      vec3 q = p * vec3(0.25, 9.0, 9.0);
      float grain = sNoise(q + vec3(0.0, sNoise(p * 0.6) * 3.0, 0.0)) * 0.7 + sNoise(q * vec3(2.0, 3.5, 3.5)) * 0.3;
      base *= 0.82 + 0.26 * grain;
    } else if (uSurface == 7) {                // ardoise : feuilletage fin, traces de craie et trait de craie sur le pourtour des cases
      base *= 0.9 + 0.12 * sNoise(vec3(p.x * 2.0, p.y * 45.0, p.z * 2.0)) + 0.05 * sNoise(p * 20.0);
      base = mix(base, base * 1.3 + 0.03, smoothstep(0.62, 0.9, sNoise(p * 1.4)) * 0.35);
      // trait de craie sur la partie plate du dessus seulement (pas sur les arrondis ni sur le socle)
      float flatTop = step(0.97, vSurfN.y) * uGlowAmt;
      float d = cellEdge(p);
      float line = smoothstep(0.065, 0.08, d) * smoothstep(0.115, 0.095, d) * flatTop;
      float broken = smoothstep(0.3, 0.55, sNoise(p * 7.0)) * (0.65 + 0.35 * sNoise(p * 35.0));
      base = mix(base, vec3(0.86, 0.88, 0.82), line * broken * 0.85);
      rough = 0.9;
    } else if (uSurface == 8) {                // marbre : veines sinueuses, filets d'or, poli miroir
      float t = p.x * 1.1 + p.z * 0.6 + p.y * 0.8 + (sNoise(p * 1.4) + sNoise(p * 2.9) * 0.5 + sNoise(p * 6.1) * 0.25) * 2.6;
      float vein = pow(smoothstep(0.7, 1.0, 1.0 - abs(sin(t * 1.2))), 2.0);
      float lum = dot(base, vec3(0.299, 0.587, 0.114));
      base *= 0.92 + 0.12 * sNoise(p * 2.2);                                   // nuages laiteux du marbre
      base = mix(base, lum > 0.35 ? base * 0.5 : base * 2.0 + 0.06, vein * 0.55);
      gGold = smoothstep(0.965, 1.0, 1.0 - abs(sin(t * 0.63 + 2.0))) * smoothstep(0.45, 0.6, sNoise(p * 0.7 + 3.0)) * mix(0.35, 1.0, uGlowAmt);   // plus discret sur le socle
      base = mix(base, vec3(0.83, 0.62, 0.24), gGold);
      rough = mix(0.16, 0.3, vein);
    } else if (uSurface == 9) {                // néon : surface sombre et lustrée (les arêtes s'allument dans surfaceGlow)
      base *= 0.85 + 0.15 * sNoise(p * 3.0);
      rough = 0.22;
    } else if (uSurface == 10) {               // paysage : le dessus change de matière avec l'altitude, les flancs sont en terre
      float top = step(0.5, vSurfN.y);
      float lvl = p.y / ${LEVEL.toFixed(2)} - 1.0;                         // hauteur de la case (sur le dessus)
      if (top > 0.5) {
        float grass = 1.0 - smoothstep(3.0, 4.5, lvl);
        float snow = smoothstep(6.0, 7.0, lvl);
        float rock = (1.0 - grass) * (1.0 - snow);
        // herbe : touffes plus sombres et brins fins
        float g = (0.82 + 0.2 * sNoise(p * vec3(42.0, 3.0, 42.0))) * (0.9 + 0.16 * sNoise(p * 3.2));
        // roche : grain et mouchetures
        float r = (0.85 + 0.2 * sNoise(p * 9.0)) * (0.93 + 0.1 * sNoise(p * 30.0));
        // neige : presque lisse, légèrement bleutée dans les creux
        float n = 0.96 + 0.06 * sNoise(p * 6.0);
        base *= g * grass + r * rock + n * snow;
        rough = mix(rough, 0.55, snow);
      } else {
        // flancs : terre striée et petits cailloux
        base *= 0.86 + 0.18 * sNoise(vec3(p.x * 6.0, p.y * 30.0, p.z * 6.0));
        base = mix(base, base * 1.35 + 0.02, step(0.86, sNoise(p * 14.0)) * 0.6);
      }
    } else if (uSurface == 5) {                // sable : grain fin
      base *= 0.9 + 0.13 * sNoise(p * 34.0) + 0.05 * sNoise(p * 4.0);
    }
    return base;
  }
  // lumière propre à chaque matière : reflets de la glace, alvéoles qui rougeoient, caustiques, lumière tamisée
  vec3 surfaceGlow(vec3 n, vec3 v){
    vec3 p = vSurfP;
    float top = step(0.5, vSurfN.y);
    if (uSurface == 3) {                        // glace : reflet sur les arêtes rasantes + éclats qui scintillent
      float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
      vec3 gc = floor(p * 22.0);
      float tw = step(0.992, sHash(gc)) * pow(0.5 + 0.5 * sin(uSurfTime * 2.5 + sHash(gc + 3.1) * 40.0), 4.0);
      return vec3(0.45, 0.68, 1.0) * fres * 0.28 + vec3(1.0) * tw * 1.4 * top;
    }
    if (uSurface == 2) {                        // braise : quelques foyers rougeoyants qui palpitent dans la pierre
      float pulse = 0.5 + 0.5 * sin(uSurfTime * 1.6 + sNoise(p * 1.3) * 9.0);
      return vec3(1.0, 0.2, 0.02) * gPits * gPits * (0.35 + 0.65 * pulse) * 1.3 * uGlowAmt;
    }
    if (uSurface == 5) {                        // lagon : caustiques qui ondulent sur le dessus des cases
      float cs = (0.5 + 0.5 * sin(p.x * 3.1 + sin(p.z * 2.3 + uSurfTime * 0.9) * 1.6)) * (0.5 + 0.5 * sin(p.z * 3.4 + sin(p.x * 2.1 - uSurfTime * 0.8) * 1.6));
      return vec3(0.45, 0.95, 0.9) * pow(cs, 4.0) * 0.4 * top;
    }
    if (uSurface == 10) {                       // paysage : la neige des sommets scintille doucement
      float lvl = p.y / ${LEVEL.toFixed(2)} - 1.0;
      vec3 gc = floor(p * 26.0);
      float tw = step(0.994, sHash(gc)) * pow(0.5 + 0.5 * sin(uSurfTime * 2.0 + sHash(gc + 5.0) * 40.0), 4.0);
      return vec3(1.0, 0.92, 0.85) * tw * smoothstep(6.0, 7.0, lvl) * top * 1.2 * uGlowAmt;
    }
    if (uSurface == 8) {                        // marbre : les filets d'or accrochent la lumière
      return vec3(1.0, 0.72, 0.3) * gGold * 0.35 * uGlowAmt;
    }
    if (uSurface == 9) {                        // néon : pourtour des cases et joints des couches, du cyan (bas) au magenta (haut)
      // le liseré est tracé sur la partie plate du dessus, juste à l'intérieur de l'arrondi :
      // sur l'arrondi lui-même, la normale varie et le trait n'apparaissait que sous certains angles
      float top = step(0.5, vSurfN.y);
      float d = cellEdge(p);
      float rim = smoothstep(0.05, 0.062, d) * smoothstep(0.1, 0.085, d) * step(0.9, vSurfN.y)
                + smoothstep(0.06, 0.02, d) * top * 0.5;
      float fy = fract(p.y / ${LEVEL.toFixed(2)});
      vec2 side = abs(vSurfN.x) > 0.5 ? vec2(p.z, 0.0) : vec2(p.x, 0.0);
      float joint = smoothstep(0.07, 0.02, min(fy, 1.0 - fy)) * (1.0 - top) * 0.5;
      float corner = smoothstep(0.04, 0.012, min(fract(side.x), 1.0 - fract(side.x))) * (1.0 - top);
      vec3 hue = mix(vec3(0.15, 0.95, 1.0), vec3(1.0, 0.2, 0.85), clamp(p.y / 2.7, 0.0, 1.0));
      // respiration très lente et discrète : les contours restent stables pour la lisibilité
      float pulse = 0.8 + 0.2 * sin(uSurfTime * 0.45 - length(p.xz) * 0.25);
      return hue * (rim + joint * 0.6 + corner * 0.6) * pulse * 1.0 * uGlowAmt;
    }
    if (uSurface == 4) {                        // aube : lumière tamisée qui glisse sur le plateau
      float d = smoothstep(0.5, 0.8, sNoise(vec3(p.xz * 0.45, uSurfTime * 0.12)));
      return vec3(1.0, 0.72, 0.5) * d * 0.14 * top;
    }
    return vec3(0.0);
  }
`;
const surfTime = { value: 0 };
function withSurface(material, uniforms) {
  material.onBeforeCompile = sh => {
    sh.uniforms.uSurface = uniforms.uSurface;
    sh.uniforms.uSurfTime = surfTime;
    sh.uniforms.uNoise3D = noiseUniform;
    sh.uniforms.uGlowAmt = uniforms.uGlowAmt || { value: 1 };
    sh.uniforms.uMistAmt = uniforms.uMistAmt || { value: 0 };
    sh.uniforms.uMistCol = uniforms.uMistCol || { value: new THREE.Color() };
    // motif ancré sur la position de repos de chaque bloc (aRest) : il ne glisse pas pendant l'animation d'apparition
    sh.vertexShader = 'varying vec3 vSurfP;\nvarying vec3 vSurfN;\n#ifdef USE_INSTANCING\nattribute vec3 aRest;\n#endif\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vSurfN = objectNormal;
      #ifdef USE_INSTANCING
        vSurfP = aRest + transformed;
      #else
        vSurfP = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
    sh.fragmentShader = SURFACE_GLSL + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n  float surfRough = roughness;\n  diffuseColor.rgb = surfaceTint(diffuseColor.rgb, surfRough);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = surfRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += surfaceGlow(normal, normalize(vViewPosition));')
      // pied du socle noyé dans la brume du pavage
      .replace('#include <fog_fragment>', `#include <fog_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistCol, uMistAmt * smoothstep(${(FLOOR_Y + 2.6).toFixed(2)}, ${FLOOR_Y.toFixed(2)}, vSurfP.y));`);
  };
  return material;
}
const terrainSurface = { uSurface: { value: 0 } }, plinthSurface = { uSurface: { value: 0 }, uGlowAmt: { value: 0 }, uMistAmt: { value: 0.85 }, uMistCol: { value: fieldMat.uniforms.uLow.value } };
const terrainMat = withSurface(new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, envMapIntensity: 0.2 }), terrainSurface);

const plinth = new THREE.Mesh(new RoundedBoxGeometry(11.2, -FLOOR_Y, 11.2, 4, 0.2), withSurface(new THREE.MeshStandardMaterial({ color: 0x23242f, roughness: 0.45, metalness: 0.35 }), plinthSurface));
plinth.position.y = FLOOR_Y / 2;
// bascule bruit calculé / bruit précalculé selon le niveau de qualité (recompile les matériaux concernés)
function applyNoiseMode() {
  if (Q.bakedNoise) ensureNoiseTex();
  for (const m of [fieldMat, terrainMat, plinth.material]) {
    if (Q.bakedNoise) m.defines.BAKED_NOISE = '';
    else delete m.defines.BAKED_NOISE;
    m.needsUpdate = true;
  }
}
applyNoiseMode();
plinth.receiveShadow = plinth.castShadow = true;
scene.add(plinth);

for (let o = 0; o < 2; o++) {
  // bande d'arrivée : celle du Rouge est au fond (rangée 10), celle du Bleu devant
  const strip = new THREE.Mesh(new THREE.BoxGeometry(10, 0.05, 0.18),
    new THREE.MeshStandardMaterial({ color: TEAM[o].main, emissive: TEAM[o].main, emissiveIntensity: 0.7, roughness: 0.4 }));
  strip.position.set(0, 0.02, o === 0 ? -5.32 : 5.32);
  scene.add(strip);
}

// particules : une poussière d'ambiance et un second système (étincelles, lucioles, flocons…) selon le thème.
// Tout est animé dans le vertex shader ; chaque point a une valeur aléatoire (taille, phase, vitesse).
const ambient = {};
const dotTex = (() => {
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const dc = dot.getContext('2d'), grd = dc.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  dc.fillStyle = grd; dc.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(dot);
})();
const particleMaxPx = { value: 64 }; // taille maximale d'une particule à l'écran, en pixels (selon la qualité)
// visibilité des particules (0 à 1) : en rendu à la demande, elles s'effacent avant que l'image se fige
const particleFade = { value: 1 };
function makeParticles(n, rMin, rMax, seed) {
  const rng = G.mulberry32(seed);
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
    Object.assign(sh.uniforms, u, { uTime: ambient.time, uPartFade: particleFade });
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
ambient.time = { value: 0 };
ambient.dust = makeParticles(700, 4, 44, 1234);
ambient.extra = makeParticles(260, 3, 26, 777);
// moins de particules aux niveaux de qualité inférieurs (elles se superposent en transparence)
function scaleParticles() {
  particleMaxPx.value = Q.pointPx * renderer.getPixelRatio();
  for (const sys of [ambient.dust, ambient.extra]) sys.pts.geometry.setDrawRange(0, Math.round(sys.pts.geometry.attributes.position.count * Q.particles));
}
scaleParticles();
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

function updateAmbient(t, dt) {
  fieldMat.uniforms.uTime.value = t;
  fieldMat.uniforms.uFade.value = Math.min(1, fieldMat.uniforms.uFade.value + dt * 0.5);
  ambient.time.value = t;
  gradePass.uniforms.uTime.value = t;
  surfTime.value = t;
  // lumière qui vacille (feu) pour les thèmes qui le demandent
  const fl = theme.flicker || 0;
  if (fl) {
    const k = 1 + fl * (Math.sin(t * 7.3) * 0.5 + Math.sin(t * 13.1 + 1.7) * 0.3 + Math.sin(t * 3.1) * 0.4);
    fill.intensity = 0.8 * k;
    hemi.intensity = 0.6 * (1 + (k - 1) * 0.5);
  }
}

// ---------------------------------------------------------------- matérialisation du plateau
let riseAnim = null;
function riseTerrain(h) {
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
function stepRise(dt) {
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

function dropPieces(delay0 = 0.75) {
  state.pieces.forEach((p, pi) => {
    const g = pieceObjs[pi].grp, target = g.position.y;
    const d = delay0 + (pi % 6) * 0.07 + p.o * 0.2, dur = d + 0.6;
    g.position.y = target + 7;
    tween(dur, k => {
      const e = Math.min(1, Math.max(0, (k * dur - d) / 0.6));
      g.position.y = target + 7 * (1 - e * e * (3 - 2 * e));
    }).then(() => { g.position.y = target; });
  });
}

// ================================================================ terrain
let theme = THEMES[0];
const paletteFor = mode => (theme.modes && theme.modes[mode]) || theme.terrain;
const terrainGroup = new THREE.Group();
scene.add(terrainGroup);
let terrainMesh = null, instToCell = [], heightLabels = null;

let terrainState = null;
// couleurs des couches du terrain selon le thème (même ordre d'instances que buildTerrain)
function colorTerrain() {
  if (!terrainMesh || !terrainState) return;
  const { h, mode } = terrainState, pal = paletteFor(mode);
  const c = new THREE.Color(), rng = G.mulberry32(h.reduce((a, b) => a * 31 + b, 7) >>> 0);
  let n = 0;
  for (let i = 0; i < 100; i++)
    for (let k = 0; k <= h[i]; k++) {
      if (k === h[i]) c.set(pal.top[Math.min(h[i], pal.top.length - 1)]).offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.04);
      else c.set(pal.strata[Math.min(k, pal.strata.length - 1)]).offsetHSL(0, 0, (k % 2) * 0.035 - (rng() * 0.02));
      terrainMesh.setColorAt(n++, c);
    }
  terrainMesh.instanceColor.needsUpdate = true;
}

function buildTerrain(h, mode) {
  terrainGroup.clear();
  if (terrainMesh) terrainMesh.geometry.dispose();
  terrainState = { h, mode };
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
  heightLabels.visible = showHeights;
  for (let i = 0; i < 100; i++) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: numberTexture(h[i]), transparent: true, depthWrite: false }));
    const [x, z] = cellXZ(i);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x - 0.31, topY(h[i]) + 0.012, z + 0.31);
    heightLabels.add(mesh);
  }
  terrainGroup.add(heightLabels);
}

const numTexCache = {};
function numberTexture(n) {
  if (numTexCache[n]) return numTexCache[n];
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(15,18,25,.55)';
  g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
  g.font = 'bold 38px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff'; g.fillText(String(n), 32, 35);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return (numTexCache[n] = t);
}

// ================================================================ thèmes
let pieceObjs = [];
// plafond de luminosité des repères des pièces, sous le seuil du halo du thème (voir pipMaterial)
const pipCap = { value: 0.8 };
function applyTheme(id) {
  theme = THEMES.find(t => t.id === id) || THEMES[0];
  HORIZON.set(theme.horizon);
  scene.fog.color.copy(HORIZON);
  const band = new THREE.Color(theme.band);
  HAZE_BAND.set(band.r, band.g, band.b);
  const su = skyMat.uniforms;
  su.top.value.set(theme.skyTop);
  su.gA.value.set(theme.glows[0]); su.gB.value.set(theme.glows[1]); su.gC.value.set(theme.glows[2]);
  floorMat.uniforms.base.value.set(theme.floor);
  const fu = fieldMat.uniforms;
  fu.uLow.value.set(theme.field.low); fu.uMid.value.set(theme.field.mid);
  fu.uHigh.value.set(theme.field.high); fu.uEdge.value.set(theme.field.edge);
  const fx = theme.fx || {};
  fu.uBeam.value.set(fx.beam || 0).multiplyScalar(fx.beamStrength ?? 1);
  fu.uAlley.value.set(fx.alley || 0).multiplyScalar(fx.alleyStrength ?? 1);
  fu.uCaus.value = fx.caustics || 0;
  fu.uSparkle.value = fx.sparkle || 0;
  plinth.material.color.set(theme.plinth);
  plinthSurface.uSurface.value = SURFACES[theme.plinthSurface || 'matte'];
  terrainSurface.uSurface.value = SURFACES[theme.surface || 'matte'];
  terrainMat.roughness = theme.roughness ?? 0.8;
  // post-traitement du thème
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
  const bl = pp.bloom || { strength: 0.35, radius: 0.5, threshold: 0.85 };
  bloom.enabled = bl.strength > 0 && Q.bloom;
  bloom.strength = bl.strength; bloom.radius = bl.radius ?? 0.5; bloom.threshold = bl.threshold ?? 0.85;
  configParticles(ambient.dust, theme.dust);
  configParticles(ambient.extra, theme.extra);
  terrainMat.envMapIntensity = theme.envIntensity ?? 0.2;
  fill.intensity = 0.8; hemi.intensity = 0.6;
  pipCap.value = 0.85 * (bl.threshold ?? 0.85);
  pieceObjs.forEach((o, pi) => stylePiece(o, state.pieces[pi]));
  hemi.color.set(theme.light.sky); hemi.groundColor.set(theme.light.ground);
  sun.color.set(theme.light.sun); fill.color.set(theme.light.fill);
  renderer.toneMappingExposure = theme.exposure ?? 1;
  colorTerrain();
  try { localStorage.setItem('traversal.theme', theme.id); } catch {}
}
{
  let saved = null;
  try { saved = localStorage.getItem('traversal.theme'); } catch {}
  applyTheme(saved || THEMES[0].id);
}

// finition des pièces : laque brillante par défaut, bois peint pour le thème Atelier
function finishPiece(m) {
  const f = theme.pieces || {};
  m.roughness = f.roughness ?? 0.3;
  m.clearcoat = f.clearcoat ?? 1;
  m.clearcoatRoughness = f.clearcoatRoughness ?? 0.12;
}

// ================================================================ pièces
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
// La forme dit les règles : boules d'or aux sommets du haut = Force (attaque),
// boules d'argent aux sommets de la base = Mouvement (5, 4 ou 3 points).
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
const PIP_DEFAULT = { shape: 'sphere', top: { color: '#ffd27a', metalness: 1, roughness: 0.25, emissive: '#3a2600' }, base: { color: '#e4ebf2', metalness: 0.9, roughness: 0.3 } };
// Les repères sont minuscules : s'ils dépassaient le seuil du halo lumineux (bloom), ses niveaux en basse
// résolution les étaleraient en petits carrés. Leur luminosité est donc plafonnée sous ce seuil (pipCap, réglé
// par thème), et la lueur des thèmes lumineux est dessinée à part, par un halo rond et doux.
const pipMaterial = spec => {
  const m = new THREE.MeshStandardMaterial({
    color: spec.color, metalness: spec.metalness ?? 0, roughness: spec.roughness ?? 0.5,
    emissive: spec.emissive ?? '#000000', emissiveIntensity: spec.glow ?? 1,
  });
  m.onBeforeCompile = sh => {
    sh.uniforms.uPipCap = pipCap;
    sh.fragmentShader = 'uniform float uPipCap;\n' + sh.fragmentShader.replace('#include <dithering_fragment>',
      '#include <dithering_fragment>\n\tgl_FragColor.rgb = min(gl_FragColor.rgb, vec3(uPipCap));');
  };
  m.customProgramCacheKey = () => 'pip-cap';
  return m;
};
const haloTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
// couleurs des pièces : celles du thème s'il en définit, sinon les couleurs d'équipe
const pieceColors = o => (theme.pieces?.teams || TEAM)[o];
// applique le style du thème aux repères et aux couleurs d'une pièce
function stylePiece(obj, p) {
  const st = theme.pips || PIP_DEFAULT, shape = PIP_GEO[st.shape] ? st.shape : 'sphere';
  for (const pip of obj.pips) {
    const spec = pip.role === 0 ? st.top : st.base;
    pip.mesh.geometry = PIP_GEO[shape][pip.role];
    pip.mesh.material.dispose();
    pip.mesh.material = pipMaterial(spec);
    pip.mesh.rotation.y = shape === 'octa' ? Math.PI / 4 : 0;
    // halo doux pour les repères lumineux ; le repère lui-même en masque le centre (test de profondeur)
    if (pip.halo) { pip.halo.removeFromParent(); pip.halo.material.dispose(); pip.halo = null; }
    if (spec.glow) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTex, color: spec.emissive, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
        opacity: Math.min(0.8, 0.45 + spec.glow * 0.4),
      }));
      halo.scale.setScalar(pip.role === 0 ? 0.26 : 0.17);
      halo.position.copy(pip.mesh.position);
      halo.userData.baseOpacity = halo.material.opacity;
      halo.raycast = () => {}; // le halo ne compte pas pour le survol des pièces
      obj.grp.add(halo);
      pip.halo = halo;
    }
  }
  const c = pieceColors(p.o);
  obj.body.material.color.set(c.main);
  obj.base.material.color.set(c.dark);
  finishPiece(obj.body.material);
}

const piecesGroup = new THREE.Group();
scene.add(piecesGroup);

function buildPieces(s) {
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
    const pips = [];
    for (const tip of PIECE_GEO[p.t].tips) pips.push({ role: 0, at: tip });
    for (const [x, y, z] of PIECE_GEO[p.t].feet) pips.push({ role: 1, at: [x, y + 0.008, z] });
    for (const pip of pips) {
      pip.mesh = new THREE.Mesh(PIP_GEO.sphere[pip.role], new THREE.MeshStandardMaterial());
      pip.mesh.position.set(...pip.at);
      grp.add(pip.mesh);
    }
    grp.rotation.y = p.o === 1 ? Math.PI : 0;
    grp.traverse(o => { o.userData.pi = pi; });
    piecesGroup.add(grp);
    const obj = { grp, body, base, pips };
    stylePiece(obj, p);
    return obj;
  });
  syncPieces(s);
}

function setPieceOpacity(obj, a) {
  obj.grp.traverse(o => {
    if (!o.material) return;
    const halo = o.userData.baseOpacity !== undefined; // halos : toujours transparents, opacité propre
    o.material.transparent = a < 1 || halo;
    o.material.opacity = a * (halo ? o.userData.baseOpacity : 1);
    o.material.depthWrite = a >= 1 && !halo;
  });
}

function syncPieces(s) {
  shadowDirty = true;
  s.pieces.forEach((p, pi) => {
    const o = pieceObjs[pi];
    o.grp.visible = p.st === G.ON_BOARD;
    o.grp.scale.setScalar(1);
    o.grp.rotation.set(0, p.o === 1 ? Math.PI : 0, 0);
    setPieceOpacity(o, 1);
    if (p.st === G.ON_BOARD) {
      const i = G.idx(p.x, p.y), [x, z] = cellXZ(i);
      o.grp.position.set(x, topY(s.h[i]), z);
    }
  });
}

// ================================================================ surbrillances
function tileTexture(kind) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  if (kind === 'arrow') {
    g.fillStyle = 'rgba(255,255,255,.95)';
    g.beginPath(); g.moveTo(64, 10); g.lineTo(112, 62); g.lineTo(82, 62); g.lineTo(82, 116); g.lineTo(46, 116); g.lineTo(46, 62); g.lineTo(16, 62); g.closePath(); g.fill();
  } else if (kind === 'ring') {
    g.strokeStyle = '#fff'; g.lineWidth = 9;
    g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 0.25; g.lineWidth = 22; g.stroke();
  } else {
    const grd = g.createRadialGradient(64, 64, 10, 64, 64, 80);
    grd.addColorStop(0, 'rgba(255,255,255,.25)'); grd.addColorStop(1, 'rgba(255,255,255,.6)');
    g.fillStyle = grd; rr(8, 8, 112, 112, 20); g.fill();
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 6; rr(8, 8, 112, 112, 20); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const TEX = { tile: tileTexture('tile'), arrow: tileTexture('arrow'), ring: tileTexture('ring') };
const COLORS = { move: 0x6fdcff, attack: 0xff4a4a, exit: 0xffd36b, hover: 0xffffff };
const overlayGroup = new THREE.Group();
scene.add(overlayGroup);
const tileGeo = new THREE.PlaneGeometry(0.92, 0.92);

const hoverTile = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({ map: TEX.tile, color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
hoverTile.rotation.x = -Math.PI / 2;
hoverTile.visible = false;
scene.add(hoverTile);

const selRing = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: TEX.ring, color: 0xffd36b, transparent: true, depthWrite: false }));
selRing.rotation.x = -Math.PI / 2;
selRing.visible = false;
scene.add(selRing);

// conseil du bot : pièce soulevée, chemin tracé et case d'arrivée cerclée de doré, jusqu'au coup joué
let hintMove = null;
const HINT = 0xffd36b;
const hintMark = new THREE.Group();
const hintTile = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({ map: TEX.tile, color: HINT, transparent: true, depthWrite: false }));
const hintRing = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: TEX.ring, color: HINT, transparent: true, depthWrite: false }));
hintTile.rotation.x = hintRing.rotation.x = -Math.PI / 2;
hintRing.position.y = 0.01;
hintMark.add(hintTile, hintRing);
hintMark.visible = false;
scene.add(hintMark);

let pathMesh = null;
const pathMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });

const exitHitGeo = new THREE.PlaneGeometry(1, 2);
function showOverlays(moves) {
  overlayGroup.clear();
  const arrow = matchMedia('(pointer: coarse)').matches ? 0.85 : 0.62;
  for (const m of moves) {
    const isExit = m.kind === 'exit';
    const mat = new THREE.MeshBasicMaterial({ map: isExit ? TEX.arrow : TEX.tile, color: COLORS[m.kind], transparent: true, opacity: m.kind === 'move' ? 0.8 : 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(isExit ? new THREE.PlaneGeometry(arrow, arrow) : tileGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    const [x, z] = cellXZ(m.to);
    if (isExit) {
      const o = state.pieces[m.pi].o;
      mesh.rotation.z = o === 0 ? 0 : Math.PI;
      mesh.position.set(x, 0.06, o === 0 ? -5.6 : 5.6);
      // invisible mais touchée par le rayon : toute la bande au-delà du bord, dans la colonne de la pièce
      const hit = new THREE.Mesh(exitHitGeo, mat);
      hit.visible = false;
      hit.rotation.x = -Math.PI / 2;
      hit.position.set(x, 0.06, o === 0 ? -6 : 6);
      hit.userData = { move: m, baseOpacity: mat.opacity };
      overlayGroup.add(hit);
    } else mesh.position.set(x, topY(state.h[m.to]) + 0.015, z);
    mesh.userData.move = m;
    mesh.userData.baseOpacity = mat.opacity;
    overlayGroup.add(mesh);
  }
}

function pathPoints(m) {
  const pts = m.path.map(i => { const [x, z] = cellXZ(i); return new THREE.Vector3(x, topY(state.h[i]) + 0.12, z); });
  if (m.kind === 'exit') {
    const last = pts[pts.length - 1], o = state.pieces[m.pi].o;
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

function showPath(m) {
  if (pathMesh) { scene.remove(pathMesh); pathMesh.geometry.dispose(); pathMesh = null; }
  if (!m) return;
  const pts = pathPoints(m);
  if (pts.length < 2) return;
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3), isHint = m === hintMove;
  pathMat.color.setHex(isHint ? HINT : COLORS[m.kind]);
  pathMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 12, isHint ? 0.06 : 0.035, 8, false), pathMat);
  scene.add(pathMesh);
}

// ================================================================ animations
const tweens = [];
const tween = (dur, fn) => new Promise(res => tweens.push({ t: 0, dur, fn, res }));
const easeIO = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const wait = ms => new Promise(r => setTimeout(r, ms));

function hop(obj, from, to, arc, dur) {
  return tween(dur, k => {
    const e = easeIO(k);
    obj.position.lerpVectors(from, to, e);
    obj.position.y += Math.sin(Math.PI * e) * arc;
  });
}

const particles = [];
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

async function animateMove(m, before) {
  const obj = pieceObjs[m.pi], grp = obj.grp, p = before.pieces[m.pi];
  const pos = i => { const [x, z] = cellXZ(i); return new THREE.Vector3(x, topY(before.h[i]), z); };
  const cells = m.path;
  const defender = m.kind === 'attack' ? pieceObjs[before.cell[m.to]] : null;

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
      const tb = theme.burst || {};
      burst(dPos.clone().add(new THREE.Vector3(0, 0.4, 0)), tb.color ?? 0xffe0a0, tb.count ?? 12, !tb.shards, tb.gravity ?? null, tb.speed ?? 1);
      tween(0.35, e => { defender.grp.scale.setScalar(1 - e); defender.grp.rotation.y += 0.25; }).then(() => { defender.grp.visible = false; });
      await hit;
    } else await hop(grp, a, b, arc, dur);
  }

  if (m.kind === 'exit') {
    const a = grp.position.clone();
    const b = new THREE.Vector3(a.x, 0.05, p.o === 0 ? -5.6 : 5.6);
    await hop(grp, a, b, 0.4, 0.35);
    burst(b.clone().add(new THREE.Vector3(0, 0.3, 0)), 0xffd36b, 34, true);
    floatText(b.clone().add(new THREE.Vector3(0, 0.8, 0)), '+' + G.STR[p.t], TEAM[p.o].css);
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

// rotation douce de la caméra vers un camp
// déplacement de la vue (cible et caméra ensemble) ; le centre de la vue reste au-dessus du plateau
const PAN_MAX = 4;
const clampPan = v => Math.max(-PAN_MAX, Math.min(PAN_MAX, v));
function panTo(x, z, dur = 0.45) {
  const from = controls.target.clone(), to = new THREE.Vector3(clampPan(x), from.y, clampPan(z));
  const at = from.clone(), step = new THREE.Vector3();
  return tween(dur, k => {
    step.lerpVectors(from, to, easeIO(k)).sub(at);
    at.add(step);
    controls.target.add(step);
    camera.position.add(step);
  });
}
// Fait glisser la vue du minimum nécessaire pour que ces cases soient à l'écran, hors des colonnes du HUD :
// on essaie des fractions croissantes du chemin vers leur centre et on garde la première qui suffit.
const probeCam = new THREE.PerspectiveCamera(), probe = new THREE.Vector3();
function revealCells(cells) {
  const pts = cells.map(i => { const [x, z] = cellXZ(i); return [x, topY(state.h[i]), z]; });
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
function keepPanInBounds() {
  const t = controls.target;
  panFix.set(clampPan(t.x) - t.x, 0, clampPan(t.z) - t.z);
  if (camera.position.distanceTo(t) > controls.maxDistance * 0.97) panFix.set(-t.x * 0.12, 0, -t.z * 0.12);
  if (panFix.lengthSq() < 1e-8) return;
  t.add(panFix);
  camera.position.add(panFix);
}

function turnCameraTo(side, dur = 1.1) {
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

// ================================================================ état du jeu
let state = null, history = [], selected = -1, selMoves = [], busy = false, gameToken = 0;
let showHeights = false, viewSide = 0, autoRotateView = true;
// cfg : choix du menu ; play : réglages de la partie en cours, figés à son lancement
const cfg = { mode: 'bot', side: 0, level: 'medium', terrain: 'random' };
const play = { mode: 'bot', side: 0, level: 'medium' };
const isHuman = t => play.mode === 'pvp' || (play.mode === 'bot' && t === play.side);
// bot contre bot : lecture automatique, pause, coup par coup
let paused = false, stepOnce = false, botThinking = false, hintPending = false;
// revue des coups déjà joués (bot contre bot) : viewPly = position affichée (null = en direct)
let viewPly = null, liveState = null, animating = false;
const analyses = new Map(); // analyse de chaque coup du bot, par ply
// panneau d'analyse : explication du dernier coup du bot (ou du conseil demandé) et courbe d'évaluation
let coachOn = false, coachData = null, coachLabel = '', evalHistory = [], planShown = false;
// le panneau d'analyse a été ouvert par « Conseil » : il se referme une fois le coup du joueur joué
let coachForHint = false;
// coups joués (état avant + coup), en parallèle de history, pour l'analyse de fin de partie
let movesLog = [];

// inGame : une partie a été lancée (ou restaurée) sur le monde affiché et n'a pas été abandonnée
let worldSeed = 0, worldTerrain = 'random', inGame = false, worldLabel = '';
// s : position à afficher (partie restaurée), sinon position de départ
function loadWorld(seed = randSeed(), terrain = cfg.terrain, s = null) {
  worldSeed = seed;
  worldTerrain = terrain;
  const h = s ? s.h : G.generateTerrain(terrain, seed);
  state = s || G.newGame(h);
  buildTerrain(h, terrain);
  buildPieces(state);
  riseTerrain(h);
  dropPieces();
  const terrainName = G.TERRAIN_MODES.find(m => m[0] === terrain)[1];
  worldLabel = `Monde n° ${seed.toLocaleString('fr-FR')} · ${terrainName}`;
  $('menuWorld').textContent = `Monde n° ${seed.toLocaleString('fr-FR')}`;
  $('menuTerrain').textContent = terrainName;
}

// remet les pièces au départ sur le monde affiché
function resetBoard() {
  if (state.ply === 0) return;
  state = G.newGame(state.h);
  syncPieces(state);
  dropPieces(0.1);
}

const liveNow = () => (viewPly === null ? state : liveState);
const gameActive = () => inGame && !!state && !liveNow().over;
// une partie entamée (au moins un coup joué) serait perdue
const gameAtStake = () => gameActive() && history.length > 0;

// ---------------------------------------------------------------- sauvegarde de la partie en cours
const SAVE_KEY = 'traversal.game';
function saveGame() {
  try {
    if (!gameActive()) return localStorage.removeItem(SAVE_KEY);
    const moves = movesLog.map(({ move: m }) => ({ pi: m.pi, kind: m.kind, to: m.to, special: m.special }));
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, seed: worldSeed, terrain: worldTerrain, play, moves }));
  } catch {}
}

// rejoue les coups sauvegardés sur le monde reconstruit à partir de sa graine ; false si la sauvegarde est inutilisable
function restoreGame() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
  if (!d || d.v !== 1 || !G.TERRAIN_MODES.some(m => m[0] === d.terrain) || !Array.isArray(d.moves)) return false;
  if (!['bot', 'pvp', 'bvb'].includes(d.play?.mode) || ![0, 1].includes(d.play.side) || !LEVEL_NAMES[d.play.level]) return false;
  let s = G.newGame(G.generateTerrain(d.terrain, d.seed >>> 0));
  const hist = [], log = [];
  Object.assign(play, d.play);
  for (const m of d.moves) {
    const legal = !s.over && G.allMoves(s).find(x => x.pi === m.pi && x.kind === m.kind && x.to === m.to && x.special === m.special);
    if (!legal) { try { localStorage.removeItem(SAVE_KEY); } catch {} return false; }
    hist.push(s);
    log.push({ before: s, move: legal, human: isHuman(s.turn) });
    s = G.applyMove(s, legal);
  }
  if (s.over) return false;
  Object.assign(cfg, play, { terrain: d.terrain });
  syncMenuChoices();
  loadWorld(d.seed >>> 0, d.terrain, s);
  history = hist;
  movesLog = log;
  inGame = true;
  setNames();
  setCoach(play.mode === 'bvb');
  updateControls();
  return true;
}

const LEVEL_NAMES = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile', expert: 'Expert' };
function newMatch() {
  gameToken++;
  history = [];
  movesLog = [];
  closeReview(false);
  evalHistory = [];
  coachData = null;
  paused = false;
  stepOnce = false;
  viewPly = null;
  liveState = null;
  analyses.clear();
  resetBoard();
  clearHint();
  clearSelection();
  clearPlan();
  inGame = true;
  setNames();
  setCoach(play.mode === 'bvb');
  updateControls();
}

function setNames() {
  const bot = `Bot ${LEVEL_NAMES[play.level]}`;
  $('name0').textContent = play.mode === 'bot' ? (play.side === 0 ? 'Joueur · Rouge' : `${bot} · Rouge`) : play.mode === 'bvb' ? bot : 'Rouge';
  $('name1').textContent = play.mode === 'bot' ? (play.side === 1 ? 'Joueur · Bleu' : `${bot} · Bleu`) : play.mode === 'bvb' ? bot : 'Bleu';
}

// lance une nouvelle partie sur le monde affiché, avec les réglages choisis dans le menu
function startGame() {
  Object.assign(play, { mode: cfg.mode, side: cfg.side, level: cfg.level });
  newMatch();
  saveGame();
  enterGame();
}

// quitte le menu pour la partie : HUD, caméra du côté du joueur, puis premier tour
function enterGame(delay = riseAnim ? 1900 : 900) {
  $('menu').classList.add('hidden');
  updateMenuShift();
  $('hud').classList.remove('hidden');
  layoutHud();
  controls.autoRotate = false;
  viewSide = play.mode === 'bot' ? play.side : 0;
  panTo(0, 0, 0.8);
  turnCameraTo(viewSide, 1.4);
  busy = true;
  setStatus(riseAnim ? 'Matérialisation du monde…' : 'La partie commence…', 0);
  const token = gameToken;
  wait(delay).then(() => { if (token === gameToken) nextTurn(); });
}

// ---------------------------------------------------------------- bot (Web Worker)
let worker = null, reqId = 0;
const pending = new Map();
try {
  worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => { const r = pending.get(e.data.token); pending.delete(e.data.token); r?.(e.data); };
  worker.onerror = ev => { ev.preventDefault?.(); worker = null; for (const r of pending.values()) r({ move: null }); pending.clear(); };
} catch { worker = null; }

// demande un coup au bot ; avec analyze, la réponse contient aussi info (évaluation, variante, alternatives)
function askBot(s, level = play.level, analyze = coachOn || play.mode === 'bvb') {
  return new Promise(res => {
    const fallback = () => setTimeout(() => res({ move: chooseMove(s, level === 'expert' ? 'hard' : level) }), 20);
    if (!worker) return fallback();
    const id = ++reqId;
    pending.set(id, d => (d.move || !worker ? res(d) : fallback()));
    worker.postMessage({ state: s, level, token: id, analyze });
  });
}

async function nextTurn() {
  updateHUD();
  updateControls();
  if (state.over) { busy = true; await wait(600); showGameOver(); return; }
  if (state.passed) toast(`${G.PLAYER_NAMES[1 - state.turn]} ne peut pas jouer : tour passé.`);
  if (isHuman(state.turn)) {
    busy = false;
    updateControls();
    if (play.mode === 'pvp' && autoRotateView && viewSide !== state.turn) { viewSide = state.turn; turnCameraTo(viewSide); }
    setStatus(`À ${state.turn === 0 ? 'Rouge' : 'Bleu'} de jouer — choisir une pièce`, state.turn);
    return;
  }
  if (play.mode === 'bvb' && paused && !stepOnce) {
    busy = false;
    updateControls();
    setStatus(`En pause — à ${G.PLAYER_NAMES[state.turn]} de jouer · ⏵ pour reprendre, ◀ pour revoir`, state.turn);
    return;
  }
  stepOnce = false;
  busy = true;
  botThinking = true;
  updateControls();
  setStatus(play.level === 'expert' ? 'Le bot réfléchit en profondeur…' : 'Le bot réfléchit…', state.turn, true);
  const t0 = performance.now();
  const token = gameToken, before = state;
  const { move, info } = await askBot(state);
  botThinking = false;
  if (token !== gameToken) return;
  if (info && move) {
    evalHistory = evalHistory.filter(h => h.ply < before.ply);
    coachData = explain(before, move, info);
    coachLabel = 'Coup du bot';
    analyses.set(before.ply, coachData);
    evalHistory.push({ ply: before.ply, pRed: coachData.verdict.pRed });
    renderCoach();
  }
  const elapsed = performance.now() - t0;
  const minDelay = play.mode === 'bvb' ? 1100 : 650; // laisser le temps de lire l'analyse
  if (elapsed < minDelay) await wait(minDelay - elapsed);
  if (token !== gameToken || !move) return;
  await performMove(move);
}

async function performMove(m) {
  busy = true;
  const token = gameToken;
  clearHint();
  if (coachForHint && isHuman(state.turn)) setCoach(false);
  clearSelection();
  clearPlan();
  const before = state;
  history.push(before);
  movesLog.push({ before, move: m, human: isHuman(before.turn) });
  state = G.applyMove(before, m);
  saveGame();
  setStatus(describeMove(before, m), before.turn);
  animating = true;
  updateControls();
  await animateMove(m, before);
  animating = false;
  if (token !== gameToken) return;
  syncPieces(state);
  nextTurn();
}

function describeMove(s, m) {
  const p = s.pieces[m.pi], who = G.PLAYER_NAMES[p.o], name = G.TYPE_NAMES[p.t];
  if (m.kind === 'exit') return `${who} : ${name} franchit l’arrivée ! +${G.STR[p.t]}`;
  if (m.kind === 'attack') return `${who} : ${name} capture ${G.TYPE_NAMES[s.pieces[s.cell[m.to]].t]} (${m.combat.att} ≥ ${m.combat.def})`;
  return `${who} : ${name} se déplace`;
}

function undo() {
  if (!history.length || reviewing || play.mode === 'bvb' || busy) return;
  gameToken++;
  do { state = history.pop(); } while (history.length && !isHuman(state.turn));
  if (!isHuman(state.turn)) { history.push(state); state = history.pop(); }
  movesLog.length = history.length;
  saveGame();
  evalHistory = evalHistory.filter(h => h.ply < state.ply);
  clearHint();
  clearSelection();
  syncPieces(state);
  nextTurn();
}

// ---------------------------------------------------------------- contrôles bot contre bot et conseil
const viewIndex = () => viewPly ?? history.length;
// navigation possible : bot contre bot, hors analyse de partie et hors animation d'un coup
const canNavigate = () => play.mode === 'bvb' && !reviewing && !animating && !!state;

function updateControls() {
  const bvb = play.mode === 'bvb', k = viewIndex(), n = history.length, nav = canNavigate();
  for (const id of ['btnFirst', 'btnPrev', 'btnPlay', 'btnNext', 'btnLast']) $(id).classList.toggle('hidden', !bvb);
  $('btnUndo').classList.toggle('hidden', bvb);
  $('btnHint').classList.toggle('hidden', bvb);
  const live = viewPly === null ? state : liveState;
  const showPlay = paused || viewPly !== null;
  $('btnPlay').innerHTML = showPlay ? '⏵<span> Lecture</span>' : '⏸<span> Pause</span>';
  $('btnPlay').title = showPlay ? 'Revenir au présent et reprendre la partie' : 'Mettre en pause après ce coup';
  $('btnPlay').disabled = !live || live.over;
  $('btnFirst').disabled = $('btnPrev').disabled = !nav || k === 0;
  $('btnNext').disabled = viewPly !== null ? !nav : !paused || botThinking || busy || !state || state.over;
  $('btnNext').title = viewPly !== null ? 'Coup suivant (déjà joué)' : 'Faire jouer un coup au bot';
  $('btnLast').disabled = viewPly === null;
  $('btnHint').disabled = !state || state.over || !isHuman(state.turn) || busy || hintPending || reviewing;
  if (state) $('btnUndo').disabled = !history.length;
  layoutHud();
}

// affiche la position après k coups (k = nombre de coups joués : retour au présent)
function goTo(k) {
  if (!canNavigate()) return;
  const n = history.length;
  k = Math.max(0, Math.min(n, k));
  if (viewPly === null) {
    if (k === n) return;
    // on quitte le direct : pause, et le coup en cours de calcul ou d'affichage est abandonné (il sera recalculé)
    liveState = state;
    gameToken++;
    botThinking = false;
    busy = false;
    paused = true;
  }
  if (k === n) { viewPly = null; state = liveState; } else { viewPly = k; state = history[k]; }
  showViewed();
}

function showViewed() {
  const k = viewIndex(), n = history.length;
  clearSelection();
  syncPieces(state);
  updateHUD();
  clearPlan();
  const last = k > 0 ? movesLog[k - 1] : null;
  if (last) showPlan([{ move: last.move, side: last.before.turn, color: 0xffd36b }]);
  coachData = last ? analyses.get(last.before.ply) || null : null;
  coachLabel = viewPly === null ? 'Dernier coup' : `Coup ${k} sur ${n}`;
  renderCoach();
  if (viewPly !== null) setStatus(`Revue — position après le coup ${k} sur ${n} · ◀ ▶ pour naviguer`, state.turn);
  else if (state.over) setStatus(`Partie terminée — ${state.reason}`, state.winner === 1 ? 1 : 0);
  else setStatus(`En pause — à ${G.PLAYER_NAMES[state.turn]} de jouer · ⏵ pour reprendre`, state.turn);
  updateControls();
}

$('btnFirst').onclick = () => goTo(0);
$('btnPrev').onclick = () => goTo(viewIndex() - 1);
$('btnLast').onclick = () => goTo(history.length);
$('btnNext').onclick = () => {
  if (viewPly !== null) return goTo(viewPly + 1);
  // au présent et en pause : le bot joue un coup
  if (!paused || botThinking || busy || !state || state.over) return;
  stepOnce = true;
  nextTurn();
};
$('btnPlay').onclick = () => {
  if (viewPly !== null) {
    if (!canNavigate()) return;
    viewPly = null;
    state = liveState;
    showViewed();
    if (state.over) return;
    paused = false;
    updateControls();
    return void nextTurn();
  }
  paused = !paused;
  updateControls();
  if (!paused && !botThinking && !busy && state && !state.over) nextTurn();
};

async function hint() {
  if (!state || state.over || !isHuman(state.turn) || busy || hintPending || reviewing) return;
  hintPending = true;
  clearHint();
  updateControls();
  const wasOpen = coachOn;
  setCoach(true);
  coachForHint = !wasOpen;
  $('coach').innerHTML = '<div class="coach-wait"><span class="spinner"></span> Le bot analyse la position…</div>';
  const token = gameToken, before = state;
  const { move, info } = await askBot(before, play.level === 'expert' ? 'expert' : 'hard', true);
  hintPending = false;
  updateControls();
  if (token !== gameToken || state !== before) { renderCoach(); return; }
  if (!move || !info) { $('coach').innerHTML = '<p class="muted">Analyse indisponible.</p>'; return; }
  coachData = explain(before, move, info);
  coachLabel = 'Conseil du bot';
  showHint(move);
  renderCoach();
}
$('btnHint').onclick = hint;

// ---------------------------------------------------------------- panneau d'analyse
function setCoach(on) {
  coachOn = on;
  coachForHint = false;
  $('btnCoach').classList.toggle('on', on);
  $('coach').classList.toggle('hidden', !on);
  $('legend').classList.toggle('hidden', on);
  if (!on) clearPlan();
  renderCoach();
  updateMenuShift();
}
$('btnCoach').onclick = () => setCoach(!coachOn);

function renderCoach() {
  const el = $('coach');
  if (!coachOn) return;
  if (!coachData) {
    el.innerHTML = `<div class="coach-head"><span class="tag">Analyse</span></div>
      <p class="muted">${play.mode === 'bvb' ? 'L’explication de chaque coup du bot s’affichera ici.' : 'Ici s’affiche le raisonnement du bot après chacun de ses coups. Au tour du joueur, « Conseil » montre le coup que le bot jouerait dans la position.'}</p>`;
    return;
  }
  // conseil : le coup en tête, le détail replié pour que le panneau ne masque pas le plateau
  const hint = coachLabel === 'Conseil du bot' && hintMove ? hintSentence(state, hintMove) : null;
  el.innerHTML = renderAnalysis(coachData, { label: coachLabel, history: evalHistory, hint, collapsed: !!hint || compactMQ.matches });
  updateMenuShift();
  if (hint) {
    $('coachPlayHint').onclick = () => { if (hintMove && !busy && isHuman(state.turn)) performMove(hintMove); };
  }
  const btn = $('coachPlanBtn');
  if (btn) {
    btn.classList.toggle('on', planShown);
    btn.onclick = () => { if (planShown) clearPlan(); else showPlan(planItems()); btn.classList.toggle('on', planShown); };
  }
  // survol d'une ligne : le coup correspondant est tracé sur le plateau
  el.querySelectorAll('[data-plan]').forEach(li => {
    const m = coachData.plan[+li.dataset.plan].move;
    li.onmouseenter = () => showPath(m);
    li.onmouseleave = () => showPath(null);
  });
  el.querySelectorAll('[data-alt]').forEach(li => {
    const m = coachData.alts[+li.dataset.alt].move;
    li.onmouseenter = () => showPath(m);
    li.onmouseleave = () => showPath(null);
  });
}

// coups à tracer : pour un conseil, le coup suggéré puis la suite ; sinon la suite du coup joué
const planItems = () => (coachLabel === 'Conseil du bot' ? [{ move: coachData.move, side: coachData.side }, ...coachData.plan.slice(0, 3)] : coachData.plan.slice(0, 4));

// suite prévue tracée sur le plateau : un tube par coup, de plus en plus transparent
const planGroup = new THREE.Group();
scene.add(planGroup);
function clearPlan() {
  for (const o of planGroup.children) { o.geometry.dispose(); o.material.dispose(); }
  planGroup.clear();
  planShown = false;
  $('coachPlanBtn')?.classList.remove('on');
}
function showPlan(items) {
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
    ring.position.set(x, (m.kind === 'exit' ? 0.1 : topY(state.h[m.to])) + 0.03, z);
    planGroup.add(ring);
  });
  planShown = items.length > 0;
}

// ================================================================ sélection & interaction
function showHint(m) {
  hintMove = m;
  select(m.pi);
  const [x, z] = cellXZ(m.to), o = state.pieces[m.pi].o;
  if (m.kind === 'exit') hintMark.position.set(x, 0.08, o === 0 ? -5.6 : 5.6);
  else hintMark.position.set(x, topY(state.h[m.to]) + 0.035, z);
  hintMark.visible = true;
  showPath(m);
}
function clearHint() {
  hintMove = null;
  hintMark.visible = false;
  showPath(null);
}

function select(pi) {
  clearSelection();
  selected = pi;
  selMoves = G.pieceMoves(state, pi);
  showOverlays(selMoves);
  showCard(pi);
  // au doigt et zoomé : la vue glisse juste assez pour montrer la pièce et ses cases accessibles
  if (lastPointer !== 'mouse' && camera.position.distanceTo(controls.target) < controls.maxDistance * 0.9) {
    const p = state.pieces[pi];
    revealCells([G.idx(p.x, p.y), ...selMoves.map(m => m.to)]);
  }
}
function clearSelection() {
  if (selected >= 0 && state) {
    const p = state.pieces[selected];
    if (p.st === G.ON_BOARD) pieceObjs[selected].grp.position.y = topY(state.h[G.idx(p.x, p.y)]);
  }
  selected = -1; selMoves = [];
  shadowDirty = true;
  overlayGroup.clear();
  showPath(hintMove);
  selRing.visible = false;
  hideTip();
  showCard(-1);
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hover = { move: null, pi: -1, cell: -1 };

function pick(ev) {
  pointer.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const res = { move: null, pi: -1, cell: -1 };
  const ov = raycaster.intersectObjects(overlayGroup.children, false)[0];
  const pc = raycaster.intersectObjects(piecesGroup.children, true).find(h => h.object.parent.visible);
  const tr = terrainMesh ? raycaster.intersectObject(terrainMesh, false)[0] : null;
  const dOv = ov ? ov.distance : Infinity, dPc = pc ? pc.distance : Infinity, dTr = tr ? tr.distance : Infinity;
  if (pc && dPc <= dOv + 0.3 && dPc <= dTr + 0.01) {
    res.pi = pc.object.userData.pi;
    const p = state.pieces[res.pi];
    res.cell = G.idx(p.x, p.y);
  } else if (ov && dOv <= dTr + 0.05) {
    res.move = ov.object.userData.move;
    res.cell = res.move.to;
  } else if (tr) res.cell = instToCell[tr.instanceId];
  if (!res.move && res.cell >= 0 && selected >= 0) {
    res.move = selMoves.find(m => m.to === res.cell && m.kind !== 'exit') || null;
  }
  return res;
}

// Au toucher, pas de survol : tant que le doigt est posé sur une case, son chemin s'affiche ;
// relâcher joue le coup, glisser l'annule (et tourne la vue), un second doigt aussi (zoom, déplacement).
let downAt = null, toolsWereOpen = false, lastPointer = 'mouse';
const fingers = new Set();
const isTouch = e => e.pointerType === 'touch' || e.pointerType === 'pen';
function cancelTap() {
  downAt = null;
  hideTip();
  showPath(hintMove);
}
canvas.addEventListener('pointerdown', e => {
  lastPointer = e.pointerType;
  toolsWereOpen = $('hud').classList.contains('tools-open');
  setTools(false);
  if (isTouch(e)) {
    fingers.add(e.pointerId);
    if (fingers.size > 1) return cancelTap();
  }
  downAt = [e.clientX, e.clientY];
  if (isTouch(e) && !toolsWereOpen && selected >= 0 && canPlay()) onHover(e);
});
const releaseFinger = e => fingers.delete(e.pointerId);
canvas.addEventListener('pointercancel', e => { releaseFinger(e); cancelTap(); });
canvas.addEventListener('pointerup', e => {
  releaseFinger(e);
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  downAt = null;
  if (toolsWereOpen || !canPlay()) return;
  const h = pick(e);
  if (h.move && selected >= 0) return void performMove(h.move);
  if (h.pi >= 0 && state.pieces[h.pi].o === state.turn) return void (h.pi === selected ? clearSelection() : select(h.pi));
  clearSelection();
});
const canPlay = () => !!state && !busy && !reviewing && !state.over && isHuman(state.turn);
let pendingMove = null;
canvas.addEventListener('pointermove', e => {
  if (isTouch(e)) {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) cancelTap();
    return;
  }
  if (!pendingMove) requestAnimationFrame(() => { const ev = pendingMove; pendingMove = null; onHover(ev); });
  pendingMove = e;
});
function onHover(e) {
  if (!state || $('hud').classList.contains('hidden')) return;
  const h = pick(e);
  hover = h;
  // pièce survolée
  pieceObjs.forEach((o, pi) => o.body.material.emissive.setHex(pi === h.pi && pi !== selected ? 0x2a2a2a : 0x000000));
  canvas.style.cursor = (h.move || (h.pi >= 0 && state.pieces[h.pi].o === state.turn && isHuman(state.turn))) && !busy ? 'pointer' : 'default';
  // case survolée
  if (h.cell >= 0 && !busy) {
    const [x, z] = cellXZ(h.cell);
    hoverTile.position.set(x, topY(state.h[h.cell]) + 0.02, z);
    hoverTile.visible = true;
  } else hoverTile.visible = false;
  // chemin et infobulle
  overlayGroup.children.forEach(o => { o.material.opacity = o.userData.move === h.move ? 1 : o.userData.baseOpacity; });
  showPath(h.move || hintMove);
  if (h.move) showMoveTip(h.move, e);
  else if (h.cell >= 0 && showHeights) showTip(`Hauteur <b>${state.h[h.cell]}</b>`, e);
  else hideTip();
  if (selected < 0) showCard(h.pi);
}

// ================================================================ HUD
// Barre d'outils : sur la ligne du tableau des scores (avec libellés, sinon en icônes) si elle tient à sa droite
// sans le toucher, sinon en bas au centre ; sur téléphone, repliée derrière son bouton (placement par la feuille de style).
// Les panneaux d'analyse se placent sous ce qui occupe le haut.
function layoutHud() {
  const hud = $('hud');
  if (hud.classList.contains('hidden')) return;
  const tb = $('toolbar'), sb = $('scoreboard').getBoundingClientRect(), css = document.documentElement.style;
  if (compactMQ.matches) {
    hud.dataset.tb = 'compact';
    css.setProperty('--panel-top', `${Math.round(sb.bottom + 10)}px`);
    css.setProperty('--panel-gap', '80px');
    return;
  }
  let mode = 'bottom';
  for (const m of ['full', 'icons']) {
    hud.dataset.tb = m;
    if (innerWidth - 16 - tb.offsetWidth >= sb.right + 16) { mode = m; break; }
  }
  hud.dataset.tb = mode;
  // les panneaux d'analyse commencent sous le tableau des scores et la barre d'outils
  let below = sb.bottom;
  if (mode === 'bottom') {
    css.setProperty('--panel-gap', '140px');
  } else {
    const top = sb.top + (sb.height - tb.offsetHeight) / 2; // centrée verticalement sur le tableau des scores
    css.setProperty('--tb-top', `${Math.round(top)}px`);
    css.setProperty('--panel-gap', '80px');
    below = Math.max(below, top + tb.offsetHeight);
  }
  css.setProperty('--panel-top', `${Math.round(below + 10)}px`);
}
document.fonts?.ready.then(layoutHud);

// téléphones : la barre d'outils s'ouvre en liste depuis son bouton et se referme après un choix
function setTools(open) {
  $('hud').classList.toggle('tools-open', open);
  $('btnTools').setAttribute('aria-expanded', open);
}
$('btnTools').onclick = () => setTools(!$('hud').classList.contains('tools-open'));
// les commandes de lecture (⏮ ◀ ⏸ ▶ ⏭) laissent la liste ouverte pour enchaîner les appuis
const KEEP_TOOLS = ['btnFirst', 'btnPrev', 'btnPlay', 'btnNext', 'btnLast'];
$('toolbar').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !KEEP_TOOLS.includes(b.id)) setTools(false); });
compactMQ.addEventListener?.('change', () => { setTools(false); layoutHud(); renderCoach(); updateMenuShift(false); });

// plein écran : bouton dans la barre d'outils, et automatique au lancement d'une partie sur téléphone.
// L'iPhone n'autorise pas une page en plein écran : seul l'ajout à l'écran d'accueil masque la barre d'adresse.
const root = document.documentElement;
const canFullscreen = !!(root.requestFullscreen || root.webkitRequestFullscreen);
const installed = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function enterFullscreen() {
  const req = root.requestFullscreen || root.webkitRequestFullscreen;
  try { Promise.resolve(req.call(root, { navigationUI: 'hide' })).catch(() => {}); } catch {}
}
function toggleFullscreen() {
  if (isFullscreen()) return void (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  if (canFullscreen) return enterFullscreen();
  toast('Pour jouer en plein écran : bouton Partager, puis « Sur l’écran d’accueil »');
}
function autoFullscreen() { if (compactMQ.matches && canFullscreen && !installed && !isFullscreen()) enterFullscreen(); }
$('btnFull').classList.toggle('hidden', installed);
$('btnFull').onclick = toggleFullscreen;
for (const ev of ['fullscreenchange', 'webkitfullscreenchange'])
  document.addEventListener(ev, () => { $('btnFull').classList.toggle('on', isFullscreen()); layoutHud(); });

// portrait sur téléphone : invitation à passer en paysage ; une fois écartée, elle ne revient plus
try { if (localStorage.getItem('traversal.rotateOk')) $('rotateHint').classList.add('dismissed'); } catch {}
$('btnRotateOk').onclick = () => {
  $('rotateHint').classList.add('dismissed');
  try { localStorage.setItem('traversal.rotateOk', '1'); } catch {}
};
if (window.ResizeObserver) {
  const ro = new ResizeObserver(() => layoutHud());
  ro.observe(document.documentElement);
  ro.observe($('scoreboard'));
}

function setStatus(text, side, thinking = false) {
  $('statusText').textContent = text;
  $('statusDot').style.background = TEAM[side].css;
  $('statusDot').className = thinking ? 'spinner' : 'dot';
  if (thinking) $('statusDot').style.background = 'transparent';
}

function updateHUD() {
  $('score0').textContent = state.score[0];
  $('score1').textContent = state.score[1];
  $('ply').textContent = state.ply;
  $('crossed').textContent = state.crossed;
  for (let o = 0; o < 2; o++) {
    $('side' + o).classList.toggle('active', !state.over && state.turn === o);
    $('lost' + o).textContent = state.pieces.filter(p => p.o === o && p.st === G.CAPTURED).map(p => G.TYPE_GLYPHS[p.t]).join('') || '—';
  }
  $('btnUndo').disabled = !history.length;
}

function showCard(pi) {
  const card = $('card');
  if (pi < 0) { card.classList.add('hidden-soft'); return; }
  const p = state.pieces[pi];
  card.innerHTML = `
    <div class="head"><span class="glyph" style="color:${TEAM[p.o].css}">${G.TYPE_GLYPHS[p.t]}</span>
      <div><div class="title">${G.TYPE_NAMES[p.t]}</div><div class="owner">${G.PLAYER_NAMES[p.o]} · hauteur ${state.h[G.idx(p.x, p.y)]}</div></div></div>
    <div class="stats"><div class="stat"><b>${G.MOVE[p.t]}</b><span><i style="background:${(theme.pips || PIP_DEFAULT).base.color}"></i>Mouvement</span></div><div class="stat"><b>${G.STR[p.t]}</b><span><i style="background:${(theme.pips || PIP_DEFAULT).top.color}"></i>Force</span></div></div>
    <p>${G.TYPE_DESC[p.t]}</p>`;
  card.classList.remove('hidden-soft');
}

// au doigt, pas d'infobulle : le chemin tracé sous le doigt suffit
function showTip(html, e) {
  if (isTouch(e)) return hideTip();
  const tip = $('tip');
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(e.clientX, innerWidth - w - 24) + 'px';
  tip.style.top = Math.min(e.clientY, innerHeight - h - 24) + 'px';
}
function hideTip() { $('tip').classList.add('hidden'); }

function showMoveTip(m, e) {
  const p = state.pieces[m.pi];
  const sp = m.special === 'diag' ? 'Pas en diagonale' : m.special === 'jump' ? 'Bond de 2 cases' : null;
  if (m.kind === 'move') return showTip(`${sp || `Coût : <b>${m.cost}</b> / ${G.MOVE[p.t]}`}`, e);
  if (m.kind === 'exit') return showTip(`<b style="color:#ffd36b">Franchir l’arrivée</b><br>+${G.STR[p.t]} point${G.STR[p.t] > 1 ? 's' : ''}${p.t === G.SENTINEL && state.crossed === 0 ? '<br><b>Victoire immédiate !</b>' : ''}`, e);
  const c = m.combat, d = state.pieces[c.defender];
  const sign = n => (n > 0 ? '+' + n : String(n));
  const rows = [[`${G.TYPE_NAMES[p.t]}`, c.base]];
  if (c.height) rows.push([c.height > 0 ? 'Avantage de hauteur' : 'Attaque en montée', sign(c.height)]);
  if (c.vb) rows.push(['Charge de l’Avant-garde', '+1']);
  if (c.allies) rows.push(['Alliés adjacents', '+' + c.allies]);
  const drows = [[G.TYPE_NAMES[d.t], c.dBase]];
  if (c.reinf) drows.push(['Renforts', '+' + c.reinf]);
  const tbl = r => `<table>${r.map(([a, b]) => `<tr><td>${a}</td><td class="n">${b}</td></tr>`).join('')}</table>`;
  showTip(`${sp ? `<i>${sp}</i><br>` : ''}<b style="color:${TEAM[p.o].css}">Attaque ${c.att}</b>${tbl(rows)}<b style="color:${TEAM[d.o].css}">Défense ${c.def}</b>${tbl(drows)}<span class="ok">Capture ✓</span>`, e);
}

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

function showGameOver() {
  if (reviewing || viewPly !== null) return;
  const w = state.winner;
  let title;
  if (w === 2) title = 'Match nul';
  else if (play.mode === 'bot') title = w === play.side ? 'Victoire' : 'Défaite';
  else title = `${G.PLAYER_NAMES[w]} l’emporte`;
  $('overTitle').textContent = title;
  // couleur d'ambiance : le gagnant (or pour un nul, gris pour une défaite contre le bot)
  const lostVsBot = play.mode === 'bot' && w !== 2 && w !== play.side;
  $('overCard').style.setProperty('--win', w === 2 ? '#f2c46d' : lostVsBot ? '#9aa1b2' : TEAM[w].css);
  $('overReason').textContent = state.reason + '.';
  const glyphs = (o, st) => state.pieces.filter(p => p.o === o && p.st === st).map(p => G.TYPE_GLYPHS[p.t]).join('');
  for (let o = 0; o < 2; o++) {
    $('overS' + o).textContent = state.score[o];
    $('overName' + o).textContent = $('name' + o).textContent;
    const arrived = glyphs(o, G.SCORED), lost = glyphs(o, G.CAPTURED);
    $('overLine' + o).innerHTML = [arrived && `Arrivée <b>${arrived}</b>`, lost ? `Pertes <b>${lost}</b>` : 'Aucune perte'].filter(Boolean).join(' · ');
    $('overTeam' + o).classList.toggle('win', w === o);
    $('overTeam' + o).classList.toggle('lose', w !== 2 && w !== o);
  }
  const caps = movesLog.filter(x => x.move.kind === 'attack').length;
  $('overStats').textContent = `${state.ply} coups · ${caps} capture${caps > 1 ? 's' : ''} · ${worldLabel}`;
  $('btnReview').classList.toggle('hidden', !movesLog.some(x => x.human));
  $('over').classList.remove('hidden');
  setStatus(title, w === 2 ? 0 : w);
}

// ================================================================ analyse de fin de partie
let reviewing = false, reviewToken = 0, reviewItems = [], reviewSel = -1, finalState = null, reviewError = false;

async function startReview() {
  if (reviewing) return;
  const token = ++reviewToken;
  reviewing = true;
  finalState = state;
  const humans = movesLog.filter(x => x.human);
  reviewItems = humans.map(() => null);
  reviewSel = -1;
  reviewError = false;
  $('over').classList.add('hidden');
  setCoach(false);
  $('legend').classList.add('hidden');
  $('review').classList.remove('hidden');
  updateMenuShift();
  renderReview();
  const think = s => askBot(s, 'review', true);
  for (let k = 0; k < humans.length; k++) {
    const r = await reviewMove(think, humans[k].before, humans[k].move);
    if (token !== reviewToken) return;
    if (!r) { reviewError = true; renderReview(); return; } // moteur WebAssembly indisponible : pas d'analyse
    reviewItems[k] = r;
    renderReview();
  }
}

function renderReview() {
  const done = reviewItems.filter(Boolean).length, total = reviewItems.length;
  const names = play.mode === 'bot' ? ['Rouge', 'Bleu'].map((n, o) => (o === play.side ? `Joueur (${n})` : `Bot (${n})`)) : ['Rouge', 'Bleu'];
  const sides = play.mode === 'bot' ? [play.side] : [0, 1];
  const r = reviewSel >= 0 ? reviewItems[reviewSel] : null;
  $('review').innerHTML = `
    <div class="rv-head"><b>Analyse de la partie</b><button class="mini" id="rvClose">Fermer</button></div>
    ${reviewError ? '<p class="muted">Analyse indisponible : le moteur du bot n’a pas pu être chargé.</p>' : done < total ? `<div class="rv-progress"><i style="width:${(done / total) * 100}%"></i><span>Analyse des coups ${done} / ${total}…</span></div>` : ''}
    ${renderSummary(reviewItems, sides, names)}
    ${renderGraph(reviewItems, finalState.ply)}
    ${r ? renderDetail(r) : '<p class="muted">Un clic sur un coup affiche la position, le coup joué <span class="key played"></span> et le meilleur coup <span class="key best"></span>.</p>'}
    ${renderList(reviewItems, reviewSel)}`;
  $('rvClose').onclick = () => closeReview(true);
  $('review').querySelectorAll('.rv-list li[data-i]').forEach(li => { li.onclick = () => selectReview(+li.dataset.i); });
  $('review').querySelectorAll('.rv-graph circle[data-ply]').forEach(c => {
    c.onclick = () => selectReview(reviewItems.findIndex(x => x && x.ply === +c.dataset.ply));
  });
}

function selectReview(i) {
  const r = reviewItems[i];
  if (!r) return;
  reviewSel = i;
  state = r.before;
  syncPieces(state);
  updateHUD();
  clearPlan();
  showPlan(r.isBest ? [{ move: r.move, side: r.side, color: 0x7fe39a }] : [{ move: r.best, side: r.side, color: 0x7fe39a }, { move: r.move, side: r.side, color: 0xf0955a }]);
  setStatus(`Position avant le coup ${r.ply + 1} — à ${G.PLAYER_NAMES[r.side]} de jouer`, r.side);
  updateControls();
  renderReview();
  $('review').querySelector('.rv-list li.sel')?.scrollIntoView({ block: 'nearest' });
}

function closeReview(showOver) {
  if (!reviewing) return;
  reviewToken++;
  reviewing = false;
  $('review').classList.add('hidden');
  $('legend').classList.remove('hidden');
  updateMenuShift();
  clearPlan();
  if (finalState) { state = finalState; syncPieces(state); updateHUD(); updateControls(); }
  if (showOver) showGameOver();
}
$('btnReview').onclick = startReview;

// ================================================================ menus
const terrainSeg = $('terrainSeg');
terrainSeg.innerHTML = G.TERRAIN_MODES.map(([v, l]) => `<button data-v="${v}" class="${v === cfg.terrain ? 'sel' : ''}">${l}</button>`).join('');
// sélecteur de thème : une pastille par thème — anneau extérieur = décor (ciel, brume, lueur),
// disque central = plateau (relief bas → haut). Le nom s'affiche au survol et pour le thème choisi.
$('themeSeg').innerHTML = THEMES.map(t => {
  const ring = `conic-gradient(from 200deg, ${t.skyTop}, ${t.field.mid}, ${t.glows[2]}, ${t.field.high}, ${t.skyTop})`;
  const core = `linear-gradient(135deg, ${t.terrain.top[1]}, ${t.terrain.top[4]} 55%, ${t.terrain.top[7]})`;
  return `<button data-v="${t.id}" title="${t.name}" aria-label="Thème ${t.name}" class="${t.id === theme.id ? 'sel' : ''}" style="background:${ring}"><i style="background:${core}"></i></button>`;
}).join('');
const showThemeName = id => { $('themeName').textContent = 'Thème ' + (THEMES.find(t => t.id === id) || theme).name; };
showThemeName(theme.id);
$('themeSeg').querySelectorAll('button').forEach(b => {
  b.addEventListener('mouseenter', () => showThemeName(b.dataset.v));
  b.addEventListener('mouseleave', () => showThemeName(theme.id));
});
const showModeOptions = () => {
  document.querySelectorAll('.bot-only').forEach(el => el.classList.toggle('hidden', cfg.mode !== 'bot'));
  document.querySelectorAll('.bots-only').forEach(el => el.classList.toggle('hidden', cfg.mode === 'pvp'));
};
// reflète cfg dans les sélecteurs du menu (après restauration d'une partie)
function syncMenuChoices() {
  document.querySelectorAll('.seg[data-key]').forEach(seg => {
    const key = seg.dataset.key;
    if (key in cfg) seg.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x.dataset.v === String(cfg[key])));
  });
  showModeOptions();
}
document.querySelectorAll('.seg').forEach(seg => {
  seg.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const key = seg.dataset.key;
    // changer de terrain tire un nouveau monde ; mode, couleur et niveau sont figés pendant la partie :
    // dans les deux cas, la partie en cours serait perdue
    if ((key === 'terrain' || seg.classList.contains('locked')) && (b.classList.contains('sel') || !(await confirmAbandon()))) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
    cfg[key] = key === 'side' ? Number(b.dataset.v) : b.dataset.v;
    if (key === 'mode') showModeOptions();
    if (key === 'terrain') previewTerrain();
    if (key === 'theme') { applyTheme(b.dataset.v); showThemeName(theme.id); }
  });
});

function previewTerrain() {
  gameToken++;
  loadWorld();
}

// avant une action qui remplace la partie entamée : confirmation, puis abandon de la partie
let confirmResolve = null;
function confirmAbandon() {
  if (!gameAtStake()) {
    if (inGame) abandonGame();
    return Promise.resolve(true);
  }
  $('confirm').classList.remove('hidden');
  $('btnConfirmCancel').focus();
  return new Promise(res => { confirmResolve = res; });
}
function closeConfirm(ok) {
  $('confirm').classList.add('hidden');
  if (ok) abandonGame();
  confirmResolve?.(ok);
  confirmResolve = null;
}
$('btnConfirmOk').onclick = () => closeConfirm(true);
$('btnConfirmCancel').onclick = () => closeConfirm(false);

function abandonGame() {
  gameToken++;
  if (viewPly !== null) { state = liveState; viewPly = null; }
  closeReview(false);
  inGame = false;
  busy = false;
  paused = false;
  history = [];
  movesLog = [];
  saveGame();
  clearHint();
  clearSelection();
  clearPlan();
  setTools(false);
  $('hud').classList.add('hidden');
  controls.autoRotate = true;
  updateMenuButtons();
}

// partie en cours : « Reprendre » devient l'action principale, « Jouer » propose une nouvelle partie,
// et les réglages de la partie (mode, couleur, niveau) sont figés
const LOCKED_KEYS = ['mode', 'side', 'level'];
function updateMenuButtons() {
  const active = gameActive();
  LOCKED_KEYS.forEach(k => {
    const seg = document.querySelector(`.seg[data-key="${k}"]`);
    seg.classList.toggle('locked', active);
    seg.title = active ? 'Réglage de la partie en cours' : '';
  });
  $('btnResume').classList.toggle('hidden', !active);
  $('btnStart').classList.toggle('primary', !active);
  $('btnStart').classList.toggle('play', !active);
  $('btnStart').classList.toggle('ghost', active);
  $('btnStart').innerHTML = active ? 'Nouvelle partie' : 'Jouer <span aria-hidden="true">→</span>';
}

function openMenu() {
  panTo(0, 0, 0.8);
  updateMenuButtons();
  $('menu').classList.remove('hidden');
  updateMenuShift();
}

// Sur grand écran, la vue 3D glisse pour rester dégagée : vers la droite à côté du menu,
// vers la gauche quand un panneau d'analyse occupe la droite.
let viewShift = 0, shiftTween = 0;
function applyViewShift(px) {
  viewShift = px;
  if (Math.abs(px) < 0.5) camera.clearViewOffset();
  else camera.setViewOffset(innerWidth, innerHeight, -px, 0, innerWidth, innerHeight);
}
function menuShiftTarget() {
  if (innerWidth < 900 || compactMQ.matches) return 0;
  if (!$('menu').classList.contains('hidden')) return Math.round($('menuPanel').getBoundingClientRect().right / 2);
  if ($('hud').classList.contains('hidden')) return 0;
  const panel = [$('coach'), $('review')].find(el => !el.classList.contains('hidden'));
  if (!panel || panel.offsetHeight < innerHeight * 0.4) return 0; // un panneau court ne couvre que le fond du plateau
  // juste assez pour dégager le plateau du panneau, sans le faire sortir à gauche
  const half = boardHalfWidthPx(), free = panel.getBoundingClientRect().left - 12;
  const need = innerWidth / 2 + half - free, room = innerWidth / 2 - half - 12;
  return -Math.round(Math.max(0, Math.min(need, room)));
}
// demi-largeur à l'écran du socle, vue non décalée
const boardCorner = new THREE.Vector3();
function boardHalfWidthPx() {
  const cam = camera.clone();
  cam.clearViewOffset();
  let half = 0;
  for (const x of [-5.6, 5.6]) for (const z of [-5.6, 5.6]) for (const y of [0, 3]) {
    boardCorner.set(x, y, z).project(cam);
    half = Math.max(half, Math.abs(boardCorner.x) * innerWidth / 2);
  }
  return half;
}
function updateMenuShift(animated = true) {
  const from = viewShift, to = menuShiftTarget(), id = ++shiftTween;
  if (!animated || from === to) return applyViewShift(to);
  tween(0.8, k => { if (id === shiftTween) applyViewShift(from + (to - from) * easeIO(k)); });
}

$('btnStart').onclick = async () => {
  autoFullscreen(); // avant toute attente : le navigateur n'accepte le plein écran que pendant le geste
  if (await confirmAbandon()) startGame();
};
$('btnCustomize').onclick = () => {
  const open = $('worldCard').classList.toggle('open');
  $('btnCustomize').setAttribute('aria-expanded', open);
  $('btnCustomize').textContent = open ? 'Fermer' : 'Personnaliser';
};
$('btnReroll').onclick = async () => { if (await confirmAbandon()) previewTerrain(); };
function showQualityChoice() {
  document.querySelectorAll('#qualitySeg button').forEach(b => b.classList.toggle('sel', b.dataset.v === qualityPref));
  $('qualityAuto').textContent = qualityPref === 'auto' ? `Auto · ${Q.name}` : 'Auto';
}
$('qualitySeg').onclick = e => { const b = e.target.closest('button'); if (b) setQualityPref(b.dataset.v); };
showQualityChoice();
$('btnResume').onclick = () => {
  autoFullscreen();
  // partie restaurée au chargement : on y entre ; sinon on referme simplement le menu
  if ($('hud').classList.contains('hidden')) return enterGame(600);
  $('menu').classList.add('hidden');
  updateMenuShift();
};
$('btnMenu').onclick = openMenu;
$('btnMenuRules').onclick = $('btnRules').onclick = () => $('rules').classList.remove('hidden');
$('btnCloseRules').onclick = () => $('rules').classList.add('hidden');
$('btnUndo').onclick = undo;
$('btnView').onclick = () => { viewSide = 1 - viewSide; turnCameraTo(viewSide); };
$('btnHeights').onclick = () => {
  showHeights = !showHeights;
  $('btnHeights').classList.toggle('on', showHeights);
  if (heightLabels) heightLabels.visible = showHeights;
};
$('btnAgain').onclick = () => { $('over').classList.add('hidden'); previewTerrain(); startGame(); };
// retour au menu après la partie : le même monde, pièces au départ, prêt pour une revanche
$('btnOverMenu').onclick = () => { $('over').classList.add('hidden'); abandonGame(); resetBoard(); openMenu(); };
$('btnOverBoard').onclick = () => $('over').classList.add('hidden');
addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('confirm').classList.contains('hidden')) return closeConfirm(false);
    clearSelection();
    $('rules').classList.add('hidden');
  }
  if (play.mode === 'bvb' && !$('hud').classList.contains('hidden') && $('menu').classList.contains('hidden')) {
    if (e.key === 'ArrowLeft') goTo(viewIndex() - 1);
    if (e.key === 'ArrowRight') $('btnNext').click();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') undo();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  sizeGrade();
  sizeFieldRT();
  fitCamera();
  layoutHud();
  updateMenuShift(false);
});

// ================================================================ boucle
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;
if (!restoreGame()) previewTerrain();
updateMenuButtons();
updateMenuShift(false);

// ---------------------------------------------------------------- changement de niveau de qualité
function applyQuality(level) {
  const prev = Q;
  wake(1000);
  qualityLevel = level;
  Q = QUALITY[level];
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) { rt.samples = Q.msaa; rt.dispose(); }
  composer.setSize(innerWidth, innerHeight);
  sizeGrade();
  sizeFieldRT();
  if (prev.steps !== Q.steps || prev.octave2 !== Q.octave2) {
    fieldMat.defines.FIELD_STEPS = Q.steps;
    fieldMat.defines.FIELD_OCTAVE2 = Q.octave2;
    fieldMat.needsUpdate = true;
  }
  if (prev.bakedNoise !== Q.bakedNoise) applyNoiseMode();
  if (prev.shadow !== Q.shadow || prev.soft !== Q.soft) {
    sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    renderer.shadowMap.type = Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    shadowDirty = true;
  }
  bloom.enabled = Q.bloom && ((theme.post && theme.post.bloom) || { strength: 0.35 }).strength > 0;
  scaleParticles();
  fieldFrame = 0;
  showQualityChoice();
}
function setQualityPref(pref) {
  qualityPref = pref;
  try { localStorage.setItem('traversal.quality', pref); } catch {}
  const level = pref === 'auto' ? autoStartLevel() : pref;
  autoQ.until = performance.now() + 3000;
  applyQuality(level);
}

// Réglage automatique : si l'image tourne sous 45 images/s sur deux fenêtres de 2 s d'affilée, un cran de moins.
// Les premières secondes (compilation des shaders) et les onglets en arrière-plan sont ignorés.
const autoQ = { frames: 0, time: 0, until: performance.now() + 4000 };
function autoQuality(rawDt) {
  if (qualityPref !== 'auto' || qualityLevel === 'low' || document.hidden) return;
  const now = performance.now();
  if (now < autoQ.until || rawDt > 1) { autoQ.frames = 0; autoQ.time = 0; return; } // vrai blocage (onglet repris…) : on recommence
  autoQ.frames++;
  autoQ.time += rawDt;
  if (autoQ.time < 2) return;
  const fps = autoQ.frames / autoQ.time;
  autoQ.frames = 0;
  autoQ.time = 0;
  autoQ.bad = fps < 45 ? (autoQ.bad || 0) + 1 : 0;
  if (autoQ.bad >= 2) { // deux fenêtres lentes d'affilée
    autoQ.bad = 0;
    applyQuality(LEVELS_ORDER[LEVELS_ORDER.indexOf(qualityLevel) + 1]);
    autoQ.until = now + 2500;
    if (!$('hud').classList.contains('hidden')) toast(`Qualité graphique ajustée : ${Q.name}`);
  }
}

// le pavage (flou, lent) n'est recalculé qu'une image sur fieldEvery, sauf quand la caméra bouge
let fieldFrame = 0;
const lastView = new THREE.Matrix4(), lastProj = new THREE.Matrix4();
function fieldNeedsRender() {
  camera.updateMatrixWorld();
  const moved = !lastView.equals(camera.matrixWorld) || !lastProj.equals(camera.projectionMatrix);
  if (moved) { lastView.copy(camera.matrixWorld); lastProj.copy(camera.projectionMatrix); }
  return moved || fieldFrame++ % Q.fieldEvery === 0;
}

// Rendu à la demande (niveaux sans « live ») : une image n'est recalculée que si quelque chose bouge
// (animation, caméra, pièce sélectionnée…) ou juste après une action ; sinon l'image affichée reste valable.
// Le temps des animations (animT) n'avance que sur les images rendues : rien ne saute à la reprise.
// Les particules, qui sinon resteraient figées en l'air, s'effacent doucement avant l'arrêt et reviennent à la reprise.
let wakeUntil = performance.now() + 2000, animT = 0;
function wake(ms = 400) { wakeUntil = Math.max(wakeUntil, performance.now() + ms); }
for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'resize', 'fullscreenchange'])
  addEventListener(ev, () => wake(), { capture: true, passive: true });
document.addEventListener('visibilitychange', () => wake());

const clock = new THREE.Clock();
let frameNo = 0;
renderer.setAnimationLoop(() => {
  const rawDt = clock.getDelta();
  const moving = tweens.length || particles.length || riseAnim || shadowDirty || selected >= 0 || hintMark.visible
    || controls.autoRotate || fieldMat.uniforms.uFade.value < 1;
  if (moving) wake(200);
  const awake = Q.live || performance.now() <= wakeUntil;
  if (!awake && particleFade.value <= 0) {
    if (controls.update()) wake(200); // l'inertie de la caméra relance le rendu
    return;
  }
  frameNo++;
  autoQuality(rawDt);
  const dt = Math.min(rawDt, 0.05), t = (animT += dt);
  particleFade.value = awake ? Math.min(1, particleFade.value + dt / 0.5) : Math.max(0, particleFade.value - dt / 0.8);
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    tw.fn(k);
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i], u = p.userData;
    u.life += dt;
    u.v.y -= (u.g ?? (u.spark ? 1.2 : 9)) * dt;
    p.position.addScaledVector(u.v, dt);
    p.rotation.x += dt * 6; p.rotation.y += dt * 4;
    p.material.opacity = Math.max(0, 1 - u.life / u.max);
    if (u.life >= u.max) { scene.remove(p); p.material.dispose(); particles.splice(i, 1); }
  }
  if (selected >= 0 && state && !busy) {
    const g = pieceObjs[selected].grp, p = state.pieces[selected], i = G.idx(p.x, p.y);
    g.position.y = topY(state.h[i]) + 0.1 + Math.sin(t * 4) * 0.05;
    selRing.position.set(g.position.x, topY(state.h[i]) + 0.025, g.position.z);
    selRing.scale.setScalar(1 + Math.sin(t * 4) * 0.05);
    selRing.visible = true;
  } else if (selRing.visible) selRing.visible = false;
  if (hintMark.visible) {
    const k = Math.sin(t * 3.5);
    hintRing.scale.setScalar(1 + 0.12 * k);
    hintRing.material.opacity = 0.75 + 0.25 * k;
    hintTile.material.opacity = 0.6 + 0.25 * k;
  }
  // pulsation des cibles d'attaque
  for (const o of overlayGroup.children)
    if (o.userData.move.kind !== 'move' && o.userData.move !== hover.move) o.material.opacity = 0.6 + 0.3 * Math.sin(t * 5);
  updateAmbient(t, dt);
  // ombres recalculées à la demande ; la pièce sélectionnée qui flotte n'impose pas un recalcul à chaque image
  if (tweens.length || riseAnim || shadowDirty || (selected >= 0 && frameNo % Q.shadowEvery === 0)) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
  stepRise(dt);
  keepPanInBounds();
  if (controls.update()) wake(200);
  if (fieldNeedsRender()) renderField();
  if (Q.post) composer.render();
  else renderer.render(scene, camera);
});
