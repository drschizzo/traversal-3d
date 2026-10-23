// Thèmes : palettes du plateau, du socle, du pavage brumeux, du ciel et des lumières.
// Couleurs en sRGB (hex). Les couleurs d'équipe (rouge / bleu) ne changent pas, pour la lisibilité.
//
// terrain.top    : couleur du dessus des cases, de la hauteur 0 à 8
// terrain.strata : couleur des couches sous la surface, de la plus basse à la plus haute
// modes          : variantes de terrain propres à un mode (facultatif)
// surface        : rendu des cases (matte, wood, stone, ice, ceramic, sand, slate, marble, neon, landscape) ; roughness : brillance
// plinth / plinthSurface : couleur et rendu du socle
// pieces         : finition des pièces (roughness, clearcoat) ; laque brillante par défaut ;
//                  teams : couleurs propres au thème [{ main, dark }, { main, dark }] (rester rouge et bleu)
// pips           : repères des pièces — top : sommets du haut (Force), base : coins de la base (Mouvement) ;
//                  shape (sphere, octa, peg), puis pour chacun color, metalness, roughness, emissive, glow
// horizon / band : brume d'horizon (couleur de base et bande lumineuse ajoutée près de l'horizon)
// field          : pavage brumeux (creux, milieu, sommets, arêtes des cases)
// decor          : ce que sont les plateaux voisins — valleys (vallées de brume), bench (ébauches sur l'établi),
//                  reef (récif noyé), lava (coulées), floes (banquise), chalk (croquis à la craie),
//                  gallery (pièces exposées), grid (ville en contrebas), garden (pierres d'un jardin sec).
//                  En qualité basse, le décor laisse place au ciel du thème (horizon, band, skyTop) et à son sol
//                  (floor) : à cette résolution il ne serait qu'une bouillie, pour un coût qu'on ne peut pas payer.
// lite           : thème épuré — jamais de décor (le ciel du thème à la place), ni post-traitement, ni particules,
//                  et l'image n'est recalculée que quand quelque chose bouge, à tous les niveaux de qualité
// fog            : [début, fin] de la brume sur le plateau lui-même (34 et 120 par défaut)
// fx             : effets du décor — beam (halos de lumière qui dérivent), alley (braises qui couvent sous la brume),
//                  caustics (reflets ondulants), sparkle (paillettes)
// dust / extra   : deux systèmes de particules (couleur, taille, sizeVar : variation de taille, opacité,
//                  speed : vitesse verticale — négative = chute —, speedVar, sway : balancement, flicker : scintillement)
// burst          : éclats lors d'une capture (color, count, shards : éclats solides, gravity, speed)
// post           : post-traitement — bloom { strength, radius, threshold }, vignette (+ vignetteColor),
//                  shadows / highlights (teinte ajoutée aux ombres / hautes lumières), saturation, contrast,
//                  grain, aberration (chromatique), frost (givre sur les bords), leak (fuite de lumière), heat (air qui ondule)
// flicker        : vacillement de la lumière (feu) ; envIntensity : force des reflets sur les cases

