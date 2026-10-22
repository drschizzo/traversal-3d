// Étalonnage final, en espace écran : vignette, teintes, grain, aberration, givre, fuites de lumière, chaleur
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
}
