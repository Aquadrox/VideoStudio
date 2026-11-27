# VideoStudio — Studio Vidéo Assisté par IA & Claude Code

Studio web auto-hébergé sur serveur local (Debian / Docker Compose) conçu pour collaborer en temps réel avec **Claude Code** via **MCP (Model Context Protocol)** et **ComfyUI**.

## Fonctionnalités (Stade 1 — Fondations, DAM Média & MCP Core)

- **Architecture Docker isolée** : PostgreSQL 16 strictement enfermé sur le réseau interne Docker (`videostudio-internal`, jamais exposé sur le LAN), passerelle Nginx unique pour l'interface web, l'API REST, les WebSockets et le serveur MCP.
- **Serveur MCP natif (`Streamable HTTP`)** :
  - Ressources : `studio://projects`, `studio://projects/{slug}/overview`, `studio://projects/{slug}/assets`, `studio://ref/{ref}`.
  - Outils : `list_projects`, `create_project`, `get_project_overview`, `register_asset` (URL LAN ComfyUI, base64 ou fichier), `list_assets`, `update_asset`, `resolve_reference`, `log_activity`, `start_job`, `update_job`.
- **Pipeline Média & ComfyUI** :
  - Extraction automatique des métadonnées ComfyUI embarquées (PNG chunks `tEXt`/`iTXt`/`zTXt` et tags vidéo) : prompts positifs/négatifs, modèle, LoRAs, seed, steps, CFG, sampler et graphe JSON complet.
  - Génération automatique des vignettes WebP/JPEG et proxies web légers (Sharp + FFmpeg) + streaming vidéo natif HTTP Range (`206 Partial Content`).
- **Suivi Temps Réel (WebSocket)** : chaque média ou tâche envoyée par Claude Code apparaît instantanément dans l'interface LAN.
- **Référencement Universel (`@ref`)** : chaque projet et média dispose d'un identifiant court (`@img-001`, `@vid-004-v2`) et d'une URI canonique (`studio://...`) copiables en 1 clic pour Claude Code.

## Démarrage rapide sur serveur Linux (Debian 13 + Docker)

### 1. Cloner le dépôt et générer la configuration locale sécurisée

```bash
git clone https://github.com/Aquadrox/VideoStudio.git
cd VideoStudio
./scripts/init-env.sh
```

Le script génère un fichier `.env` local (permissions `600`, ignoré par Git) avec un mot de passe PostgreSQL et un `MCP_AUTH_TOKEN` aléatoires.

### 2. Lancer la stack Docker Compose

```bash
docker compose up -d --build
```

L'interface graphique est alors accessible depuis tout appareil du réseau local :

```text
http://<IP-DE-TON-SERVEUR>:3100
```

### 3. Connecter Claude Code au serveur MCP VideoStudio

Sur le serveur local où tourne Claude Code :

```bash
claude mcp add --transport http videostudio http://localhost:3100/mcp \
  --header "Authorization: Bearer $(grep '^MCP_AUTH_TOKEN=' .env | cut -d= -f2)"
```

*(Si tu as modifié `STUDIO_PORT` dans `.env`, adapte le port `3100` en conséquence.)*

### 4. Ingestion depuis ComfyUI (PC sur le LAN)

Claude Code peut transmettre directement à `register_asset` une URL locale ComfyUI (ex. `http://<IP-PC-COMFYUI>:8188/view?filename=...`).
Pour restreindre les hôtes autorisés côté serveur, tu peux renseigner `ALLOWED_FETCH_HOSTS` dans ton `.env` local.

## Sécurité (Dépôt Public)

- **Ne jamais commiter `.env`**, ni aucune clé, IP personnelle ou média dans `data/`.
- PostgreSQL n'est **pas exposé** sur l'hôte Docker.
- Le workflow GitHub Actions (`.github/workflows/ci.yml`) exécute **Gitleaks** à chaque push/PR pour bloquer toute fuite accidentelle de secret.

## Développement local

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Voir le cahier des charges complet et les prochains stades (Stades 2 à 5) dans [docs/cahier-des-charges.md](docs/cahier-des-charges.md).
