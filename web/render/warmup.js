// Compilation des shaders sans figer la page.
//
// Three.js compile un shader la première fois qu'il sert, au moment de dessiner, et la page reste figée le temps
// que le pilote finisse : plus d'une seconde et demie au premier chargement (pavage en raymarching, surfaces
// procédurales, pièces laquées, ombres), autant au premier passage à un thème épuré. Celui-ci est dessiné
// directement à l'écran et non dans le post-traitement, et chaque matériau a alors une autre variante (sortie
// sRGB, étalonnage dans le shader) : tout le plateau est à recompiler.
//
// Le travail se fait en deux temps, et aucun ne doit tomber au milieu d'une image :
//  - compiler et lier les programmes : en arrière-plan avec KHR_parallel_shader_compile (renderer.compileAsync),
//    pendant que la boucle de rendu attend en gardant l'image précédente (holding) ; puis les interroger une
//    première fois (emplacements des uniformes, journal), ce que Three.js ferait sinon au premier dessin ;
//  - au premier dessin, le pilote prépare encore l'état de rendu complet (avec Metal : un « pipeline » par
//    programme, format de cible et mélange). Seul un vrai dessin le déclenche : les variantes qu'on veut prêtes à
//    l'avance (warmAhead) sont donc dessinées une fois, sur un seul pixel.
// Une fois la première image affichée, l'autre chemin de sortie et les autres décors sont ainsi préparés à
// l'avance : le premier changement de thème est aussi immédiat que les suivants.
import * as THREE from 'three';
import { renderer, scene, camera, wake } from './context.js';
import { composer } from './postfx.js';
import { fieldPass, backdropVariants } from './background.js';

// Sans l'extension, compileAsync rend la main aussitôt et la compilation se fait sur place : rien n'est gagné au
// démarrage ni au changement de thème, mais rien n'est perdu non plus. Préparer à l'avance n'aurait alors aucun
// sens : ce serait figer la page sans qu'on l'ait demandé (warmAhead).
const parallel = renderer.extensions.has('KHR_parallel_shader_compile');
// Un contexte perdu (fréquent sur mobile, l'onglet passé en arrière-plan) ne dit jamais un programme prêt :
// passé ce délai, on dessine quand même plutôt que de garder l'image figée.
const MAX_WAIT = 4000;

// compile objects tels qu'ils seront dessinés dans target (null : l'écran), éclairés par les lumières de lit
async function compile(objects, target, lit = null) {
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  const done = renderer.compileAsync(objects, camera, lit);
  renderer.setRenderTarget(prev);
  await Promise.race([done, new Promise(res => setTimeout(res, MAX_WAIT))]);
  if (renderer.getContext().isContextLost()) return;
  // interrogés maintenant, quand le GPU n'a rien d'autre à faire ; au premier dessin, l'attente s'ajouterait à
  // celle des programmes dessinés juste avant
  for (const p of renderer.info.programs) p.getUniforms();
}

// Dessine objects une fois dans target, sur un pixel, avec en plus dans la scène les doublures de extras : le
// pilote prépare tout ce que ces programmes demandent. Sans rien effacer, et au début d'une image (runWarmDraws,
// loop.js), que l'image recouvre aussitôt : hors d'une image, le canevas serait présenté vide, et une cible
// effacée pourrait servir telle quelle (le pavage n'est pas redessiné à chaque image).
const draws = [];
const drawOnce = (objects, target, extras = null) => new Promise(done => {
  draws.push(() => { draw(objects, target, extras); done(); });
  wake();
});
/** Dessins d'échauffement en attente : à appeler au début d'une image, avant de la dessiner. */
export function runWarmDraws() {
  while (draws.length) draws.shift()();
}
const _vp = new THREE.Vector4();
function draw(objects, target, extras) {
  const prev = renderer.getRenderTarget(), shadows = renderer.shadowMap.needsUpdate, clear = renderer.autoClear;
  const added = extras ? [...extras.children] : [];
  if (added.length) objects.add(...added);
  renderer.shadowMap.needsUpdate = false;
  renderer.autoClear = false;
  if (target) {
    const vp = target.viewport.clone();
    target.viewport.set(0, 0, 1, 1);
    renderer.setRenderTarget(target);
    renderer.render(objects, camera);
    target.viewport.copy(vp);
  } else {
    renderer.getViewport(_vp);
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, 1, 1);
    renderer.render(objects, camera);
    renderer.setViewport(_vp);
  }
  renderer.setRenderTarget(prev);
  renderer.autoClear = clear;
  renderer.shadowMap.needsUpdate = shadows;
  if (added.length) extras.add(...added);
}

// la scène, avec en plus les doublures d'un fond absent (éclairées comme elle)
async function warmScene(extras, target) {
  await compile(scene, target);
  await compile(extras, target, scene);
  await drawOnce(scene, target, extras);
}

// la scène est dessinée dans le tampon du post-traitement, ou directement à l'écran
const sceneTarget = composed => (composed ? composer.renderTarget1 : null);

let holds = 0, queued = null;
/** Vrai tant que des shaders de la prochaine image sont en cours de compilation : loop.js ne dessine pas. */
export const holding = () => holds > 0;

/** Compile ce que la prochaine image va dessiner ; composed() : la scène passe-t-elle par le post-traitement ?
 *  Attend la fin de la tâche en cours (thème, plateau, pièces posés juste après l'appel), et regroupe les appels. */
export function prepare(composed) {
  if (queued) return queued;
  holds++;
  queued = Promise.resolve().then(() => {
    queued = null;
    const jobs = [compile(scene, sceneTarget(composed()))];
    const field = fieldPass();
    if (field) jobs.push(compile(field.scene, field.target));
    return Promise.all(jobs);
  }).finally(() => { holds--; wake(); });
  return queued;
}

let warmed = false;
/** Une fois : prépare l'autre chemin de sortie, les fonds absents de la scène et les autres décors du pavage. */
export async function warmAhead(post) {
  if (warmed || !parallel) return;
  warmed = true;
  const v = backdropVariants();
  // post-traitement (thèmes ordinaires, qualité haute et moyenne), puis l'écran (thème épuré, qualité basse)
  if (post) await warmScene(v.room, sceneTarget(true));
  await warmScene(v.screen, null);
  if (v.decors) {
    await compile(v.decors, v.fieldTarget);
    await drawOnce(v.decors, v.fieldTarget);
  }
}
