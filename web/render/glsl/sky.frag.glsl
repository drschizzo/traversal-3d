// Ciel des fonds sans pavage (qualité basse, thèmes épurés, salles) : la brume du décor du thème près de
// l'horizon, qui cède au ciel en montant, et la lueur des deux camps derrière les lignes d'arrivée.
// C'est la même fonction backdropColor que le sol (floor.frag.glsl), pour qu'ils se rejoignent sans démarcation.
uniform vec3 fogc, band, haze, glow, top, uRed, uBlue; uniform float uCamps; varying vec3 vDir;
#include <trv_backdrop>
#include <trv_camps>
void main(){
  float elev = normalize(vDir).y;
  vec3 c = mix(backdropColor(fogc, band, haze, glow, elev), top, smoothstep(0.04, 0.62, elev));
  gl_FragColor = vec4(c + campsGlow(uRed, uBlue, vDir, uCamps), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
