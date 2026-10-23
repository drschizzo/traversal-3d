// Sol sous la brume. Il n'est visible qu'avec un fond simple (background.js) : il part de la couleur de sol du
// thème, relevée vers la brume du décor, et se fond dans l'horizon (backdropColor : glsl/chunks.js).
uniform vec3 base, fogc, band, haze, glow; varying vec3 vWp;
#include <trv_backdrop>
void main(){
  vec3 dir = normalize(vWp - cameraPosition);
  vec3 near = mix(base, haze, 0.35);
  vec3 c = mix(near, backdropColor(fogc, band, haze, glow, dir.y), smoothstep(20.0, 68.0, length(vWp.xz - cameraPosition.xz)));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
