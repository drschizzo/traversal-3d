# Traversal 3D

Une adaptation en 3D (Three.js) du jeu de stratégie **Traversal**, jouable dans le navigateur à deux joueurs sur le même écran ou contre un bot.

🎮 **Jouer directement en ligne : [traversal-online.drschizzo.workers.dev](https://traversal-online.drschizzo.workers.dev/)**

![Une partie sur le thème Crépuscule : l'Explorateur sélectionné montre ses déplacements possibles et le chemin survolé](docs/gameplay.jpg)

> ### ⚠️ Les règles ne sont pas de moi
> **Traversal** est un jeu original dont les règles, le concept et le nom appartiennent à leurs créateurs.
> Ce dépôt est un projet de fan, **non officiel et sans lien** avec eux : une simple réimplémentation
> visuelle réalisée par passion, à partir des règles publiées sur leur site.
>
> 👉 **Découvrez, jouez et soutenez le jeu original sur [traversalgame.com](https://www.traversalgame.com/)**
> — règles officielles, tutoriel interactif, parties en ligne et générateur de plateaux pour l'édition physique :
> [www.traversalgame.com/rules](https://www.traversalgame.com/rules)
>
> 🎬 J'ai découvert le jeu grâce à la vidéo d'Ilyas, [« Le jeu qui va écraser les échecs (Traversal) »](https://www.youtube.com/watch?v=QkmivBpoRbw) :
> une excellente présentation pour le découvrir à votre tour.

---

## Le jeu en bref

Traversal se joue sur une grille de 10×10 cases de hauteurs différentes : un paysage de montagnes et de vallées.
Chaque joueur dispose de six pièces et doit leur faire traverser le plateau, puis sortir par le bord opposé.
Chaque pièce arrivée rapporte sa Force. Dès que deux pièces (tous camps confondus) ont franchi l'arrivée, le meilleur score l'emporte.

| Pièce | Mouvement | Force | Particularité |
|---|---|---|---|
| ⬟ Explorateur | 5 | 1 | Pas en diagonale ou bond de 2 cases, sans coût de hauteur |
| ◆ Avant-garde | 4 | 2 | +1 en attaque si le plus court chemin vers la cible coûte exactement 4 |
| ▲ Sentinelle | 3 | 3 | Victoire immédiate si elle est la toute première pièce à arriver |

- Un pas coûte **1 + la différence de hauteur**. On ne traverse aucune pièce.
- Attaquer, c'est entrer sur la case ennemie. L'attaque n'est permise que si **Attaque ≥ Défense** :
  la hauteur (±1), les alliés adjacents et les renforts du défenseur comptent.
- Limite de 200 coups.

Les règles complètes et officielles sont sur [traversalgame.com/rules](https://www.traversalgame.com/rules).

## Ce que propose cette version

- **Trois modes** : 2 joueurs en local ou en ligne, contre un bot (facile, moyen, difficile, expert), ou **bot contre bot**
  pour regarder jouer le bot le plus fort : pause, coup par coup, et navigation dans les coups déjà joués
  (◀ ▶ ou flèches du clavier) avec l'analyse de chacun, pendant ou après la partie.
- **Jouer à deux en ligne** : *À deux* → *Créer un salon* donne un code de six lettres et un lien d'invitation ;
  l'adversaire choisit *Rejoindre* ou ouvre simplement le lien. Sans compte : un onglet rechargé ou une connexion
  coupée reprend la partie là où elle en était, et une revanche peut être proposée en fin de partie.
- **Parties par lien** : le bouton 🔗 *Lien* copie une adresse qui contient toute la partie (monde et coups joués,
  ~550 caractères pour 200 coups). L'ouvrir affiche la position, prête à continuer : pratique pour jouer par
  correspondance, partager une position ou reprendre une partie sur un autre appareil.
- **Apprendre du bot** : le panneau *Analyse* donne en tête l'idée de chaque coup du bot (gagner un tour dans la
  course des Sentinelles, capturer, mettre une pièce à l'abri…), puis, repliés, les autres raisons, les chances de gain,
  la suite qu'il prévoit (numérotée sur le plateau), les coups écartés et la courbe d'évaluation. Les pièces sont
  nommées sans coordonnées (« votre Sentinelle de gauche ») et chaque coup cité se trace sur le plateau au survol ou au toucher.
- **Conseil en trois temps** : au tour d'un joueur humain, *Conseil* donne d'abord une piste, puis la pièce à jouer,
  puis seulement le coup et son explication.
- **Entraînement** : avec le bouton 🎓, chaque coup du joueur est jugé aussitôt. Après une erreur ou une gaffe, le bot
  attend : on peut voir pourquoi, reprendre le coup ou continuer.
- **Analyse de partie** : en fin de partie (contre le bot ou à deux), chaque coup humain est noté
  (meilleur coup, excellent, bon, imprécision, erreur, gaffe) en le comparant au meilleur coup du moteur.
  Le bilan compte les coups solides et met en avant les moments clés : pour chacun, ce qui s'est passé (la réponse
  adverse), ce qu'il fallait jouer, la suite rejouée sur le plateau, et un exercice pour retrouver soi-même un
  meilleur coup. Les fautes sont rangées par thème, avec le principe du [guide de stratégie](docs/guide-strategie.md)
  à travailler ; la progression d'une partie à l'autre s'affiche dans le menu.
- **Un bot rapide** : c'est un moteur écrit en Rust et compilé en WebAssembly (`engine/`), qui tourne dans un Web Worker :
  negamax alpha-bêta avec table de transpositions, ~1 million de positions/s dans le navigateur,
  une dizaine de coups d'avance en niveau difficile.
- **Plateaux générés** avec 6 modes de terrain (aléatoire, montagnes, vallées, hautes terres, bois, désert)
  et 2³² graines, soit plus de 25 milliards de mondes possibles. Chaque partie affiche son numéro de monde.
- **Interface d'aide** : cases accessibles, chemin et coût au survol, détail du combat attaque contre défense,
  fiche de pièce, annulation, affichage des hauteurs, règles intégrées.
- **8 thèmes visuels** : Crépuscule, Atelier (bois), Lagon, Braise, Givre, Ardoise, Marbre & or, Néon.
  Chacun a sa matière de case procédurale, son décor, ses particules et son post-traitement.
- **Décor « espace des possibles »** : le plateau joué se dresse au milieu d'un pavage infini d'autres plateaux,
  rendu en raymarching volumétrique et brumeux, qui se transforme lentement.
- **Pensé pour la fluidité** : vise 120 images/s. Le décor est rendu en demi-résolution, les ombres ne sont
  recalculées que quand quelque chose bouge, et les particules sont animées sur GPU.
- **Qualité graphique adaptée à l'appareil** (menu → Personnaliser) : haute, moyenne, basse ou *auto*.
  En auto, le jeu démarre en qualité moyenne sur mobile et baisse d'un cran s'il tourne sous 45 images/s.
  Le niveau bas rend la scène sans post-traitement, avec un décor allégé et moins de particules.

![Le thème Atelier, inspiré de la version en bois imaginée à l'origine pour le jeu](docs/atelier.jpg)

## Guide de stratégie

Le [guide de stratégie](docs/guide-strategie.md) rassemble les principes que l'on peut tirer de 13 000 parties jouées
par le bot contre lui-même : course des Sentinelles, valeur des pièces, combat, défense, géographie du plateau,
particularités de chaque terrain.

## Lancer le jeu

Le projet n'a aucune étape de build : ce sont des modules ES, avec Three.js chargé depuis un CDN.
Il faut simplement le servir en HTTP (ouvrir `index.html` directement ne fonctionne pas, à cause des modules et du Web Worker) :

```bash
python3 serve.py        # puis ouvrir http://localhost:8765
```

`serve.py` est un petit serveur local qui désactive le cache du navigateur, pratique pendant le développement.
N'importe quel serveur statique convient aussi, par exemple `python3 -m http.server`.

### Serveur des parties en ligne

Les salons tournent sur Cloudflare Workers avec un Durable Object par salon (`server/`), qui importe `game.js`
tel quel et valide chaque coup. Le même Worker sert aussi les fichiers du jeu : pages et salons sont alors sur
la même origine. Rien n'est facturé quand personne ne joue (hibernation des WebSockets), et l'offre gratuite
suffit largement.

Le jeu choisit son serveur de salons tout seul (en tête de `net.js`) :

| Page servie depuis | Salons utilisés |
|---|---|
| `localhost:8787` (`wrangler dev`) ou un domaine `*.workers.dev` | la même origine |
| n'importe où ailleurs (GitHub Pages, `serve.py`, autre hébergeur) | la constante `DEFAULT_SERVER` |
| n'importe où, avec `?server=https://…` dans l'adresse | le serveur indiqué |

#### Tester en local

Il faut Node.js (18 ou plus). `wrangler dev` simule localement le Worker, les Durable Objects et leur stockage
SQLite : aucun compte Cloudflare n'est nécessaire.

```bash
cd server
npm install        # une seule fois : installe wrangler
npx wrangler dev   # ou : npm run dev
```

Le jeu complet et les salons sont alors servis sur **http://localhost:8787** : sur ce port, le jeu utilise les
salons locaux. Servi autrement (par `serve.py` sur le port 8765, par exemple), il s'adresse au serveur de
`DEFAULT_SERVER` ; `?server=http://localhost:8787` dans l'adresse force le serveur local. Le Worker se recharge
tout seul quand `server/worker.js` ou `game.js` change ; les fichiers du jeu sont relus à chaque requête.
Les salons créés sont gardés dans `server/.wrangler/` (supprimer ce dossier repart de zéro).

Pour jouer contre soi-même :

1. Ouvrir http://localhost:8787, choisir *À deux* → *Créer un salon*, puis *Créer le salon* : un code s'affiche.
2. Dans un second onglet (ou une fenêtre privée), ouvrir `http://localhost:8787/#r=CODE`, ou choisir
   *Rejoindre* et saisir le code. La partie démarre dans les deux onglets.
3. Recharger un onglet en cours de partie teste la reconnexion : *Reprendre la partie* ramène à la position
   en cours.

Deux onglets du même navigateur partagent le `localStorage` où est gardée la session en ligne : après un
rechargement, c'est la place du dernier onglet à s'être connecté qui est reprise. Une fenêtre privée, ou un autre
navigateur, garde les deux joueurs bien séparés. Depuis un téléphone du même réseau Wi-Fi, lancer
`npx wrangler dev --ip 0.0.0.0` et ouvrir `http://<adresse-IP-de-l'ordinateur>:8787`.

#### Héberger sa propre version

Pour mettre en ligne votre copie du dépôt avec les parties en ligne, il suffit d'un compte Cloudflare
(l'offre gratuite convient) et d'un déploiement depuis `server/` :

```bash
cd server
npx wrangler login    # une seule fois : ouvre le navigateur pour autoriser le compte
npx wrangler deploy   # publie le Worker, les salons et le jeu
```

`wrangler deploy` affiche l'adresse obtenue, de la forme `https://<nom-du-worker>.<votre-sous-domaine>.workers.dev`.
Le nom du Worker est le champ `name` de `server/wrangler.jsonc` (`traversal-online` ici) : changez-le si vous
préférez une autre adresse, un même compte pouvant héberger plusieurs Workers. Le sous-domaine, lui, est celui
de votre compte, choisi à sa création.

Cette adresse sert à la fois le jeu et les salons : si vous ne publiez le jeu que là, il n'y a rien d'autre à
régler. Si vous l'hébergez **aussi** ailleurs (GitHub Pages, un autre hébergeur statique), mettez l'adresse de
votre Worker dans la constante `DEFAULT_SERVER`, en tête de `net.js` — sans quoi cette copie créerait ses salons
sur le serveur d'origine.

Le déploiement peut ensuite être automatisé à chaque push grâce à **Workers Builds**, l'intégration Git de
Cloudflare (*Workers & Pages* → votre Worker → *Settings* → *Build*) :

| Réglage | Valeur |
|---|---|
| Dépôt | votre dépôt, branche `main` |
| Répertoire racine (*Root directory*) | `server` |
| Commande de build | *(vide)* |
| Commande de déploiement | `npx wrangler deploy` |

Enfin, posez une alerte de dépense sur le compte Cloudflare et surveillez la métrique de durée des
Durable Objects les premières semaines : c'est elle qui décide de la facture si beaucoup de parties sont jouées.

### Recompiler le bot

Le fichier `engine/traversal.wasm` est fourni ; il ne faut le recompiler qu'après avoir modifié le moteur Rust :

```bash
rustup target add wasm32-unknown-unknown   # une seule fois
engine/build.sh
```

Le même crate fournit un banc d'essai natif multi-thread (`engine/src/bin/selfplay.rs`) :

```bash
cd engine && cargo build --release
./target/release/selfplay match games=400 a.nodes=100000 b.nodes=100000 b.legacy=1   # comparer deux réglages
./target/release/selfplay gen games=1000 nodes=100000 out=parties.jsonl            # parties pour les statistiques
python3 analysis/analyze.py parties.jsonl                                          # rapport statistique
```

## Commandes

- **Clic** sur une de vos pièces pour la sélectionner, puis sur une case en surbrillance pour jouer.
- **Glisser** pour tourner la caméra, **molette** pour zoomer.
- **Cmd/Ctrl + Z** pour annuler, **Échap** pour désélectionner.
- En bot contre bot, **← →** pour revoir les coups déjà joués.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Interface (HUD, menus, styles) |
| `main.js` | Rendu Three.js : plateau, pièces, décor, effets, post-traitement, interactions |
| `game.js` | Moteur de règles (pur, sans DOM) et générateur de terrain |
| `ai-worker.js` | Web Worker du bot : charge `engine/traversal.wasm`, renvoie le coup et son analyse |
| `coach.js` | Explication des coups à partir de l'analyse du moteur : idée, raisons par thème, pièces nommées sans coordonnées (*Analyse*, *Conseil*) |
| `review.js` | Jugement des coups humains (entraînement, analyse de partie) : notes, réponse adverse, moments clés, exercices, bilan |
| `engine/` | Moteur du bot en Rust (règles, recherche, évaluation), banc d'essai et analyses statistiques |
| `match.js` | Sérialisation compacte d'une partie (monde et coups) pour les liens, et relecture des coups |
| `net.js` | Client des parties en ligne : création de salon, WebSocket, reconnexion |
| `server/` | Worker Cloudflare et Durable Object `Room` des parties en ligne (`wrangler.jsonc`) |
| `ai.js` | Ancien bot en JavaScript, utilisé en secours si le WebAssembly ne se charge pas |
| `themes.js` | Définition des thèmes (palettes, matières, effets), documentée en tête de fichier |
| `serve.py` | Serveur de développement sans cache |

## Crédits

- **Jeu original, règles et concept** : [Traversal](https://www.traversalgame.com/). Tous droits réservés à leurs auteurs.
- **Découverte du jeu** : la vidéo [« Le jeu qui va écraser les échecs (Traversal) »](https://www.youtube.com/watch?v=QkmivBpoRbw) d'[Ilyas](https://www.youtube.com/@Ilyas-he9di).
- **Moteur 3D** : [Three.js](https://threejs.org/).
- **Polices** : Space Grotesk et Inter (Google Fonts).
- Cette adaptation a été développée avec l'aide de [Claude Code](https://claude.com/claude-code).

## Licence

Le code de ce dépôt est distribué sous [licence MIT](LICENSE).
Elle ne couvre que cette réimplémentation : le nom **Traversal**, les règles et le concept du jeu restent la propriété
de leurs créateurs ([traversalgame.com](https://www.traversalgame.com/)).
