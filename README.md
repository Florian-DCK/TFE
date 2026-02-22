# TFE - Risk-like Web Game (MVP 2 joueurs)

Jeu web de strategie type RISK, en temps reel, avec serveur autoritaire, persistance PostgreSQL, et carte SVG data-driven.

## 1. Stack technique

- Framework: `Next.js 16` (App Router)
- Frontend: `React 19` + `Tailwind CSS v4`
- Realtime: `Socket.IO` (`server.mjs` + `socket.io-client`)
- Backend game: serveur Node custom (`server.mjs`) + services metier (`app/lib/game/server.js`)
- Validation runtime: `Zod`
- Base de donnees: `PostgreSQL` + `Prisma`
- Auth/session: JWT cookie signe (`jose`)
- I18n routing: `next-intl`

## 2. Objectif MVP implemente

- Lobby multijoueur par code
- Lancement d une partie a 2 joueurs
- Partie persistee en base
- Actions en temps reel validees cote serveur:
  - `place_reinforcement`
  - `attack`
  - `fortify`
  - `end_turn`
- Detection de victoire
- UI jeu refondue:
  - banniere de tour
  - assistant d action contextuel
  - carte tactique avec connexions visibles
  - historique compact

## 3. Demarrage rapide

### Prerequis

- `Node.js 20+` (22 recommande)
- instance PostgreSQL accessible
- fichier `.env` avec:
  - `DATABASE_URL=...`
  - `SESSION_SECRET=...` (ou `SECRET`)

### Installation

```bash
npm install
```

### Prisma

```bash
npx prisma generate
npx prisma migrate dev --name init
```

Si la base existait deja avec un ancien schema, utilisez une base dev propre ou faites une migration/baseline adaptee.

### Lancer en dev

```bash
npm run dev
```

Serveur: `http://localhost:3000`

## 4. Parcours utilisateur

### Accueil

Route: `/fr`

Fonctionnalites:

- connexion / creation de compte (optionnel)
- mode invite avec pseudo par defaut
- saisir un code de salon
- creer un nouveau salon

### Lobby

Route: `/fr/lobby/[code]`

Fonctionnalites:

- liste des joueurs connectes
- choix de la carte (actuellement `world-simplified`)
- lancement de partie
- redirection auto vers `/fr/game/[gameCode]` quand la partie demarre

### Jeu

Route: `/fr/game/[code]`

Fonctionnalites:

- synchronisation temps reel de l etat
- selection source/cible sur la carte
- feedback d erreurs metier (adjacence, tour, etc.)
- etat compact des dernieres actions

## 5. Architecture backend jeud

### Principe

Serveur autoritaire:

- le client envoie des intentions
- le serveur valide les regles
- le serveur persiste et diffuse l etat (`game_state`)

### Fichiers cles

- `server.mjs`: serveur HTTP + Socket.IO + orchestration lobby/game
- `app/lib/game/server.js`: services jeu (creation partie, DTO, application des actions)
- `app/lib/game/rules.js`: regles simplifiees (des, adjacence, victoire, etc.)
- `app/lib/game/protocol.ts`: DTO + schemas Zod des messages
- `app/lib/game/maps/index.js`: chargement/validation des definitions de cartes

## 6. Modele de donnees Prisma

Tables principales:

- `Game`
  - code partie, statut, tour, joueur courant, map liee
- `GamePlayer`
  - seat, displayName, connexion, renforts, user optionnel
- `MapDefinition`
  - cle de map (`world-simplified`), version, `svgViewBox`
- `MapTerritory`
  - territoire d une map (`key`, `svgId`, `pathData`, adjacency, centroid, continent)
- `GameTerritoryState`
  - etat d un territoire dans une partie (owner, troops)
- `GameActionLog`
  - historique d actions

Legacy temporaire:

- `Territory` est encore present pour compatibilite migration, mais la logique map active passe par `MapDefinition` + `MapTerritory`.

## 7. Socket events

### Client -> Serveur

- `join_lobby`
- `leave_lobby`
- `start_game` (`{ lobbyCode, mapKey? }`)
- `join_game`
- `leave_game`
- `submit_action`

### Serveur -> Client

- `server_info`
- `maps_list`
- `lobby_state`
- `lobby_locked`
- `game_started`
- `joined_game`
- `game_state`
- `action_log`
- `action_rejected`
- `game_finished`

