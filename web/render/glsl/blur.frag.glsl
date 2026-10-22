// Flou du décor : quatre lectures décalées de la texture du pavage, réduite au quart
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  vec2 o = uTexel * 1.5;
  vec3 c = texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb
         + texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}
