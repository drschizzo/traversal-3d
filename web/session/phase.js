// Ce que la partie attend, à chaque instant : une seule phase à la fois, au lieu d'une dizaine de drapeaux.
//
//   idle       aucune partie en cours (menu, monde en aperçu)
//   intro      la partie commence : le monde se matérialise, la caméra se place
//   human      au joueur (ou à l'un des deux joueurs de cet écran) de jouer
//   bot        le bot cherche son coup
//   paused     bot contre bot en pause (ou position passée affichée)
//   remote     partie en ligne : à l'adversaire de jouer
//   sending    partie en ligne : coup envoyé, en attente de sa confirmation par le serveur
//   animating  un coup se joue sur le plateau
//   judging    entraînement : le bot juge le coup qui vient d'être joué
//   coach      entraînement : après une faute, la partie attend que le joueur reprenne son coup ou continue
//   over       partie terminée
//   review     analyse de fin de partie (position revue, suite rejouée)
//   puzzle     analyse de fin de partie : le joueur cherche un meilleur coup
//
// Les phases « de tour » (TURN) se décident d'après la position et le mode (session/turns.js) et peuvent suivre
// n'importe quelle phase : un tour commence aussi après un coup repris, une navigation, une reconnexion…
// Les autres n'ont que quelques prédécesseurs possibles : une transition imprévue est signalée.
export const PHASES = ['idle', 'intro', 'human', 'bot', 'paused', 'remote', 'sending', 'animating', 'judging', 'coach', 'over', 'review', 'puzzle'];
const TURN = ['idle', 'intro', 'human', 'bot', 'paused', 'remote', 'over'];
const FROM = {
  sending: ['human'],
  // depuis coach : à deux sur cet écran, l'autre joueur peut jouer sans attendre « Continuer »
  animating: ['human', 'bot', 'remote', 'sending', 'coach'],
  judging: ['animating'],
  coach: ['judging'],
  review: ['over', 'review', 'puzzle'],
  puzzle: ['review', 'puzzle'],
};
// phases où le joueur peut agir sur la partie (jouer, demander un conseil, reprendre un coup…)
const OPEN = ['idle', 'human', 'paused', 'remote', 'coach', 'puzzle'];

export function canGo(from, to) {
  return TURN.includes(to) || (FROM[to] ?? []).includes(from);
}

/** @param {{ onChange?: (to: string, from: string) => void, onInvalid?: (from: string, to: string) => void }} [opts] */
export function createPhase({ onChange = (to, from) => {}, onInvalid = (from, to) => console.warn(`phase : ${from} → ${to} inattendu`) } = {}) {
  let current = 'idle';
  return {
    get: () => current,
    is: (...names) => names.includes(current),
    /** La partie attend-elle quelque chose qui n'est pas une action du joueur ? */
    busy: () => !OPEN.includes(current),
    to(next) {
      if (!PHASES.includes(next)) throw new Error(`phase inconnue : ${next}`);
      if (!canGo(current, next)) onInvalid(current, next);
      const prev = current;
      current = next;
      if (prev !== next) onChange(next, prev);
    },
  };
}