## 8. Carte data-driven (point central)

### Organisation des fichiers

- `app/lib/game/maps/world-simplified/definition.json`
  - verite metier de la map
- `app/lib/game/maps/world-simplified/master.svg`
  - source geometrique editable
- `public/maps/world-simplified/board.svg`
  - board servi au frontend (fond)

### Encodage d un territoire

Chaque territoire dans `definition.json` contient:

- `key`: identifiant metier unique (ex: `brazil`)
- `name`: label affichable
- `svgId`: id SVG attendu (`t-<key>`)
- `adjacency`: voisins directs
- `continent`
- `centroid`: `{ x, y }` (positions des badges/lignes)
- `pathData`: path SVG (`d`) utilise pour le hit/couleur cote jeu

### Regles de validation map

Validation via Zod + checks custom:

- unicite `key`
- unicite `svgId`
- `pathData` non vide
- adjacence symetrique (`A -> B` implique `B -> A`)
- graphe connexe
- chaque `svgId` existe bien dans `master.svg`

## 9. Pipeline SVG (Figma-friendly)

Figma n exporte pas toujours des IDs fiables. Le pipeline corrige ca automatiquement.

### Scripts disponibles

- `npm run map:fix-ids:world`
  - assigne les `id="t-..."` attendus dans `master.svg`
  - mapping par nom/id quand possible, fallback geometrique
- `npm run map:merge-paths:world`
  - fusionne les `<path>` du meme id en un seul `<path>` multi-sous-chemins
- `npm run map:export:world`
  - met a jour `definition.json` (`pathData`, `centroid`, `svgId`)
  - copie `master.svg` vers `public/maps/world-simplified/board.svg`
- `npm run map:master:world`
  - genere/reconstruit un `master.svg` depuis la definition (outil interne)

### Workflow recommande apres export Figma

```bash
npm run map:fix-ids:world
npm run map:merge-paths:world
npm run map:export:world
```

### Territoires multi-iles (un seul territoire logique)

Supporte via un seul `pathData` avec plusieurs sous-chemins:

- format: `M...Z M...Z ...`
- ou plusieurs `<path>` avec meme id, puis fusion via `map:merge-paths:world`

## 10. UI carte en jeu

`components/MapBoard.tsx`:

- rendu des territoires depuis `gameState.territories` (pas de carte hardcodee)
- fond via `board.svg`
- connexions visibles par defaut (opacite basse)
- survol/selection:
  - halo + lignes focus
  - cibles actionnables mises en evidence
  - territoires non pertinents estompes
- hit area renforcee via path transparent

## 11. Qualite / garde-fous

- validation d action cote serveur avec Zod
- controle de tour
- controle ownership source/cible
- controle adjacence
- rate limit simple sur `submit_action` (anti-spam)
- logs serveur structures pour actions

## 12. Optimisation latence (ce qui a ete fait, comment, pourquoi)

### Pourquoi

Le jeu etait percu comme lent car chaque action envoyait un `game_state` complet a tous les clients.
Ce snapshot contient toute la map + joueurs, donc payload lourd et rendu React plus couteux.

### Ce qui a ete fait

- Ajout d un event incremental: `action_applied`
- Le serveur envoie maintenant un patch minimal apres `submit_action`:
  - territoires modifies uniquement
  - joueurs modifies uniquement (renforts, territoryCount, isAlive)
  - meta partie si necessaire (`turnNumber`, `currentTurnPlayerId`, `status`, `winnerPlayerId`)
- Le client applique ce patch localement sur l etat courant.
- Le snapshot complet `game_state` reste utilise pour:
  - `join_game`
  - resynchronisations (disconnect/reconnect)

### Optimistic UI ajoute

- Le client applique immediatement l action en local (avant confirmation serveur).
- Chaque action est stockee dans une file `pending`.
- A reception de `action_applied`:
  - le patch serveur est applique a l etat confirme
  - l action en tete de file est retiree
  - l etat affiche est reconstruit (etat confirme + pending restants)
- A reception de `action_rejected`:
  - rollback de l action en tete de file
  - feedback erreur utilisateur
  - demande de resync via `join_game` pour recharger un snapshot serveur propre

### Fichiers modifies (perf)

- `app/lib/game/protocol.ts`
  - ajout `GameStatePatchDTO` + `action_applied`
- `app/lib/game/server.js`
  - `applyAction` retourne maintenant un `patch` minimal
