// Ciel des fonds simples (qualité basse, thèmes épurés) : la brume du décor du thème près de l'horizon,
// qui cède au ciel en montant. C'est la même fonction backdropColor que le sol (floor.frag.glsl),
// pour qu'ils se rejoignent sans démarcation.
uniform vec3 fogc, band, haze, glow, top; varying vec3 vDir;
#include <trv_backdrop>
void main(){
  float elev = normalize(vDir).y;
  gl_FragColor = vec4(mix(backdropColor(fogc, band, haze, glow, elev), top, smoothstep(0.04, 0.62, elev)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
