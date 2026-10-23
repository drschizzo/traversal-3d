// Ce que la session annonce à l'interface. Le déroulement d'une partie (session/) ne connaît aucun module de ui/ :
// il dit ce qui vient de changer, et ui/ décide quoi afficher (abonnements posés par main.js, au démarrage).
// Le sens des dépendances est ainsi à sens unique — ui/ appelle session/, jamais l'inverse — et les modules de
// session/ se testent sans DOM : il suffit de s'abonner et de regarder ce qui est annoncé.
//
// Les annonces disent ce qui s'est passé, pas quoi dessiner :
//
//   status   { text, side, thinking }  message d'état au-dessus du plateau
//   refresh  —                         tableau des scores et barre d'outils (ce que la position a changé)
//   coach    —                         panneau d'analyse (conseil, explication du dernier coup)
//   coachOpen  boolean                 ouvrir ou fermer le panneau d'analyse
//   plan     items | null              coups tracés sur le plateau (null : effacer)
//   select   pi | -1                   pièce sélectionnée (−1 : plus aucune)
//   toast    message                   annonce passagère
//   names    —                         noms des camps au tableau des scores
//   menu     —                         boutons du menu (une partie est en cours, ou non)
//   enter    —                         on entre dans la partie : le menu s'efface, le HUD s'affiche
//   leave    —                         on quitte la partie : l'écran de jeu s'efface
//   openMenu —                         le menu revient au premier plan
//   rematch  —                         la revanche a avancé (proposée, acceptée)
//   over     —                         fenêtre de fin de partie
//   lobby    { title, text, code, canCopy } | null   fenêtre du salon en ligne (null : la fermer)
//   feedback —                         verdict du coup joué (mode Entraînement)
//   review   —                         écran d'analyse de fin de partie
//
// Pur, sans DOM : testé dans tests/session.test.js.

/** @typedef {'status' | 'refresh' | 'coach' | 'coachOpen' | 'plan' | 'select' | 'toast' | 'names' | 'menu' | 'enter' | 'leave' | 'openMenu' | 'over' | 'rematch' | 'lobby' | 'feedback' | 'review'} ViewEvent */

/** @type {Map<ViewEvent, Set<(arg?: any) => void>>} */
const listeners = new Map();

/**
 * Pose un abonnement (main.js au démarrage).
 * @param {ViewEvent} name @param {(arg?: any) => void} fn @returns {() => void} de quoi se désabonner
 */
export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}

/** Abonne plusieurs annonces d'un coup : on({ status: …, refresh: … }). */
export function onAll(map) {
  for (const [name, fn] of Object.entries(map)) on(/** @type {ViewEvent} */ (name), fn);
}

/**
 * Annonce. Sans abonné, il ne se passe rien : la session tourne aussi bien sans interface (tests).
 * Un abonné qui échoue ne fait pas échouer les autres, ni la partie.
 * @param {ViewEvent} name
 */
export function emit(name, arg) {
  for (const fn of listeners.get(name) ?? []) {
    try { fn(arg); } catch (e) { console.error(`abonné « ${name} » en échec`, e); }
  }
}

/** Raccourcis des annonces les plus courantes, pour que les modules de session/ restent lisibles. */
export const status = (text, side, thinking = false) => emit('status', { text, side, thinking });
export const refresh = () => emit('refresh');
export const toast = msg => emit('toast', msg);
export const clearSelection = () => emit('select', -1);
export const clearPlan = () => emit('plan', null);
export const showPlan = items => emit('plan', items);

/** Oublie tous les abonnements (tests). */
export const reset = () => listeners.clear();
