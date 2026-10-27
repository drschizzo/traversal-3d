// Les modes de jeu et ce que chacun permet. Le reste du jeu interroge ces capacités au lieu de tester le nom du mode :
// ajouter un mode, c'est ajouter une entrée ici (et, s'il a un déroulement propre, son module, comme online.js,
// qui le déclare par setDriver).
//
// seated  : le joueur occupe une couleur (play.side) ; sinon tous les camps sont humains (humans) ou bots
// humans  : tous les camps sont joués par des humains sur cet écran
// local   : la partie est gardée dans le navigateur (sinon par le serveur)
// undo, hint, training, coach : coup repris, conseil, mode Entraînement, panneau d'analyse disponibles
// playback : lecture automatique, pause et navigation dans les coups (bot contre bot)
// analyzeAll : chaque coup du bot est analysé et expliqué, même panneau fermé
// botPause : temps minimal (ms) avant que le coup du bot soit joué, pour laisser lire son analyse
// followTurn : la caméra passe du côté du camp qui joue
// remote : l'adversaire joue depuis un autre appareil (coups reçus du serveur)
export const MODES = {
  bot: { seated: true, humans: false, local: true, undo: true, hint: true, training: true, coach: true, playback: false, analyzeAll: false, botPause: 650, followTurn: false, remote: false },
  pvp: { seated: false, humans: true, local: true, undo: true, hint: true, training: true, coach: true, playback: false, analyzeAll: false, botPause: 650, followTurn: true, remote: false },
  bvb: { seated: false, humans: false, local: true, undo: false, hint: false, training: false, coach: true, playback: true, analyzeAll: true, botPause: 1100, followTurn: false, remote: false },
  online: { seated: true, humans: false, local: false, undo: false, hint: false, training: false, coach: false, playback: false, analyzeAll: false, botPause: 650, followTurn: false, remote: true },
};
/** @param {{ mode: string }} play */
export const modeOf = play => MODES[play.mode];

/** Le camp t est-il joué par un humain sur cet écran ? */
export const isHuman = (play, t) => modeOf(play).humans || (modeOf(play).seated && t === play.side);

// Déroulement propre d'un mode, fourni par son module quand il s'initialise (online.js pour « online ») : la boucle
// des tours (turns.js) et la fin de partie (game.js) passent par lui sans connaître ce module.
//   turn()        true si le mode prend ce tour en charge (coup reçu à jouer, attente de l'adversaire)
//   send(m)       transmet le coup du joueur, que le mode fait jouer ensuite par performMove(m, true)
//   leave(resign) quitte la partie, en abandonnant si resign
/** @typedef {{ turn(): boolean, send(m: object): void, leave(resign: boolean): void }} Driver */
/** @type {Record<string, Driver>} */
const drivers = {};
/** @param {string} name @param {Driver} d */
export const setDriver = (name, d) => { drivers[name] = d; };
/** @param {{ mode: string }} play @returns {Driver | null} */
export const driverOf = play => drivers[play.mode] ?? null;

/** Camps dont on juge les coups en analyse de partie : le sien, ou les deux à deux sur un écran. */
export const judgedSides = play => (modeOf(play).seated ? [play.side] : [0, 1]);
/** Camp à qui l'interface s'adresse (« votre Sentinelle ») ; −1 : personne en particulier. */
export const viewerSide = play => (modeOf(play).seated ? play.side : -1);
