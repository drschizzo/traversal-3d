// Qualité graphique. Trois niveaux, plus « auto » (par défaut) : moyen d'emblée sur un appareil tactile, haut sinon,
// puis un cran de moins tant que l'image n'est pas fluide (loop.js). Les postes qui coûtent sur mobile : le pavage
// en raymarching (pas, résolution, fréquence de mise à jour), le post-traitement en demi-flottants (MSAA, halo,
// étalonnage : plusieurs passes plein écran) et les ombres douces. Au niveau bas, la scène est rendue directement
// à l'écran, et le pavage laisse la place au ciel du thème (flatSky) : à cette résolution il ne serait qu'une
// bouillie, alors qu'il coûte cher précisément là où il faut économiser.
export const QUALITY = {
  // live : l'image est recalculée en continu (brume, lucioles, effets animés) ; sinon seulement quand quelque chose bouge
  // bakedNoise : bruit lu dans une texture précalculée au lieu d'être calculé à chaque pixel
  // flatSky : pas de pavage en raymarching — le ciel et le sol du thème, nets et presque gratuits
  high: { name: 'haute', live: true, bakedNoise: false, pr: 1.5, msaa: 4, post: true, bloom: true, field: 0.5, steps: 30, octave2: 1, fieldEvery: 1, shadow: 2048, soft: true, particles: 1, pointPx: 48, shadowEvery: 1 },
  medium: { name: 'moyenne', live: true, bakedNoise: false, pr: 1.25, msaa: 2, post: true, bloom: true, field: 0.35, steps: 20, octave2: 0, fieldEvery: 2, shadow: 1024, soft: false, particles: 0.6, pointPx: 32, shadowEvery: 2 },
  low: { name: 'basse', live: false, bakedNoise: true, flatSky: true, pr: 1, msaa: 0, post: false, bloom: false, field: 0.25, steps: 14, octave2: 0, fieldEvery: 3, shadow: 1024, soft: false, particles: 0.35, pointPx: 20, shadowEvery: 4 },
};
export const LEVELS_ORDER = ['high', 'medium', 'low'];
export const isQualityPref = p => p === 'auto' || p in QUALITY;

// niveau de départ du mode auto : basse sur téléphone, moyenne sur tablette, haute ailleurs
function autoStartLevel() {
  if (!matchMedia('(pointer: coarse)').matches) return 'high';
  return Math.min(screen.width, screen.height) < 600 ? 'low' : 'medium';
}
export const levelFor = pref => (pref === 'auto' ? autoStartLevel() : pref);
