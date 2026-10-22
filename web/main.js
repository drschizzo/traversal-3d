// Traversal 3D — point d'entrée : assemble le rendu (render/), la session de jeu (session/) et l'interface (ui/),
// puis ouvre le menu sur un monde (ou sur la partie en cours, une partie reçue par lien, une invitation).
//
//   core/     règles du jeu, pures (partagées avec le serveur et les tests)
//   render/   scène 3D : plateau, pièces, décor, effets, caméra
//   bot/      moteur du bot (WebAssembly dans un Worker) et sa file de demandes
//   coach/    explication et jugement des coups, progression (pur)
//   session/  déroulement d'une partie : état (store.js), phases, modes, tours, en ligne, analyse
//   ui/       interface HTML : HUD, menu, panneaux, saisie
import * as R from './render/index.js';
import { load } from './storage.js';
import { readLink } from './session/links.js';
import { restoreGame, previewTerrain } from './session/game.js';
import { joinFromLink, resumeOnline, initOnline } from './session/online.js';
import { initPlayback } from './session/playback.js';
import { warmUpBot } from './session/bot.js';
import { initReview } from './session/review.js';
import { initHud, layoutHud } from './ui/hud.js';
import { initMenu, updateMenuButtons, showModeOptions, updateMenuShift } from './ui/menu.js';
import { initInput } from './ui/input.js';
import { initCoachPanel, renderCoach } from './ui/coach-panel.js';

R.applyTheme(load('theme'));

initHud({ onCompactChange: () => { renderCoach(); updateMenuShift(false); } });
initMenu();
initInput();
initCoachPanel();
initPlayback();
initOnline();
initReview();

addEventListener('resize', () => {
  R.resize();
  layoutHud();
  updateMenuShift(false);
});
// un lien de partie ou d'invitation ouvert dans l'onglet du jeu : la page repart de ce lien
addEventListener('hashchange', () => { if (location.hash.length > 1) location.reload(); });

R.startRendering();
const link = readLink();
if (!link?.game && (link?.room || !restoreGame())) previewTerrain();
updateMenuButtons();
showModeOptions(); // les options en ligne ne s'affichent qu'en mode « à deux »
updateMenuShift(false);
// invitation dans l'adresse : on rejoint le salon ; sinon, reprise de la partie en ligne en cours
if (link?.room) joinFromLink(link.room);
else if (!link?.game) resumeOnline();

warmUpBot();
// le jeu répond aux commandes (utile aux tests de bout en bout : le menu est visible avant)
document.documentElement.dataset.ready = 'true';

// jeu hors ligne (public/sw.js) ; pas en développement, où chaque fichier doit venir du serveur de Vite
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
