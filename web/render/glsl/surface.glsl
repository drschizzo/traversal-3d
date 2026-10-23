// Surfaces procédurales des cases et du socle : motif calculé à partir de la position monde, sans texture.
// Injecté dans les matériaux standard par withSurface (surfaces.js) ; LEVEL_H (hauteur d'un niveau de case)
// y est défini, et le bloc trv_snoise par glsl/chunks.js.
uniform int uSurface;
uniform float uSurfTime;
uniform float uGlowAmt;
uniform float uMistAmt;
uniform vec3 uMistCol;
varying vec3 vSurfP;
varying vec3 vSurfN;
float gPits = 0.0, gGold = 0.0;
// distance au bord de la case (les cases sont centrées sur des demi-entiers)
float cellEdge(vec3 p){ vec2 f = fract(p.xz); return min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)); }
float sHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
#include <trv_snoise>
vec3 surfaceTint(vec3 base, inout float rough){
  vec3 p = vSurfP;
  if (uSurface == 1) {                       // bois : cernes et fibres, sens du fil alterné d'un bloc à l'autre
    float h = sHash(vec3(floor(p.x + 0.5), floor(p.y / LEVEL_H), floor(p.z + 0.5)));
    vec3 q = h > 0.5 ? p : p.zyx;
    float ring = length(vec2(q.z, q.y * 2.6) + h * 17.0) * 4.5 + sNoise(q * vec3(0.7, 3.0, 3.0)) * 1.8;
    float g = smoothstep(0.05, 0.5, abs(fract(ring) - 0.5));
    float fib = sNoise(q * vec3(1.2, 36.0, 36.0));
    base *= mix(0.8, 1.05, g) * (0.94 + 0.1 * fib);
    rough = mix(rough * 0.75, rough, g);
  } else if (uSurface == 2) {                // pierre volcanique : marbrures irrégulières, grain et petites alvéoles
    vec3 w = vec3(sNoise(p * 1.6), sNoise(p * 1.6 + 5.2), sNoise(p * 1.6 + 9.1));
    float m = sNoise(p * 3.1 + w * 1.6) * 0.6 + sNoise(p * 7.3 + w) * 0.3 + sNoise(p * 19.0) * 0.1;
    float pits = smoothstep(0.8, 0.92, sNoise(p * 27.0 + w * 2.0));
    base *= (0.8 + 0.32 * m) * (1.0 - 0.3 * pits);
    gPits = smoothstep(0.82, 0.97, sNoise(p * 4.2 + 11.0 + w * 0.8));    // foyers : pierre calcinée qui couve
    base *= 1.0 - 0.6 * gPits;
    rough = mix(rough, 1.0, pits);
  } else if (uSurface == 3) {                // glace : marbrures bleutées, poli irrégulier
    float n1 = sNoise(p * 4.5);
    base = mix(base, base * vec3(0.84, 0.93, 1.1), 0.6 * n1) * (0.95 + 0.1 * sNoise(p * 16.0));
    rough = 0.12 + 0.3 * n1;
  } else if (uSurface == 4) {                // céramique : émail satiné légèrement nuancé
    base *= 0.95 + 0.09 * sNoise(p * 2.8);
  } else if (uSurface == 6) {                // planche : fil droit et fibres, sans cernes (évite les grands arcs sur le socle)
    vec3 q = p * vec3(0.25, 9.0, 9.0);
    float grain = sNoise(q + vec3(0.0, sNoise(p * 0.6) * 3.0, 0.0)) * 0.7 + sNoise(q * vec3(2.0, 3.5, 3.5)) * 0.3;
    base *= 0.82 + 0.26 * grain;
  } else if (uSurface == 7) {                // ardoise : feuilletage fin, traces de craie et trait de craie sur le pourtour des cases
    base *= 0.9 + 0.12 * sNoise(vec3(p.x * 2.0, p.y * 45.0, p.z * 2.0)) + 0.05 * sNoise(p * 20.0);
    base = mix(base, base * 1.3 + 0.03, smoothstep(0.62, 0.9, sNoise(p * 1.4)) * 0.35);
    // trait de craie sur la partie plate du dessus seulement (pas sur les arrondis ni sur le socle)
    float flatTop = step(0.97, vSurfN.y) * uGlowAmt;
    float d = cellEdge(p);
    float line = smoothstep(0.065, 0.08, d) * smoothstep(0.115, 0.095, d) * flatTop;
    float broken = smoothstep(0.3, 0.55, sNoise(p * 7.0)) * (0.65 + 0.35 * sNoise(p * 35.0));
    base = mix(base, vec3(0.86, 0.88, 0.82), line * broken * 0.85);
    rough = 0.9;
  } else if (uSurface == 8) {                // marbre : veines sinueuses, filets d'or, poli miroir
    float t = p.x * 1.1 + p.z * 0.6 + p.y * 0.8 + (sNoise(p * 1.4) + sNoise(p * 2.9) * 0.5 + sNoise(p * 6.1) * 0.25) * 2.6;
    float vein = pow(smoothstep(0.7, 1.0, 1.0 - abs(sin(t * 1.2))), 2.0);
    float lum = dot(base, vec3(0.299, 0.587, 0.114));
    base *= 0.92 + 0.12 * sNoise(p * 2.2);                                   // nuages laiteux du marbre
    base = mix(base, lum > 0.35 ? base * 0.5 : base * 2.0 + 0.06, vein * 0.55);
    gGold = smoothstep(0.965, 1.0, 1.0 - abs(sin(t * 0.63 + 2.0))) * smoothstep(0.45, 0.6, sNoise(p * 0.7 + 3.0)) * mix(0.35, 1.0, uGlowAmt);   // plus discret sur le socle
    base = mix(base, vec3(0.83, 0.62, 0.24), gGold);
    rough = mix(0.16, 0.3, vein);
  } else if (uSurface == 9) {                // néon : surface sombre et lustrée (les arêtes s'allument dans surfaceGlow)
    base *= 0.85 + 0.15 * sNoise(p * 3.0);
    rough = 0.22;
  } else if (uSurface == 10) {               // paysage : le dessus change de matière avec l'altitude, les flancs sont en terre
    float top = step(0.5, vSurfN.y);
    float lvl = p.y / LEVEL_H - 1.0;                         // hauteur de la case (sur le dessus)
    if (top > 0.5) {
      float grass = 1.0 - smoothstep(3.0, 4.5, lvl);
      float snow = smoothstep(6.0, 7.0, lvl);
      float rock = (1.0 - grass) * (1.0 - snow);
      // herbe : touffes plus sombres et brins fins
      float g = (0.82 + 0.2 * sNoise(p * vec3(42.0, 3.0, 42.0))) * (0.9 + 0.16 * sNoise(p * 3.2));
      // roche : grain et mouchetures
      float r = (0.85 + 0.2 * sNoise(p * 9.0)) * (0.93 + 0.1 * sNoise(p * 30.0));
      // neige : presque lisse, légèrement bleutée dans les creux
      float n = 0.96 + 0.06 * sNoise(p * 6.0);
      base *= g * grass + r * rock + n * snow;
      rough = mix(rough, 0.55, snow);
    } else {
      // flancs : terre striée et petits cailloux
      base *= 0.86 + 0.18 * sNoise(vec3(p.x * 6.0, p.y * 30.0, p.z * 6.0));
      base = mix(base, base * 1.35 + 0.02, step(0.86, sNoise(p * 14.0)) * 0.6);
    }
  } else if (uSurface == 5) {                // sable : grain fin
    base *= 0.9 + 0.13 * sNoise(p * 34.0) + 0.05 * sNoise(p * 4.0);
  } else if (uSurface == 11) {               // jardin sec : gravier ratissé en bas, mousse sur les pierres, terre tassée sur les flancs
    if (vSurfN.y > 0.5) {
      float low = 1.0 - smoothstep(1.0, 3.0, p.y / LEVEL_H - 1.0);        // les sillons ne sont tracés qu'au ras du sol
      float rake = 0.5 + 0.5 * sin(length(p.xz) * 6.2 + sNoise(p * 0.7) * 0.8);
      base *= mix(1.0, 0.92 + 0.15 * rake, low) * (0.95 + 0.09 * sNoise(p * 26.0));
      base *= mix(0.93 + 0.14 * sNoise(p * vec3(16.0, 3.0, 16.0)), 1.0, low);   // touffes de mousse sur les sommets
      rough = mix(rough, 1.0, 0.4);
    } else {
      base *= 0.88 + 0.16 * sNoise(vec3(p.x * 5.0, p.y * 22.0, p.z * 5.0));
    }
  } else if (uSurface == 12) {               // épure : aucun grain, un liseré plus sombre sur le pourtour des dessus
    // les cases d'une même hauteur restent distinctes, sans rien ajouter qui gêne la lecture du relief
    float line = step(0.97, vSurfN.y) * (1.0 - smoothstep(0.03, 0.055, cellEdge(p)));
    base *= 1.0 - 0.22 * line;
  }
  return base;
}
// lumière propre à chaque matière : reflets de la glace, alvéoles qui rougeoient, caustiques, lumière tamisée
vec3 surfaceGlow(vec3 n, vec3 v){
  vec3 p = vSurfP;
  float top = step(0.5, vSurfN.y);
  if (uSurface == 3) {                        // glace : reflet sur les arêtes rasantes + éclats qui scintillent
    float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
    vec3 gc = floor(p * 22.0);
    float tw = step(0.992, sHash(gc)) * pow(0.5 + 0.5 * sin(uSurfTime * 2.5 + sHash(gc + 3.1) * 40.0), 4.0);
    return vec3(0.45, 0.68, 1.0) * fres * 0.28 + vec3(1.0) * tw * 1.4 * top;
  }
  if (uSurface == 2) {                        // braise : quelques foyers rougeoyants qui palpitent dans la pierre
    float pulse = 0.5 + 0.5 * sin(uSurfTime * 1.6 + sNoise(p * 1.3) * 9.0);
    return vec3(1.0, 0.2, 0.02) * gPits * gPits * (0.35 + 0.65 * pulse) * 1.3 * uGlowAmt;
  }
  if (uSurface == 5) {                        // lagon : caustiques qui ondulent sur le dessus des cases
    float cs = (0.5 + 0.5 * sin(p.x * 3.1 + sin(p.z * 2.3 + uSurfTime * 0.9) * 1.6)) * (0.5 + 0.5 * sin(p.z * 3.4 + sin(p.x * 2.1 - uSurfTime * 0.8) * 1.6));
    return vec3(0.45, 0.95, 0.9) * pow(cs, 4.0) * 0.4 * top;
  }
  if (uSurface == 10) {                       // paysage : la neige des sommets scintille doucement
    float lvl = p.y / LEVEL_H - 1.0;
    vec3 gc = floor(p * 26.0);
    float tw = step(0.994, sHash(gc)) * pow(0.5 + 0.5 * sin(uSurfTime * 2.0 + sHash(gc + 5.0) * 40.0), 4.0);
    return vec3(1.0, 0.92, 0.85) * tw * smoothstep(6.0, 7.0, lvl) * top * 1.2 * uGlowAmt;
  }
  if (uSurface == 8) {                        // marbre : les filets d'or accrochent la lumière
    return vec3(1.0, 0.72, 0.3) * gGold * 0.35 * uGlowAmt;
  }
  if (uSurface == 9) {                        // néon : pourtour des cases et joints des couches, du cyan (bas) au magenta (haut)
    // le liseré est tracé sur la partie plate du dessus, juste à l'intérieur de l'arrondi :
    // sur l'arrondi lui-même, la normale varie et le trait n'apparaissait que sous certains angles
    float top = step(0.5, vSurfN.y);
    float d = cellEdge(p);
    float rim = smoothstep(0.05, 0.062, d) * smoothstep(0.1, 0.085, d) * step(0.9, vSurfN.y)
              + smoothstep(0.06, 0.02, d) * top * 0.5;
    float fy = fract(p.y / LEVEL_H);
    vec2 side = abs(vSurfN.x) > 0.5 ? vec2(p.z, 0.0) : vec2(p.x, 0.0);
    float joint = smoothstep(0.07, 0.02, min(fy, 1.0 - fy)) * (1.0 - top) * 0.5;
    float corner = smoothstep(0.04, 0.012, min(fract(side.x), 1.0 - fract(side.x))) * (1.0 - top);
    vec3 hue = mix(vec3(0.15, 0.95, 1.0), vec3(1.0, 0.2, 0.85), clamp(p.y / 2.7, 0.0, 1.0));
    // respiration très lente et discrète : les contours restent stables pour la lisibilité
    float pulse = 0.8 + 0.2 * sin(uSurfTime * 0.45 - length(p.xz) * 0.25);
    return hue * (rim + joint * 0.6 + corner * 0.6) * pulse * 1.0 * uGlowAmt;
  }
  if (uSurface == 4) {                        // aube : lumière tamisée qui glisse sur le plateau
    float d = smoothstep(0.5, 0.8, sNoise(vec3(p.xz * 0.45, uSurfTime * 0.12)));
    return vec3(1.0, 0.72, 0.5) * d * 0.14 * top;
  }
  return vec3(0.0);
}
