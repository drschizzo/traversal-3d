// Le pavage des plateaux possibles, en raymarching volumétrique : une brume dont la densité épouse le relief
// en colonnes de chaque plateau (atlas uAtlas), et qui se perd dans le brouillard d'horizon.
// FIELD_* et DECOR_* sont définis par le matériau (background.js) ; les blocs trv_* par glsl/chunks.js.
uniform sampler2D uAtlas; uniform float uTime, uFade, uCaus, uSparkle; uniform vec3 fogc, band, uLow, uMid, uHigh, uEdge, uBeam, uAlley, uFloor, uCamPos; uniform vec2 uBeamDir;
varying vec3 vDir;
#include <trv_haze>
const float FLOOR = FIELD_FLOOR, TOP = FIELD_TOP, PITCH = FIELD_PITCH, AN = FIELD_ATLAS;
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
#include <trv_noise3>

// ---------------------------------------------------------------- profils de décor
// Le relief des plateaux voisins est le même pour tous les thèmes : ce qui change, c'est ce qu'ils sont.
// Un seul DECOR_* est défini à la fois. Chaque décor habille ce relief d'une autre matière, en dosant la masse
// de brume (W_BODY), le trait des arêtes (W_HINT), la nappe au ras du sol (W_GROUND), la distance de vue
// (D_NEAR → D_FAR) et la portée du trait (HINT_FAR), puis en ajoutant sa propre structure (eau, coulées,
// chenaux, trame…) dans la boucle plus bas.
// établi : un atelier dans le noir, la sciure flotte au ras du bois sous la seule lampe
#ifdef DECOR_BENCH
  const float W_BODY = 0.85, W_HINT = 0.7, W_GROUND = 1.6, D_NEAR = 20.0, D_FAR = 46.0, HINT_FAR = 38.0;
// récif : une nappe d'eau noie les creux, seuls les sommets émergent en îlots
#elif defined(DECOR_REEF)
  const float W_BODY = 0.5, W_HINT = 0.9, W_GROUND = 0.45, D_NEAR = 42.0, D_FAR = 70.0, HINT_FAR = 45.0;
  const float WATER = FIELD_FLOOR + 1.15;
// coulées : des plaques de basalte refroidi, la lave court dans les allées
#elif defined(DECOR_LAVA)
  const float W_BODY = 0.9, W_HINT = 0.45, W_GROUND = 0.9, D_NEAR = 36.0, D_FAR = 64.0, HINT_FAR = 40.0;
// banquise : des plaques plates dérivant sur l'eau noire, qui remplit les allées
#elif defined(DECOR_FLOES)
  const float W_BODY = 0.7, W_HINT = 0.7, W_GROUND = 0.5, D_NEAR = 46.0, D_FAR = 72.0, HINT_FAR = 50.0;
// craie : les plateaux voisins ne sont pas des volumes, mais des croquis tracés sur l'ardoise
#elif defined(DECOR_CHALK)
  const float W_BODY = 0.14, W_HINT = 1.8, W_GROUND = 0.3, D_NEAR = 30.0, D_FAR = 56.0, HINT_FAR = 52.0;
// galerie : une salle sombre, chaque plateau sous son puits de lumière, comme une pièce exposée
#elif defined(DECOR_GALLERY)
  const float W_BODY = 0.6, W_HINT = 0.8, W_GROUND = 0.4, D_NEAR = 28.0, D_FAR = 58.0, HINT_FAR = 42.0;
// grille : une ville de tours éteintes aux arêtes allumées, posée sur une trame lumineuse
#elif defined(DECOR_GRID)
  const float W_BODY = 0.4, W_HINT = 2.2, W_GROUND = 0.45, D_NEAR = 40.0, D_FAR = 70.0, HINT_FAR = 60.0;
// jardin : un jardin sec, les plateaux sont les pierres et le gravier est ratissé autour
#elif defined(DECOR_GARDEN)
  const float W_BODY = 0.45, W_HINT = 0.55, W_GROUND = 1.3, D_NEAR = 44.0, D_FAR = 70.0, HINT_FAR = 40.0;
