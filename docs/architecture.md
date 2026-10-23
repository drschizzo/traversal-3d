# Architecture

Ce document décrit comment le code est organisé, et où ajouter une évolution sans toucher au reste.

## Vue d'ensemble

```
core/      règles du jeu, terrain, coups, liens de partie, protocole en ligne    pur · partagé · testé
engine/    moteur du bot en Rust → engine/traversal.wasm                       contrat : engine/layout.json
server/    Worker Cloudflare : salons en ligne (room.js pur, worker.js adaptateur) et fichiers du jeu
web/       le jeu (Vite)
  bot/       client du moteur : Worker, file de demandes annulables, cache par position
  coach/     explication et jugement des coups, progression                    pur · testé
  render/    scène 3D (Three.js) : plateau, pièces, décor, effets, caméra, boucle de rendu
  session/   déroulement d'une partie : état, phases, modes, tours, en ligne, lecture, analyse
    view.js    ce que la session annonce à l'interface (le seul lien entre les deux)   pur · testé
    scope.js   portées des calculs : un AbortSignal par partie, par analyse, par variante   pur · testé
  ui/        interface HTML : HUD, menu, panneaux, saisie, mise en page des explications
    bindings.js ce que l'interface fait de chaque annonce (abonnements, en un seul endroit)
  i18n/      textes du jeu (le cœur ne produit que des codes)
  styles/    feuilles de style, une par zone de l'interface
  colors.js  couleurs des camps, partagées par la scène 3D et l'interface
  storage.js données gardées dans le navigateur (noms, formats, validation)
  config.js  réglages liés à l'hébergement (serveur des salons, guide)
  main.js    point d'entrée : assemble le tout et démarre
tests/     tests unitaires (Vitest) · e2e/ tests dans un navigateur (Playwright)
```

### Sens des dépendances

```
core  ←  engine (même règles, en Rust, vérifiées par tests/parity.test.js)
core  ←  server
core  ←  web/coach, web/bot  ←  web/session  ←  web/ui
                     web/render  ←  web/session, web/ui
                     web/session  ──annonces──→  web/ui
```

- `core/` ne dépend de rien et ne contient aucun texte ni accès au navigateur : il tourne aussi bien dans la page,
  le Worker du bot, le serveur et les tests.
- `web/render/` ne connaît ni les règles ni l'état de la partie : on lui donne des positions et des coups à montrer
  (façade `render/index.js`).
- `web/coach/` est pur : il renvoie des données (raisons, verdicts, notes) ; `web/ui/coach-view.js` et
  `review-view.js` les mettent en page. Le texte enrichi se limite à `**gras**`, converti par `ui/html.js`.
- `web/session/` n'importe aucun module de `web/ui/` : le sens est à sens unique. L'interface appelle la session
  (une action du joueur lance un tour) ; la session, elle, **annonce** ce qui change (`session/view.js`) et
  `ui/bindings.js` dit ce que l'interface en fait. Un module de session se charge donc sans DOM, et se teste en
  s'abonnant à ses annonces. Les modules n'exécutent rien à leur chargement : chacun expose une fonction `init…()`
  appelée par `main.js`, dans l'ordre — les abonnements d'abord.
