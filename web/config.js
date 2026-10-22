// Réglages du jeu qui dépendent de l'hébergement
const REPO_URL = 'https://github.com/drschizzo/traversal-3d';
export const GUIDE_URL = `${REPO_URL}/blob/main/docs/guide-strategie.md`;

// Serveur des salons en ligne. Quand le Worker sert lui-même le jeu (wrangler dev sur le port 8787, ou le site
// *.workers.dev), et en développement (npm run dev relaie /room vers wrangler dev), les salons sont sur la même
// origine que la page ; ailleurs (autre hébergeur), sur DEFAULT_SERVER. ?server=… dans l'adresse force un autre serveur.
const DEFAULT_SERVER = 'https://traversal-online.drschizzo.workers.dev';
export function roomServer(loc = location) {
  const servedByWorker = import.meta.env.DEV || loc.port === '8787' || loc.hostname.endsWith('.workers.dev');
  return (new URLSearchParams(loc.search).get('server') || (servedByWorker ? loc.origin : DEFAULT_SERVER)).replace(/\/$/, '');
}