- `server.mjs`
  - sur `submit_action`, emission de `action_applied` au lieu de renvoyer `game_state` complet
- `components/GameClient.tsx`
  - merge incremental du patch via `applyGamePatch`
  - moteur optimistic + rollback/rebuild (`applyOptimisticAction`)

### Impact attendu

- baisse du trafic socket par action
- mise a jour UI plus rapide (moins de donnees a reconciler)
- meilleure sensation de reactivite sans casser le modele serveur autoritaire

## 13. Commandes utiles

```bash
# dev
npm run dev

# qualite
npm run lint
npm run build

# prisma
npx prisma generate
npx prisma migrate dev

# map
npm run map:fix-ids:world
npm run map:merge-paths:world
npm run map:export:world
```

## 14. Mise en ligne VPS (setup actuel)

Ce projet tourne en production sur un VPS avec:

- Node.js 22
- service `systemd` (`tfe.service`)
- Nginx en reverse proxy vers l app Node (`127.0.0.1:3000`)
- PostgreSQL heberge sur Neon (via `DATABASE_URL`)

### Pre-requis VPS

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### Code + dependencies

```bash
cd /var/www
sudo mkdir -p tfe
sudo chown $USER:$USER tfe
cd tfe
git clone <REPO_GIT> .
npm ci
```

### Variables d environnement

Utiliser le meme format `.env` que le dev local:

```env
DATABASE_URL="postgresql://...neon..."
SECRET='...'
```

Le serveur lit `SECRET` (fallback de `SESSION_SECRET`) dans `server.mjs`.

### Prisma (cas base Neon deja non vide)

Si `prisma migrate deploy` remonte `P3005` (schema non vide), baseliner la migration initiale:

```bash
npx prisma migrate resolve --applied 20260221170000_risk_mvp
npx prisma migrate deploy
```

Puis build:

```bash
npx prisma generate
npm run build
```

### Service systemd

Fichier: `/etc/systemd/system/tfe.service`

```ini
[Unit]
Description=TFE Next + Socket.IO
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/tfe
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

Activation:

```bash
sudo systemctl daemon-reload
sudo systemctl enable tfe
sudo systemctl start tfe
sudo systemctl status tfe
```

Logs:

```bash
journalctl -u tfe -f
```

### Nginx sans domaine (acces par IP)

Fichier: `/etc/nginx/sites-available/tfe`

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Activation:

```bash
# Si Apache ecoute deja sur le port 80, le stopper
sudo systemctl stop apache2
sudo systemctl disable apache2

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/tfe /etc/nginx/sites-enabled/tfe
sudo nginx -t
sudo systemctl restart nginx
```

Verification:

```bash
curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1
```

- App: `http://<IP_VPS>/fr`
- Socket.IO: passe via Nginx sur `/socket.io`

### Mise a jour de prod

```bash
cd /var/www/tfe
git pull
npm ci
npx prisma migrate deploy
npm run build
sudo systemctl restart tfe
```

## 15. Depannage rapide

- Erreur Prisma `table ... does not exist`:
  - executer migration Prisma sur la bonne base (`DATABASE_URL`)
- Erreur Next lock `.next/dev/lock`:
  - fermer l autre process `next dev` puis relancer
- Erreur `Missing <path id="t-..."> in master.svg`:
  - lancer `map:fix-ids:world`, puis `map:export:world`
- Erreur de mapping SVG instable:
  - nommer les layers Figma au plus proche des keys metier
  - appliquer workflow map complet (fix + merge + export)

## 16. Problemes rencontres

### Lenteur des actions en jeu

Probleme observe:

- chaque action etait suivie d un `game_state` complet emis a tous les clients
- ce snapshot complet (joueurs + 42 territoires + logs) augmentait la latence percue
- l interface donnait une impression de reponse lente apres clic

Cause technique:

- payload socket trop volumineux pour une operation qui modifie souvent seulement 1 a 2 territoires
- reconciliation React inutilement large a chaque action

Correction appliquee:

- passage a un flux incremental `action_applied`
- envoi d un patch minimal:
  - territoires modifies
  - joueurs modifies (renforts, territoryCount, isAlive)
  - meta partie (`turnNumber`, `currentTurnPlayerId`, `status`, `winnerPlayerId`) si necessaire
- application directe du patch cote client (`applyGamePatch`)
- conservation de `game_state` complet pour `join_game` et resync

