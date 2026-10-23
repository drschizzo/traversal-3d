// Surfaces procédurales : motif calculé dans le fragment shader à partir de la position monde (glsl/surface.glsl),
// aucune texture à charger (en qualité basse, le bruit est lu dans la texture précalculée, voir background.js).
// 0 mat · 1 bois · 2 pierre · 3 glace · 4 céramique · 5 sable · 6 planche (fil droit, pour les grandes surfaces)
// 7 ardoise + craie · 8 marbre veiné d'or · 9 néon (arêtes lumineuses) · 10 paysage (herbe, roche, neige, terre)
// 11 gravier ratissé (jardin sec) · 12 épure (aucun grain, un liseré sur le pourtour des dessus)
import * as THREE from 'three';
import { LEVEL, FLOOR_Y } from './context.js';
import { noiseUniform } from './background.js';
import surfaceGlsl from './glsl/surface.glsl?raw';

const SURFACES = { matte: 0, wood: 1, stone: 2, ice: 3, ceramic: 4, sand: 5, plank: 6, slate: 7, marble: 8, neon: 9, landscape: 10, gravel: 11, flat: 12 };
export const surfaceId = name => SURFACES[name || 'matte'];

const SURFACE_GLSL = `#define LEVEL_H ${LEVEL.toFixed(2)}\n${surfaceGlsl}`;
const surfTime = { value: 0 };
export const setSurfaceTime = t => { surfTime.value = t; };

// uniforms : { uSurface, uGlowAmt?, uMistAmt?, uMistCol? } propres au matériau
export function withSurface(material, uniforms) {
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
