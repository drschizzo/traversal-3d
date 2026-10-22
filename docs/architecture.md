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
  ui/        interface HTML : HUD, menu, panneaux, saisie, mise en page des explications
  i18n/      textes du jeu (le cœur ne produit que des codes)
  styles/    feuilles de style, une par zone de l'interface
  storage.js données gardées dans le navigateur (noms, formats, validation)
  config.js  réglages liés à l'hébergement (serveur des salons, guide)
  main.js    point d'entrée : assemble le tout et démarre
tests/     tests unitaires (Vitest) · e2e/ tests dans un navigateur (Playwright)
```

### Sens des dépendances

```
core  ←  engine (même règles, en Rust, vérifiées par tests/parity.test.js)
core  ←  server
core  ←  web/coach, web/bot  ←  web/session  ←→  web/ui
                     web/render  ←  web/session, web/ui
```

- `core/` ne dépend de rien et ne contient aucun texte ni accès au navigateur : il tourne aussi bien dans la page,
  le Worker du bot, le serveur et les tests.
- `web/render/` ne connaît ni les règles ni l'état de la partie : on lui donne des positions et des coups à montrer
  (façade `render/index.js`).
- `web/coach/` est pur : il renvoie des données (raisons, verdicts, notes) ; `web/ui/coach-view.js` et
  `review-view.js` les mettent en page. Le texte enrichi se limite à `**gras**`, converti par `ui/html.js`.
- `web/session/` et `web/ui/` s'appellent mutuellement (une action de l'interface lance un tour, un tour met
  l'interface à jour). Les modules n'exécutent rien à leur chargement : chacun expose une fonction `init…()`
  appelée par `main.js`, dans l'ordre.

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

Les calculs asynchrones sont rattachés à une portée (`session/bot.js`) : changer de partie, reprendre un coup ou
naviguer annule les calculs du bot en cours (le Worker est relancé) et invalide les suites en attente.

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
- `engine/traversal.wasm` est versionné ; la CI vérifie qu'il correspond au code (compilateur figé par
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
| une donnée gardée | une entrée dans `web/storage.js` |
| un niveau du bot | `web/bot/levels.js` |

## Vérifications

| Commande | Ce qu'elle vérifie |
|---|---|
| `npm run lint` | erreurs probables (ESLint) |
| `npm run typecheck` | types (JSDoc, TypeScript sans compilation) |
| `npm test` | règles, parité avec Rust, liens, moteur WebAssembly, explications, client du bot, phases, salons |
| `npm run e2e` | le jeu construit dans Chromium : bot contre bot, partie par lien et son analyse, partie en ligne |
| `cargo test` (dans `engine/`) | interface WebAssembly du moteur |

La CI (`.github/workflows/ci.yml`) lance tout cela à chaque push et vérifie que le WebAssembly publié correspond au code.