// vallées : la brume s'amasse dans les creux et découvre les sommets (décor par défaut)
#else
  const float W_BODY = 1.0, W_HINT = 1.0, W_GROUND = 1.0, D_NEAR = 42.0, D_FAR = 70.0, HINT_FAR = 45.0;
#endif

const float PERIOD = 10.0, HOLD = 0.2;   // transition de 8 s (inchangée), pause réduite de 8 s à 2 s
vec4 cKey = vec4(-9999.0);
float cH = 0.0;
vec2 gLp = vec2(0.0);                    // position dans le plateau voisin traversé (son centre est à l'origine)
float heightAt(float slot, vec2 cell){
  vec2 so = vec2(mod(slot, AN), floor(slot / AN)) * 10.0;
  return texture2D(uAtlas, (so + cell + 0.5) / (AN * 10.0)).r * 255.0;
}
// relief au point xz : hauteur du sommet de colonne (monde), masque du plateau, proximité d'une arête de case,
// proximité d'un coin de case (deux arêtes à la fois : les arêtes verticales des colonnes)
vec4 field(vec2 xz){
  vec2 tile = floor(xz / PITCH + 0.5);
  vec2 lp = xz - tile * PITCH;
  gLp = lp;
  if (tile == vec2(0.0)) return vec4(FLOOR, 0.0, 0.0, 0.0);          // emplacement du socle
  vec2 g = vec2(lp.x + 5.0, 5.0 - lp.y);
  float mask = smoothstep(-1.0, 0.9, min(min(g.x, g.y), min(10.0 - g.x, 10.0 - g.y)));
  vec2 cell = clamp(floor(g), 0.0, 9.0);
  vec4 key = vec4(tile, cell);
  if (key != cKey) {                     // le rayon reste souvent dans la même case : on garde la hauteur
    cKey = key;
    // chaque plateau a son propre cycle : il garde un monde un moment, puis glisse vers le suivant
    float cyc = uTime / PERIOD + hash2(tile + 7.31);
    float ep = floor(cyc), fr = fract(cyc);
    float hA = heightAt(floor(hash2(tile + ep * 13.17) * AN * AN), cell);
    float t = 0.0;
    float prog = max(fr - HOLD, 0.0) / (1.0 - HOLD) * 1.3;
    if (prog > 0.0) {
      float hB = heightAt(floor(hash2(tile + (ep + 1.0) * 13.17) * AN * AN), cell);
      t = clamp((prog - (cell.x + cell.y) / 18.0 * 0.7) / 0.6, 0.0, 1.0);
      hA = mix(hA, hB, t * t * (3.0 - 2.0 * t));
    }
    cH = hA;
  }
  float h = cH;
  vec2 e = abs(fract(g) - 0.5);
  return vec4(FLOOR + (h + 1.0) * 0.3, mask, smoothstep(0.38, 0.5, max(e.x, e.y)), smoothstep(0.30, 0.5, min(e.x, e.y)));
}
void main(){
  vec3 ro = uCamPos, rd = normalize(vDir);
  // couleur du sol sous la brume (fondu dans l'horizon), visible là où la brume est transparente
  float tf = (FLOOR - ro.y) / min(rd.y, -1e-4);
  vec3 floorCol = mix(uFloor, hazeColor(fogc, band, rd.y), smoothstep(20.0, 68.0, tf * length(rd.xz)));
  // intersection avec la tranche FLOOR..TOP
  float ta = (TOP - ro.y) / rd.y, tb = (FLOOR - ro.y) / rd.y;
  // la caméra est bridée (inclinaison ≤ 54°) : les rayons traversent la tranche en pente raide,
  // sur une douzaine d'unités au plus, donc une trentaine de pas suffisent
  float t0 = max(min(ta, tb), 0.0), t1 = min(max(ta, tb), t0 + 16.0);
  if (t1 <= t0) { gl_FragColor = vec4(floorCol, 1.0); return; }
  const int STEPS = FIELD_STEPS;
  float dt = (t1 - t0) / float(STEPS);
  float t = t0 + dt * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 acc = vec3(0.0);
  float T = 1.0;
  for (int i = 0; i < STEPS; i++){
    vec3 p = ro + rd * t;
    if (max(abs(p.x), abs(p.z)) < 5.6) break;                              // le rayon bute sur le socle
    float dist = length(p.xz - ro.xz);
    if (dist > 70.0) break;                                                // au-delà, tout est brume
    vec4 f = field(p.xz);
    float H = f.x, dy = p.y - H;
    if (dy > 0.5 && p.y - FLOOR > 2.2) { t += dt; continue; }             // air vide au-dessus du relief : pas de bruit
    vec3 q = p * vec3(0.45, 0.8, 0.45) + vec3(uTime * 0.04, -uTime * 0.05, uTime * 0.02);
    float n = noise3(q);
    #if FIELD_OCTAVE2
    n = dist < 30.0 ? n * 0.65 + noise3(q * 2.3 + 4.7) * 0.35 : n;        // 2e octave seulement de près
    #endif
    float kH = clamp((H - FLOOR - 0.3) / 2.4, 0.0, 1.0);                   // altitude de la colonne, de 0 à 1
    float body = smoothstep(0.12, -0.25, dy + (n - 0.5) * 0.35) * f.y * W_BODY;    // colonnes de brume
    float hint = exp(-abs(dy) * 8.0) * f.z * f.y * 0.8 * W_HINT * (1.0 - smoothstep(HINT_FAR * 0.4, HINT_FAR, t));  // arêtes des cases
    float ground = exp(-(p.y - FLOOR) * 1.3) * (0.25 + 0.75 * smoothstep(0.35, 0.8, n)) * 0.35 * W_GROUND;          // nappe rampante
    vec3 add = vec3(0.0);                                                  // lumière propre au décor

    #ifdef DECOR_BENCH
      // L'établi : la lampe fait un halo serré sur les plateaux proches, le reste de l'atelier reste dans le noir,
      // et les longues planches du plan de travail courent sous la brume de sciure.
      float lamp = exp(-dist * 0.055);
      float plank = smoothstep(0.03, 0.13, abs(fract(p.z * 0.085 + 0.5) - 0.5));   // joints entre deux planches
      ground *= (0.3 + 1.6 * lamp) * (0.62 + 0.62 * plank);
      body *= 0.35 + 0.9 * lamp;
      add += uEdge * (1.0 - plank) * exp(-(p.y - FLOOR) * 3.0) * lamp * 0.6;
    #elif defined(DECOR_REEF)
      // Le récif : une houle lente soulève la nappe, l'écume suit le trait de côte des îlots, et la surface
      // renvoie le ciel en éclats qui glissent.
      float water = WATER + (sin(p.x * 0.11 + uTime * 0.35) + sin(p.z * 0.09 - uTime * 0.28)) * 0.09;
      float sub = smoothstep(0.3, -0.25, p.y - water);
      ground += sub * 0.22 * (0.6 + 0.6 * n);
      float shore = exp(-abs(p.y - water) * 9.0) * exp(-abs(H - water) * 1.6) * f.y;
      hint += shore * 1.2;
      float sheen = pow(0.5 + 0.5 * sin(p.x * 1.7 + sin(p.z * 1.3 + uTime * 0.7) * 2.0), 4.0);
      add += uEdge * shore * 1.8 + uHigh * exp(-abs(p.y - water) * 20.0) * sheen * 0.45;
    #elif defined(DECOR_LAVA)
      // Les coulées : la lave descend dans les allées par vagues qui avancent, et la croûte refroidie des
      // plaques garde des fissures qui rougeoient entre les cases.
      float flow = smoothstep(0.4, 0.85, noise3(vec3(p.xz * 0.2, uTime * 0.08)));
      float lane = 0.5 + 0.5 * sin(p.z * 0.8 - uTime * 0.9 + flow * 6.0);           // le courant qui descend
      float crack = (1.0 - f.y) * exp(-(p.y - FLOOR) * 2.2) * flow * (0.55 + 0.75 * lane);
      float crust = f.z * f.y * exp(-abs(dy) * 5.0) * (0.3 + 0.7 * flow);           // fissures du dessus des plaques
      ground += crack * 0.5;
      add += uHigh * (crack * 2.0 + crust * 0.6);
    #elif defined(DECOR_FLOES)
      // La banquise : les allées sont des chenaux d'eau noire, les plaques sont coiffées de névé, et là où
      // elles se poussent la glace se dresse en crêtes de compression.
      ground *= f.y;
      float cap = exp(-abs(dy) * 7.0) * f.y;
      float ridge = smoothstep(0.3, 0.9, f.y) * smoothstep(1.0, 0.78, f.y) * exp(-abs(p.y - H - 0.22) * 3.5);
      body += cap * 0.35 + ridge * 0.5;
      add += uHigh * (cap * 0.5 + ridge * 1.1);
    #elif defined(DECOR_CHALK)
      // Le croquis à la craie : le pourtour des cases et les arêtes verticales des colonnes au trait, et les
      // volumes remplis de hachures obliques, comme on dessine au tableau.
      float edge = f.w * f.y * step(dy, 0.05) * exp(min(dy, 0.0) * 0.8) * (1.0 - smoothstep(HINT_FAR * 0.4, HINT_FAR, t));
      float hatch = pow(0.5 + 0.5 * sin((p.x - p.z) * 2.6 + p.y * 1.5), 4.0) * smoothstep(0.3, -0.25, dy) * f.y;
      hint += edge * 0.9 + hatch * 0.4;
      add += uEdge * (hint + edge) * 0.25;
    #elif defined(DECOR_GALLERY)
      // La galerie : chaque plateau est une pièce exposée, posée sur son socle de pierre, sous un puits de
      // lumière où danse la poussière ; la salle alentour reste dans l'ombre.
      float shaft = exp(-dot(gLp, gLp) * 0.045);
      float base = smoothstep(6.1, 5.3, max(abs(gLp.x), abs(gLp.y))) * smoothstep(FLOOR + 1.0, FLOOR + 0.5, p.y);
      body = body * (0.5 + 1.1 * shaft) + base * 0.8;
      ground *= 0.4 + 1.2 * shaft;
      float motes = pow(0.5 + 0.5 * sin(p.x * 9.0 + uTime * 0.6) * sin(p.z * 8.0 - uTime * 0.5), 10.0);
      add += uEdge * shaft * smoothstep(0.0, 1.2, p.y - FLOOR) * 0.25 + uHigh * shaft * motes * 0.5;
    #elif defined(DECOR_GRID)
      // La ville : des tours éteintes aux arêtes allumées, sur une trame au sol que parcourent des impulsions.
      vec2 gr = abs(fract(p.xz * 0.5) - 0.5);
      float lines = smoothstep(0.44, 0.5, max(gr.x, gr.y)) * exp(-(p.y - FLOOR) * 2.6);
      float pulse = pow(0.5 + 0.5 * sin(p.x * 0.35 - uTime * 2.2), 8.0) + pow(0.5 + 0.5 * sin(p.z * 0.3 + uTime * 1.7), 8.0);
      float post = f.w * f.y * step(dy, 0.0) * exp(dy * 0.5);
      ground += lines * 0.35;
      hint += post * 0.8;
      add += uEdge * lines * (1.4 + 2.6 * pulse) + uHigh * post * 0.5;
    #elif defined(DECOR_GARDEN)
      // Le jardin sec : le gravier est ratissé en sillons concentriques autour de chaque pierre, en lignes
      // droites dans les allées, et la mousse couvre le dessus des pierres.
      float d = length(gLp);
      float rake = mix(0.5 + 0.5 * sin(p.x * 2.6), 0.5 + 0.5 * sin(d * 5.4 + 1.5), smoothstep(8.5, 5.5, d));
      ground *= 0.6 + 0.9 * rake;
      float moss = exp(-abs(dy) * 6.0) * f.y * smoothstep(0.25, 0.7, kH);
      add += uEdge * pow(rake, 8.0) * exp(-(p.y - FLOOR) * 2.4) * 0.5 + uHigh * moss * 0.35;
    #else
      // Les vallées : la brume s'amasse dans les creux, et le soleil couchant la raie de longues lames de lumière.
      ground *= 0.45 + 1.2 * (1.0 - kH);
      float ray = pow(0.5 + 0.5 * sin(dot(p.xz, vec2(0.8, -0.6)) * 0.85 + uTime * 0.06), 3.0);
      add += uHigh * ray * (0.25 + 0.55 * (1.0 - kH)) * (1.0 - smoothstep(1.2, 3.2, p.y - FLOOR)) * 0.45;
    #endif

    float dens = (body * (0.3 + 0.8 * n) + hint + ground) * (1.0 - smoothstep(D_NEAR, D_FAR, dist));   // distance de vue, sans coupure
    if (dens > 0.002) {
      vec3 col = mix(uLow, uMid, smoothstep(0.0, 0.5, kH));
      col = mix(col, uHigh, smoothstep(0.55, 1.0, kH));
      col *= 0.55 + 0.9 * clamp(0.55 + dy * 0.9 + (n - 0.5) * 0.4, 0.0, 1.0);
      col += uEdge * hint * 0.5 + add;
      if (uCaus > 0.0) {                                                     // reflets ondulants (caustiques)
        float cs = (0.5 + 0.5 * sin(p.x * 2.1 + sin(p.z * 1.7 + uTime * 0.6) * 1.6)) * (0.5 + 0.5 * sin(p.z * 2.3 + sin(p.x * 1.3 - uTime * 0.5) * 1.6));
        col += uHigh * pow(cs, 3.0) * uCaus * exp(-abs(dy) * 4.0);
      }
      if (uSparkle > 0.0) {                                                  // paillettes de givre qui scintillent
        float hs = hash3(floor(p * 7.0));
        col += vec3(1.0) * step(0.992, hs) * (0.5 + 0.5 * sin(uTime * 2.5 + hs * 60.0)) * exp(-abs(dy) * 6.0) * uSparkle;
      }
      col = mix(col, hazeColor(fogc, band, rd.y), smoothstep(22.0, 66.0, dist));   // perspective atmosphérique
      float a = 1.0 - exp(-dens * dt * 1.5);
      acc += T * a * col;
      T *= 1.0 - a;
      if (T < 0.03) break;
    }
    float fadeD = 1.0 - smoothstep(30.0, 60.0, dist);
    if (uAlley.r + uAlley.g + uAlley.b > 0.0) {                              // braises : lueurs diffuses qui couvent sous la brume
      float ember = smoothstep(0.55, 0.9, noise3(vec3(p.xz * 0.11, uTime * 0.06)));
      acc += T * uAlley * ember * exp(-(p.y - FLOOR) * 2.0) * (0.6 + 0.8 * n) * dt * 0.3 * fadeD;
    }
    if (uBeam.r + uBeam.g + uBeam.b > 0.0) {                                 // halos de lumière chaude qui dérivent lentement
      float pool = smoothstep(0.5, 0.85, noise3(vec3(p.xz * 0.06 + uBeamDir * uTime * 0.04, uTime * 0.02)));
      acc += T * uBeam * pool * exp(-max(dy, 0.0) * 1.5) * dt * 0.06 * fadeD;
    }
    t += dt;
  }
  float a = (1.0 - T) * uFade;
  gl_FragColor = vec4(acc * uFade + floorCol * (1.0 - a), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
