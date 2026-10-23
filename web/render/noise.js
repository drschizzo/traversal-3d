// Bruit 3D précalculé, partagé par le pavage et les surfaces procédurales.
import * as THREE from 'three';
import { NOISE_N } from './glsl/chunks.js';

// En qualité basse, les valeurs pseudo-aléatoires du réseau sont rangées dans une texture 3D
// et lues par interpolation matérielle, avec le même lissage que le calcul direct : une lecture au lieu de huit hachages.
export const noiseUniform = { value: null };
export function ensureNoiseTex() {
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

