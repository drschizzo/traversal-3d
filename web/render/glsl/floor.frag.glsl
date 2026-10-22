// Sol sombre sous la brume, qui se fond dans l'horizon (hazeColor : haze.glsl)
uniform vec3 base, fogc, band; varying vec3 vWp;
#include <trv_haze>
void main(){
  vec3 dir = normalize(vWp - cameraPosition);
  vec3 c = mix(base, hazeColor(fogc, band, dir.y), smoothstep(20.0, 68.0, length(vWp.xz - cameraPosition.xz)));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
