// Sol sous la brume. Il n'est visible qu'avec un fond simple (background.js) : il part de la couleur de sol du
// thème, relevée vers la brume du décor, et se fond dans l'horizon (backdropColor : glsl/chunks.js).
uniform vec3 base, fogc, band, haze, glow, uRed, uBlue; uniform float uCamps; varying vec3 vWp;
#include <trv_backdrop>
#include <trv_camps>
void main(){
  vec3 dir = vWp - cameraPosition;
  float far = smoothstep(20.0, 68.0, length(vWp.xz - cameraPosition.xz));
  vec3 c = mix(mix(base, haze, 0.35), backdropColor(fogc, band, haze, glow, normalize(dir).y), far);
  // les camps ne se lisent qu'au loin : de près, c'est le sol, pas l'horizon
  gl_FragColor = vec4(c + campsGlow(uRed, uBlue, dir, uCamps) * far * 0.6, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
