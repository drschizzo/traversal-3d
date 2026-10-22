// Blocs GLSL partagés, inclus dans les shaders par #include <trv_…> (mécanisme ShaderChunk de Three.js)
import * as THREE from 'three';

// côté de la texture 3D du bruit précalculé (qualité basse, voir background.js)
export const NOISE_N = 128;

// bruit de valeur lissé : calculé (hachage `hash`, défini avant l'inclusion) ou lu dans la texture si BAKED_NOISE est défini
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

Object.assign(THREE.ShaderChunk, {
  // brume d'horizon : même fonction pour le sol et le pavage, pour qu'ils se fondent sans démarcation
  trv_haze: 'vec3 hazeColor(vec3 fogc, vec3 band, float elev){ return fogc + band * exp(-abs(elev) * 7.0); }',
  trv_noise3: noiseGLSL('noise3', 'hash3'),
  trv_snoise: noiseGLSL('sNoise', 'sHash'),
});