Resultat:

- meilleur temps de reaction percu sur les actions
- reduction du trafic socket par action
- aucune perte du modele serveur autoritaire
- actions visibles instantanement cote client (optimiste)

Limites restantes:

- les des d attaque optimistes peuvent diverger du serveur (corriges par patch/resync)
- pas encore de resync automatique periodique en cas de divergence silencieuse

## 17. Editeur de map (guide pratique)

Route: `/fr/map-editor`

L editeur sert a construire une map jouable a partir d un SVG (paths), puis exporter:

- `definition.json` (modele metier utilise par le serveur)
- `*-grouped.svg` (SVG fusionne par territoires logiques)

### Flux recommande

1. Cliquer sur `Importer SVG` et charger le fichier source.
2. Verifier `Map key`, `Nom`, `Version`, `ViewBox`.
3. Creer les groupes de territoires si un meme territoire est compose de plusieurs iles (`Grouper A+B`).
4. Creer les connexions entre territoires (`Creer/Supprimer connexion A-B`).
5. Affecter chaque territoire a un continent (panel `Continent` a droite).
6. Ajuster les centroids (`Auto centroid A`, `Auto centroid tous`, ou `Placer centroid A`).
7. Cliquer sur `Generer JSON` puis copier le contenu dans `definition.json`.
8. Cliquer sur `Exporter SVG groupe` et sauver le resultat en `master.svg`.

### Selection et navigation

- Clic sur un path:
  - selectionne le groupe si le path appartient a un groupe de taille > 1
  - sinon selectionne le territoire seul
- `Ctrl`/`Cmd` + clic: force la selection solo (meme si groupe).
- Clic sur le centroid: selectionne le groupe.
- Re-clic sur la meme selection A/B: deselection.
- Pan:
  - `Shift + drag` n importe ou sur la carte
  - ou drag sur fond vide
- Zoom:
  - molette souris dans la carte
  - la page ne zoome pas pendant ce zoom carte

### Affichages utiles

- `Liens`: affiche les connexions.
- `Centroids`: affiche/masque les centroids.
- `Continents`: colorie les paths selon leur continent (gris si non assigne).
- Les liens survoles passent au dessus des autres elements.

### Groupes et centroids

- Un groupe represente un seul territoire logique en jeu.
- Un groupe doit avoir un nom/key unique coherent.
- Les membres d un groupe partagent le meme centroid logique.
- `Degrouper A` rend chaque path independant (un territoire par path).

### Continents

Panel `Continents`:

- `Ajouter` cree un continent.
- Champs par continent:
  - `Key` (identifiant technique)
  - `Nom`
  - `Bonus` (renfort de continent)
  - `Couleur` (color picker + valeur texte)

Panel `Territoires` (territoire A selectionne):

- `Key du territoire`
- `Nom du territoire`
- `Continent` (liste deroulante)

### Sauvegarde locale anti-refresh

L etat de l editeur est sauvegarde automatiquement dans `localStorage` (cle `map_editor_state_v1`):

- map meta (`mapKey`, `mapName`, `version`, `viewBox`)
- territoires/continents
- selections A/B et mode group/solo
- zoom/pan et toggles d affichage

Pour repartir de zero:

- vider `localStorage` du site (ou supprimer la cle `map_editor_state_v1`)
- ou reimporter un nouveau SVG propre

### Integrer une nouvelle map dans le jeu

1. Creer un dossier: `app/lib/game/maps/<map_key>/`
2. Mettre:
   - `app/lib/game/maps/<map_key>/definition.json`
   - `app/lib/game/maps/<map_key>/master.svg`
3. Respecter:
   - nom de dossier = `mapKey`
   - `mapKey` en snake_case minuscule (ex: `bridgerton_map`)
4. Redemarrer le serveur dev/prod.

Si erreur `Unknown map key "<x>"`:

- le dossier `app/lib/game/maps/<x>/` n existe pas, ou
- le fichier `definition.json` manque dans ce dossier.

Si erreur `Unexpected end of JSON input`:

- `definition.json` est vide ou tronque (JSON invalide).

## 18. Roadmap naturelle (V2)

- bonus de continents
- cartes objectifs
- reconnexion plus robuste / reprise de session in-game
- selection de plusieurs maps en production
- ameliorations editeur de map (snapping, validation UX avancee)