- L'état reste dans `S` (`session/store.js`) : une annonce dit *que* quelque chose a changé, et le module de `ui/`
  qui l'écoute relit `S`. Elle ne transporte que ce qui n'est pas dans `S` (le texte d'un message, par exemple).

## La session de jeu

### L'état : `session/store.js`

Tout l'état de l'interface est dans un seul objet, `S` (partie affichée, historique, lecture, vue, sélection,
analyse…), à côté de `cfg` (choix du menu) et `play` (réglages figés de la partie en cours). Pour savoir qui modifie
une donnée, chercher `S.nom`.

### Les phases : `session/phase.js`

Ce que la partie attend tient en une phase : `idle`, `intro`, `human`, `bot`, `paused`, `remote`, `sending`,
`animating`, `judging`, `coach`, `over`, `review`, `puzzle`. Les phases de tour (`human`, `bot`, `paused`, `remote`,
`over`…) sont choisies par `nextTurn()` et peuvent suivre n'importe quelle phase ; les autres n'ont que quelques
prédécesseurs, et une transition imprévue est signalée dans la console. `phase.busy()` dit si le joueur peut agir.

Les calculs asynchrones sont rattachés à une portée (`session/scope.js`, ouvertes par `session/bot.js`) :
changer de partie, reprendre un coup ou naviguer annule les calculs du bot en cours (le Worker est relancé) et
invalide les suites en attente. Un seul mécanisme, l'`AbortSignal` : on saisit la portée au début d'une suite
asynchrone, puis on s'arrête si elle a été abandonnée.

```js
const { signal } = gameScope;   // portée du moment
await R.animateMove(m, before);
if (signal.aborted) return;     // la partie affichée a changé : plus rien à faire ici
```

Il y a trois portées : la partie affichée (`gameScope`), l'analyse de fin de partie (`reviewScope`) et, fille de
la seconde, la variante rejouée sur le plateau — une portée fille tombe avec sa mère.

### Les modes : `session/modes.js`

Chaque mode (`bot`, `pvp`, `bvb`, `online`) déclare ses capacités : occupe-t-on une couleur, peut-on reprendre un
coup, demander un conseil, y a-t-il une lecture automatique, l'adversaire est-il distant… Le reste du code interroge
ces capacités (`mode().undo`, `mode().remote`) au lieu de tester le nom du mode.

## Le bot

- `engine/` : recherche negamax en Rust, compilée en WebAssembly (`engine/build.sh`). Le tampon d'échange entre
  le jeu et le moteur est décrit une seule fois dans `engine/layout.json`, lu par `build.rs` côté Rust et importé
  par `web/bot/wasm-bridge.js` ; le moteur expose `layout_version()` et le jeu refuse un moteur d'une autre version.
- `web/bot/client.js` : file de demandes servie par un Web Worker, avec priorités (coup du bot, puis conseil, puis
  analyse de partie), annulation (`AbortSignal`) et cache des analyses par clé de position (`core/position.js`).
- `engine/traversal.wasm` est versionné ; la CI vérifie, quand on la lance, qu'il correspond au code (compilateur figé par
  `engine/rust-toolchain.toml`).

## Le serveur

`server/room.js` contient les décisions d'un salon (places, coups, abandon, revanche) sans rien de Cloudflare ;
`server/worker.js` gère les WebSockets, le stockage SQLite du Durable Object et l'expiration. Le protocole
(`core/protocol.js`) est versionné : un client d'une autre version est invité à recharger la page. Le serveur ne
renvoie que des codes, traduits par `web/i18n/fr.js`.

## Données dans le navigateur

`web/storage.js` déclare chaque entrée (nom, format, valeur par défaut, validation) : thème, qualité, entraînement,
partie en cours, progression, session en ligne. Les noms sont ceux des versions précédentes, pour garder les données
des joueurs.

## Textes

Le cœur, le serveur et le moteur ne produisent aucun texte. `web/i18n/fr.js` regroupe le vocabulaire du jeu
(pièces, camps, terrains, niveaux), les raisons de fin de partie et les messages du serveur. Les phrases de
l'interface restent dans le module qui les affiche ; celles des explications (`coach/explain.js`,
`coach/wording.js`) sont écrites pour le français (accords, articles) : une autre langue demanderait sa propre
version de ces deux modules.

## Ajouter…

| Évolution | Où |
|---|---|
| une règle, une variante | `core/rules.js` et `engine/src/game.rs`, puis `tests/rules.test.js` ; `tests/parity.test.js` vérifie que les deux concordent |
| un mode de jeu | une entrée dans `session/modes.js` ; s'il a un déroulement propre, son module (comme `session/online.js`) appelé par `nextTurn` |
| un thème | une entrée dans `render/themes.js` (format documenté en tête du fichier) |
| un effet, une surface | `render/` (GLSL dans `render/glsl/`) |
| une raison d'expliquer un coup | `coach/explain.js`, rattachée à un thème de `coach/topics.js` |
| un message en ligne | `core/protocol.js` (et `PROTOCOL` si sa forme change), `server/room.js`, `session/online.js` |
| quelque chose à afficher depuis la session | une annonce dans `session/view.js`, son abonnement dans `ui/bindings.js` |
| une donnée gardée | une entrée dans `web/storage.js` |
| un niveau du bot | `web/bot/levels.js` |

## Vérifications

| Commande | Ce qu'elle vérifie |
|---|---|
| `npm run lint` | erreurs probables (ESLint) |
| `npm run typecheck` | types (JSDoc, TypeScript sans compilation) |
| `npm test` | règles, parité avec Rust, liens, moteur WebAssembly, explications, client du bot, phases, portées, annonces, salons |
| `npm run e2e` | le jeu construit dans Chromium : bot contre bot, partie par lien et son analyse, partie en ligne |
| `cargo test` (dans `engine/`) | interface WebAssembly du moteur |

Ces vérifications se lancent en local avant de pousser. La CI (`.github/workflows/ci.yml`) fait la même chose, en
vérifiant aussi que le WebAssembly publié correspond au code, mais seulement quand on la lance à la main
(onglet *Actions* de GitHub) : Cloudflare déploie chaque push sur `main` sans l'attendre.