export const THEMES = [
  {
    id: 'crepuscule', name: 'Crépuscule',
    pips: { shape: 'sphere', top: { color: '#ffd27a', metalness: 1, roughness: 0.25, emissive: '#3a2600' }, base: { color: '#e4ebf2', metalness: 0.9, roughness: 0.3 } },
    // un paysage à l'heure dorée : herbe, roche et neige sous une lumière rasante chaude,
    // ombres bleutées, halos de soleil couchant qui glissent dans la brume, lucioles
    terrain: {
      top: ['#4f8f3f', '#63a046', '#7aae4c', '#97b25a', '#a9a26c', '#9b8f7e', '#b3ada6', '#dfe3e7', '#f4f6f8'],
      strata: ['#7a5c3e', '#86664a', '#8f7258', '#8a8478', '#999389'],
    },
    modes: {
      woods: { top: ['#3e7a3a', '#4b8942', '#599749', '#68a352'], strata: ['#6b4f36', '#765a3f', '#806449'] },
      desert: { top: ['#e8cd96', '#e1c086', '#d8b279', '#cda36b', '#c2945e', '#b58553', '#a7774a'], strata: ['#c49a63', '#b98c58', '#ad7f4d', '#a07346', '#94683f'] },
    },
    surface: 'landscape', roughness: 0.82,
    plinth: '#221f2e',
    horizon: '#2a2140', band: '#a0607a', skyTop: '#0c0f22', glows: ['#8a4a8c', '#2c6f9f', '#ff9a5a'],
    floor: '#0b0a18',
    field: { low: '#2a2448', mid: '#6a5a8c', high: '#f0a878', edge: '#c890a8' },
    decor: 'valleys',
    fx: { beam: '#ff9a6a', beamStrength: 0.7 },
    dust: { color: '#ffd0a0', size: 0.11, speed: 0.1, sway: 0.4, opacity: 0.6, sizeVar: 0.7 },
    extra: { color: '#ffe9a0', size: 0.13, speed: 0.04, sway: 0.9, flicker: 1, opacity: 0.95 },
    burst: { color: '#ffc890', count: 18, gravity: 1.2, speed: 0.9 },
    post: { bloom: { strength: 0.5, radius: 0.6, threshold: 1.0 }, vignette: 0.4, vignetteColor: '#06040e', shadows: '#020a1c', highlights: '#1c0c00', saturation: 1.08, contrast: 1.05, leak: '#6a2e40' },
    light: { sky: '#b8c4ff', ground: '#3a2a38', sun: '#ffc392', fill: '#7a9cff' },
  },
  {
    id: 'atelier', name: 'Atelier',
    pips: { shape: 'peg', top: { color: '#e8c896', roughness: 0.65 }, base: { color: '#8a5e38', roughness: 0.7 } },
    // la version en bois imaginée à l'origine : blocs de bois massif, socle en noyer, pièces en bois peint
    terrain: {
      top: ['#7a5232', '#875c38', '#94673f', '#a27347', '#af8050', '#bc8d5b', '#c99a67', '#d6a874', '#e2b783'],
      strata: ['#5a3c24', '#b48c5c', '#5a3c24', '#b48c5c', '#5a3c24', '#b48c5c', '#5a3c24', '#b48c5c'],
    },
    surface: 'wood', roughness: 0.62,
    plinth: '#3a2414', plinthSurface: 'plank',
    pieces: { roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.4, teams: [{ main: '#a8402e', dark: '#4a2c18' }, { main: '#2f5a94', dark: '#4a2c18' }] },
    horizon: '#2a1c14', band: '#6e4c2c', skyTop: '#0e0906', glows: ['#7a4a26', '#a8743a', '#e0a050'],
    floor: '#110b07',
    field: { low: '#3a2618', mid: '#7a5638', high: '#d8b07a', edge: '#a87c4a' },
    decor: 'bench',
    fx: { beam: '#ffcf8a', beamStrength: 0.8 },
    dust: { color: '#ffd9a0', size: 0.13, speed: 0.08, sway: 0.25, opacity: 0.75, sizeVar: 0.8 },
    burst: { color: '#c89a62', count: 18, shards: true },
    post: { bloom: { strength: 0.4, radius: 0.5, threshold: 1.05 }, vignette: 0.5, vignetteColor: '#0c0602', shadows: '#0c0500', highlights: '#1a0e00', saturation: 0.95, contrast: 1.06, grain: 0.035, leak: '#8a5220' },
    light: { sky: '#ffe6c8', ground: '#3a2414', sun: '#ffdcae', fill: '#ffb070' },
    exposure: 0.95,
  },
  {
    id: 'lagon', name: 'Lagon',
    pips: { shape: 'sphere', top: { color: '#fff4e6', metalness: 0.15, roughness: 0.12, emissive: '#2a2218' }, base: { color: '#9fe6dc', metalness: 0.2, roughness: 0.2 } },
    terrain: {
      top: ['#1f8a80', '#33998a', '#5aab88', '#8fbf88', '#c2c890', '#cfb487', '#a99c8c', '#d4dcd9', '#eef5f4'],
      strata: ['#5e4a38', '#6a5640', '#76624a', '#6e6e68', '#7c7c76'],
    },
    surface: 'sand', roughness: 0.75,
    plinth: '#15252b',
    horizon: '#123038', band: '#3f8a86', skyTop: '#05121a', glows: ['#1f7a8a', '#2fae9a', '#d8b070'],
    floor: '#051116',
    field: { low: '#123a48', mid: '#2f7f88', high: '#d8c79a', edge: '#4fb3b0' },
    decor: 'reef',
    fx: { caustics: 0.7 },
    dust: { color: '#bff8ff', size: 0.1, speed: 0.35, sway: 0.15, opacity: 0.55, sizeVar: 1 },
    extra: { color: '#7ff0e0', size: 0.06, speed: 0.06, sway: 0.4, flicker: 1, opacity: 0.9 },
    burst: { color: '#9ff4f0', count: 22, gravity: 9, speed: 1.2 },
    post: { bloom: { strength: 0.45, radius: 0.6, threshold: 1.05 }, vignette: 0.35, vignetteColor: '#00080c', shadows: '#000c10', highlights: '#001010', saturation: 1.05, contrast: 1.02, aberration: 0.8 },
    light: { sky: '#c8f4ff', ground: '#14303a', sun: '#fff0d0', fill: '#7fe0e0' },
    exposure: 0.95,
  },
  {
    id: 'braise', name: 'Braise',
    pips: { shape: 'sphere', top: { color: '#ffb35a', roughness: 0.5, emissive: '#ff6a10', glow: 0.7 }, base: { color: '#ff8a3a', roughness: 0.6, emissive: '#c03a08', glow: 0.45 } },
    terrain: {
      top: ['#4a4a46', '#5c5a52', '#6e6858', '#857a5e', '#9a8460', '#a8865a', '#7a7470', '#9a948e', '#c8c0b8'],
      strata: ['#2e2a28', '#3a3430', '#463e38', '#3c3a38', '#4a4644'],
    },
    surface: 'stone', roughness: 0.9,
    plinth: '#1b1716', plinthSurface: 'stone',
    horizon: '#24161a', band: '#7a3a22', skyTop: '#090606', glows: ['#8a2a1a', '#c05a20', '#ffa040'],
    floor: '#0b0707',
    field: { low: '#2a1a1c', mid: '#5a3530', high: '#e09050', edge: '#b0603a' },
    decor: 'lava',
    dust: { color: '#ff9a40', size: 0.11, speed: 0.6, sway: 0.2, opacity: 0.85, flicker: 0.6, sizeVar: 0.8 },
    extra: { color: '#ffd27a', size: 0.07, speed: 2.2, speedVar: 1, sway: 0.3, flicker: 1, opacity: 1 },
    burst: { color: '#ffb040', count: 34, gravity: 0.4, speed: 1.6 },
    flicker: 0.12,
    post: { bloom: { strength: 0.8, radius: 0.55, threshold: 0.9 }, vignette: 0.55, vignetteColor: '#100200', shadows: '#0a0000', highlights: '#1e0800', saturation: 1.1, contrast: 1.1, heat: 1, grain: 0.02 },
    light: { sky: '#ffd6b8', ground: '#2a1410', sun: '#ffc890', fill: '#ff8a5a' },
  },
  {
    id: 'givre', name: 'Givre',
    pips: { shape: 'sphere', top: { color: '#eef8ff', metalness: 0.3, roughness: 0.05, emissive: '#3a6a90', glow: 0.8 }, base: { color: '#cfe6f8', metalness: 0.3, roughness: 0.1, emissive: '#1a3a58', glow: 0.6 } },
    terrain: {
      top: ['#5f7f96', '#7392a8', '#88a5b9', '#9db7c8', '#b3c8d6', '#c8d8e3', '#dce6ee', '#eef3f7', '#ffffff'],
      strata: ['#3e4f62', '#4a5c70', '#566a7e', '#62768a', '#6e8296'],
    },
    surface: 'ice', roughness: 0.3,
    plinth: '#2e3549',
    horizon: '#4a5878', band: '#6f80a0', skyTop: '#1a2440', glows: ['#8aa0d8', '#a8d4ec', '#e0d0ec'],
    floor: '#202842',
    field: { low: '#3e4a6a', mid: '#7486ad', high: '#dfe8f8', edge: '#a8bce0' },
    decor: 'floes',
    fx: { sparkle: 0.9 },
    dust: { color: '#ffffff', size: 0.17, speed: -0.45, sway: 0.5, opacity: 0.8, sizeVar: 1 },
    extra: { color: '#e8f4ff', size: 0.06, speed: -0.08, sway: 0.2, flicker: 1, opacity: 1 },
    burst: { color: '#dff2ff', count: 22, shards: true },
    envIntensity: 0.6,
    post: { bloom: { strength: 0.4, radius: 0.7, threshold: 1.6 }, vignette: 0.25, vignetteColor: '#0a1424', shadows: '#00061a', highlights: '#000814', saturation: 0.85, frost: 0.85 },
    light: { sky: '#e8f0ff', ground: '#4a5874', sun: '#ffffff', fill: '#b0c8ff' },
    exposure: 0.85,
  },
  {
    id: 'ardoise', name: 'Ardoise',
    pips: { shape: 'sphere', top: { color: '#f2f2ea', roughness: 1 }, base: { color: '#b8beb4', roughness: 1 } },
    // un tableau noir : ardoise feuilletée, pourtour des cases tracé à la craie, poussière de craie
    terrain: {
      top: ['#2e3735', '#34403d', '#3b4844', '#43514c', '#4c5a55', '#56645e', '#606e68', '#6b7872', '#77837c'],
      strata: ['#232a29', '#283030', '#2d3634', '#323c39', '#37423e'],
    },
    surface: 'slate', roughness: 0.9,
    plinth: '#1e2423', plinthSurface: 'slate',
    pieces: { roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.35 },
    horizon: '#1a2120', band: '#56645e', skyTop: '#0a0d0d', glows: ['#3a4a46', '#5a6a60', '#8a8a78'],
    floor: '#0b0f0e',
    field: { low: '#1c2422', mid: '#4a5a55', high: '#c8d0c8', edge: '#e8ece0' },
    decor: 'chalk',
    dust: { color: '#eef0e6', size: 0.11, speed: -0.06, sway: 0.35, opacity: 0.6, sizeVar: 0.9 },
    burst: { color: '#f2f4ec', count: 24, gravity: 2.5, speed: 0.8 },
    post: { bloom: { strength: 0.25, radius: 0.4, threshold: 1.1 }, vignette: 0.45, vignetteColor: '#050706', shadows: '#020604', highlights: '#0a0a06', saturation: 0.8, contrast: 1.05, grain: 0.03 },
    light: { sky: '#e8f0ec', ground: '#202826', sun: '#fff8ec', fill: '#a8c0b8' },
  },
  {
    id: 'marbre', name: 'Marbre & or',
    pips: { shape: 'sphere', top: { color: '#ffd27a', metalness: 1, roughness: 0.12, emissive: '#3a2600' }, base: { color: '#f4f0e8', metalness: 0.1, roughness: 0.15 } },
    // une édition de luxe : marbre noir dans les creux, blanc de Carrare sur les sommets, filets d'or
    terrain: {
      top: ['#2a2a30', '#3a3a42', '#55555e', '#76767e', '#9a9aa0', '#bcbcbe', '#d8d6d2', '#ebe8e2', '#f8f6f2'],
      strata: ['#1e1e24', '#2e2e34', '#3e3e44', '#4e4e54', '#5e5e64'],
    },
    surface: 'marble', roughness: 0.2,
    plinth: '#141418', plinthSurface: 'marble',
    pieces: { roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 },
    envIntensity: 0.7,
    horizon: '#16151a', band: '#5a5040', skyTop: '#070609', glows: ['#4a4038', '#6a5a40', '#c8a050'],
    floor: '#08080a',
    field: { low: '#15151a', mid: '#5a5860', high: '#e8e2d8', edge: '#d4a94a' },
    decor: 'gallery',
    fx: { beam: '#ffd58a', beamStrength: 0.5 },
    dust: { color: '#ffd27a', size: 0.08, speed: 0.05, sway: 0.4, flicker: 0.8, opacity: 0.9, sizeVar: 0.8 },
    burst: { color: '#ffcf6a', count: 26, gravity: 3, speed: 1 },
    post: { bloom: { strength: 0.4, radius: 0.5, threshold: 1.7 }, vignette: 0.45, vignetteColor: '#030304', shadows: '#020204', highlights: '#140e04', saturation: 0.95, contrast: 1.08 },
    light: { sky: '#f4f0ea', ground: '#1a1816', sun: '#fff4e0', fill: '#c8b8a0' },
  },
  {
    id: 'neon', name: 'Néon',
    pips: { shape: 'sphere', top: { color: '#7ff4ff', roughness: 0.3, emissive: '#30f0ff', glow: 0.55 }, base: { color: '#ff7ae0', roughness: 0.3, emissive: '#ff3fd0', glow: 0.4 } },
    // le relief se lit aux contours : cases sombres et lustrées dont les arêtes s'allument, du cyan au magenta
    terrain: {
      top: ['#120a24', '#160c2c', '#1a0e34', '#1e103c', '#221244', '#26144c', '#2a1654', '#2e185c', '#321a64'],
      strata: ['#0c0618', '#0e071c', '#100820', '#120924', '#140a28'],
    },
    surface: 'neon', roughness: 0.22,
    plinth: '#0a0614',
    envIntensity: 0.5,
    horizon: '#140826', band: '#4a1a70', skyTop: '#040208', glows: ['#7a20c0', '#1aa0d0', '#ff40b0'],
    floor: '#05020c',
    field: { low: '#0a0418', mid: '#2a1050', high: '#ff3fd0', edge: '#30f0ff' },
    decor: 'grid',
    fx: { beam: '#b040ff', beamStrength: 0.6 },
    dust: { color: '#7ff4ff', size: 0.06, speed: 0.15, sway: 0.2, flicker: 1, opacity: 0.9, sizeVar: 0.8 },
    extra: { color: '#ff5ad8', size: 0.06, speed: -0.1, sway: 0.3, flicker: 1, opacity: 0.9 },
    burst: { color: '#40f0ff', count: 30, gravity: 0.8, speed: 1.4 },
    post: { bloom: { strength: 0.6, radius: 0.45, threshold: 0.55 }, vignette: 0.5, vignetteColor: '#05000f', shadows: '#06001a', highlights: '#100014', saturation: 1.15, contrast: 1.1, aberration: 1.2 },
    light: { sky: '#b8a0ff', ground: '#100020', sun: '#e8e0ff', fill: '#ff40c0' },
    exposure: 0.95,
  },
  {
    id: 'zen', name: 'Zen',
    pips: { shape: 'peg', top: { color: '#f4ecd8', roughness: 0.55 }, base: { color: '#8c8273', roughness: 0.7 } },
    // un jardin sec au petit matin : le gravier est ratissé autour des pierres, la mousse gagne les sommets,
    // une bordure de bois tient le tout, et la lumière est celle, égale, d'un ciel couvert
    terrain: {
      top: ['#e9e2cf', '#e2d9c2', '#d7ccb3', '#c8bfa4', '#b5b095', '#a0a687', '#8d9b79', '#7d9070', '#6f8a6a'],
      strata: ['#bfae90', '#c7b89b', '#b2a488', '#a1957c', '#938872'],
    },
    surface: 'gravel', roughness: 0.88,
    plinth: '#4a3f31', plinthSurface: 'plank',
    pieces: { roughness: 0.55, clearcoat: 0.18, clearcoatRoughness: 0.5, teams: [{ main: '#b2553f', dark: '#5a3a30' }, { main: '#3f6b8c', dark: '#2f4452' }] },
    horizon: '#ddd3bc', band: '#f2ecd8', skyTop: '#aebfc4', glows: ['#cfd3c0', '#e2d8bf', '#f4efdd'],
    floor: '#cdc3a9',
    field: { low: '#b9b098', mid: '#d6cdb4', high: '#a8b188', edge: '#f6f1e2' },
    decor: 'garden',
    dust: { color: '#f0dcd4', size: 0.14, speed: -0.05, sway: 0.7, opacity: 0.45, sizeVar: 0.9 },
    burst: { color: '#cfc6ad', count: 14, gravity: 3, speed: 0.7 },
    envIntensity: 0.35,
    post: { bloom: { strength: 0.18, radius: 0.6, threshold: 1.5 }, vignette: 0.22, vignetteColor: '#6a6252', shadows: '#141c20', highlights: '#161206', saturation: 0.88, contrast: 1.02, grain: 0.025 },
    light: { sky: '#eef3f2', ground: '#b4a98e', sun: '#fff6e2', fill: '#cfe0e4' },
    exposure: 1.05,
  },
  {
    id: 'minimal', name: 'Minimal',
    lite: true,
    pips: { shape: 'peg', top: { color: '#ffffff', roughness: 0.45 }, base: { color: '#232a35', roughness: 0.6 } },
    // la lisibilité d'abord : des couleurs plates, un dégradé de hauteur franc, un fond neutre, et rien qui bouge.
    // Pas de pavage en raymarching, pas de post-traitement, pas de particules : le jeu seul, partout fluide.
    terrain: {
      // gris neutre, du plus sombre au plus clair : la hauteur se lit d'un coup d'œil, et les couleurs
      // du jeu (pièces rouges et bleues, cases éclairées) ressortent sans rivaliser avec le décor
      top: ['#3c4047', '#4a4f57', '#596069', '#69707a', '#7a828c', '#8d949e', '#a3aab3', '#bcc2ca', '#dde1e6'],
      strata: ['#33363c', '#3a3e44', '#41454c', '#484d54', '#50555c'],
    },
    surface: 'flat', roughness: 0.92,
    plinth: '#c2c6cc',
    pieces: { roughness: 0.5, clearcoat: 0, teams: [{ main: '#cf3a2c', dark: '#7e1f16' }, { main: '#1f6ccf', dark: '#13417e' }] },
    horizon: '#dfe5ec', band: '#eef2f7', skyTop: '#f4f7fa', glows: ['#c9d4e0', '#dfe5ec', '#ffffff'],
    floor: '#ccd0d6',
    field: { low: '#c6cad0', mid: '#dfe2e6', high: '#ffffff', edge: '#9ba0a8' },
    fog: [70, 260],
    envIntensity: 0.12,
    burst: { color: '#7e8894', count: 10, gravity: 9, speed: 0.8 },
    post: { bloom: { strength: 0, radius: 0.4, threshold: 1.4 }, vignette: 0 },
    light: { sky: '#ffffff', ground: '#aab3be', sun: '#ffffff', fill: '#dce6f2' },
  },
];
