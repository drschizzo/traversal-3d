// Le bot vu de la partie : demandes de coups et d'analyses, abandonnées quand la partie affichée change.
//
// Portées des calculs (scope.js) : tout ce qui est lancé pour la partie affichée est abandonné quand elle change
// (nouvelle partie, coup repris, navigation…), et ce qui l'est pour l'analyse de partie quand on la referme.
// Le même signal sert aux demandes au bot et aux suites asynchrones qui n'y passent pas (animations, attentes) :
//   const { signal } = gameScope;  …  await …;  if (signal.aborted) return;
import { createBot, PRIORITY, isAbort } from '../bot/client.js';
import { coachLevel } from '../bot/levels.js';
import { createScope } from './scope.js';
import { S, play, mode } from './store.js';

const bot = createBot();
// moteur chargé dès que la page est au repos : premier coup du bot plus rapide, et moteur gardé pour le jeu hors ligne
export const warmUpBot = () => (window.requestIdleCallback || setTimeout)(() => bot.warmUp());

/** portée de la partie affichée */
export const gameScope = createScope();
/** portée de l'analyse de fin de partie */
export const reviewScope = createScope();
export const bumpGame = () => gameScope.bump();
export const bumpReview = () => reviewScope.bump();

/**
 * Demande un coup au bot ; avec analyze, la réponse contient aussi info (évaluation, variante, alternatives).
 * Une demande abandonnée se résout en { move: null, aborted: true }, une panne du moteur en { move: null, error }.
 * @returns {Promise<{ move: any, info: any, aborted?: boolean, error?: string }>}
 */
export async function askBot(s, { level = play.level, analyze = S.coachOn || mode().analyzeAll, priority = PRIORITY.high, cache = false, signal = gameScope.signal } = {}) {
  try { return await bot.think(s, { level, analyze, priority, cache, signal }); }
  catch (e) { if (isAbort(e)) return { move: null, info: null, aborted: true }; throw e; }
}

// meilleur coup d'une position, au niveau du conseil ; partagé par le conseil et l'entraînement, calculé une fois
export const analysisFor = s => askBot(s, { level: coachLevel(play.level), analyze: true, priority: PRIORITY.normal, cache: true });
// jugement d'un coup (entraînement, analyse de partie)
export const reviewAnalysis = (s, signal = reviewScope.signal) => askBot(s, { level: 'review', analyze: true, priority: PRIORITY.low, cache: true, signal });
