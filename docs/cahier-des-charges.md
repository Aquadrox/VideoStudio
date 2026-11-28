# Cahier des Charges — VideoStudio (Studio Vidéo Assisté par IA & Claude Code)

> **Version** : 1.1 — Validée (architecture verrouillée pour Debian 13 + Docker Compose).

---

## 1. Décisions d'Architecture Validées

| Axe | Décision verrouillée |
| :--- | :--- |
| **Stack technique** | Monorepo TypeScript unifié (`pnpm workspaces`) : **React 19 + Vite** (Web UI), **Fastify + `@modelcontextprotocol/sdk`** (API, WS, MCP), **PostgreSQL 16 + Drizzle ORM**, **Sharp + FFmpeg**. |
| **Hébergement & Déploiement** | Serveur local **Linux Debian 13 (amd64)** via **Docker Compose** — PostgreSQL strictement isolé dans le réseau interne Docker (jamais exposé sur l'hôte/LAN). |
| **Transfert ComfyUI (PC) → VideoStudio (Serveur)** | Ingestion via **API / MCP** (URL LAN ComfyUI, base64 ou multipart upload) avec garde-fou SSRF et extraction auto des métadonnées PNG/MP4. |
| **Emplacement Claude Code** | Exécuté sur le **serveur local** (connexion MCP directe sur `http://localhost:<STUDIO_PORT>/mcp` en Streamable HTTP, accès direct au stockage local pour les Skills en Stade 2). |
| **Sécurité Dépôt Public** | Zéro secret/clé/IP/média dans Git, `.env.example` uniquement, script `scripts/init-env.sh`, Bearer auth constant-time, scan anti-secrets **Gitleaks** en CI GitHub Actions. |

---

## 2. Vision & Modules Fonctionnels (Stades 1 à 5)

1. **Multi-Projets, Dépôt Git & GitHub par Projet** : isolation par projet, ratio, FPS, résolution cible, statut ; **chaque projet vidéo dispose de son propre dépôt Git local et peut être lié à son propre dépôt GitHub** (versionning propre des scénarios, storyboards, surcharges de règles, prompts, skills projet, métadonnées YouTube et manifestes, avec `.gitignore` dédié excluant les médias lourds bruts ou gestion sélective).
2. **Suivi Temps Réel (Live Studio)** : WebSocket diffusant en direct chaque création, mise à jour et progression de job lancée par Claude Code via MCP.
3. **Système de Référencement Universel (`@ref` & `studio://`)** : identifiants copiables en 1 clic (`@img-001`, `@vid-004-v2`, `@proj-slug`) résolus instantanément par Claude via MCP.
4. **Pré-production** *(Stade 3)* : scénarios versionnés avec diff, Bible de continuité (personnages, lieux, styles), découpage scènes/plans et Storyboard visuel.
5. **Atelier Images & Vidéos (Itération & Review)** : lignée parent → enfant (`v1 → v2`), pipeline **Basse Résolution (Draft) → Haute Résolution (HQ)**, comparateur Side-by-Side/Slider et annotations visuelles sur frames *(Stade 2)*, extraction auto métadonnées ComfyUI *(Stade 1)*.
6. **Studio Audio & Paroles** *(Stade 3)* : pistes musique/voix/SFX, lecteur waveform (WaveSurfer.js), éditeur de paroles structuré, synchronisation `.lrc`/`.srt` et repères lip-sync.
7. **Listes de Règles (Rulebooks)** *(Stade 2)* : bibliothèque globale de contraintes (ex. *mains à 5 doigts* vs *mains à 4 doigts*), assignation et surcharge par projet, exposées résolues à Claude via MCP.
8. **Bibliothèque de Prompts & Workflows ComfyUI** *(Stade 2)* : templates à variables, négatifs modulaires, catalogue de workflows `.json`.
9. **Hub des Skills Claude Code** *(Stade 2)* : gestion, versioning et synchronisation des `SKILL.md` directement sur le serveur local.
10. **Assemblage, Animatique, Timeline & Export NLE** *(Stade 4)* : animatique jouable, timeline proxy/HQ, rendu FFmpeg serveur, export `.otio` (DaVinci Resolve) / `.fcpxml` / `.edl`.
11. **Hub YouTube & Packaging** *(Stade 3 & 4)* : galerie miniatures accessibles + A/B testing (3 variantes) + simulateur feed YouTube (zones masquées), titres/descriptions/tags/chapitres auto, export « YouTube Ready Pack » et upload brouillon optionnel YouTube Data API v3.

---

## 3. Feuille de Route & Livrables

- **Stade 1 (`v0.1.0` — Implémenté)** : Socle monorepo + Docker Compose isolé + sécurité dépôt public (Gitleaks CI, `init-env.sh`, `CLAUDE.md`) + DAM Média (Sharp/FFmpeg/ComfyUI metadata) + Serveur MCP v1 (Streamable HTTP) + Web UI temps réel (Projets, Galerie, Live Jobs, Inspecteur, Flux Live, `@ref`).
- **Stade 2 (`v0.2.0` — Implémenté)** : Comparateur A/B (images & vidéos synchronisées), annotations visuelles sur frames + Inbox Feedback MCP, **Listes de Règles (Rulebooks)** avec surcharge par projet, Bibliothèque de Prompts & Workflows ComfyUI, Hub Skills Claude Code avec sync disque.
- **Stade 3 (`v0.3.0` — Implémenté)** : **Dépôt Git local & intégration GitHub par projet**, Scénarios versionnés avec Diff, Bible de continuité, Storyboard Scènes/Plans, Studio Audio & Paroles (waveform, marqueurs lip-sync, LRC → SRT), Hub YouTube complet (Miniatures A/B, simulateur, métadonnées, chapitres, Export Pack) et script de mise à jour non-destructif `scripts/update.sh`.
- **Stade 4 (`v0.4.0` — Implémenté)** : Animatique jouable depuis le Storyboard, Timeline multi-pistes (bascule Draft Proxy ↔ HQ Master), rendu serveur FFmpeg MP4 avec progression/ETA temps réel, export OpenTimelineIO (`.otio`) / FCPXML (`.fcpxml`) / EDL (`.edl`), contrôle visuel serveur (QC badges, `get_frame`, `contact_sheet`), `CLAUDE LIVE` avec ETA temps réel & sous-étapes, drainage zéro-coupure Blue/Green et opérations MCP en lot idempotentes.
- **Stade 5 (`v0.5.0` — Implémenté)** : Raccourcis pro (`Cmd/Ctrl+K`, `?`, `A`/`R`/`1-5`, `J`/`K`/`L`, `←`/`→`), onglet **Exploitation** (monitoring CPU/RAM/disque/Blue-Green, gestion d'espace disque & nettoyage sélectif non-destructif avec aperçu dry-run, sauvegardes automatisées + `scripts/backup.sh`, Watch Folders ComfyUI auto-ingest), webhooks sortants signés HMAC-SHA256 et upload brouillon optionnel YouTube Data API v3.
- **Stade 6 (`v0.6.0` → `v0.8.2` — Implémenté)** : Atelier **Croquis & Plans de Scène** (caméras FOV, personnages Bible, ligne 180°, dessin main levée, Feuille blanche, plein cadre + zoom/plein écran), **Storyboard Croquis** côte à côte lié bidirectionnellement à Pré-prod, **Éditeur texte enrichi** (`.md`, `.txt`, `.log`, `.json`, `.srt`), refonte README + captures HD et icône officielle VideoStudio.
- **Stade 7 (`v0.9.0` — Implémenté)** : **Dossier de Production & Export PDF / Pitch Deck** (Portrait A4 / Paysage, HTML autonome, Markdown, archivage `/exports`, MCP `export_production_dossier`), **Timeline NLE v2** (glisser-déposer & trim direct des clips, aimantation Snap, waveforms audio Web Audio API, marqueurs BPM/Suno LRC, aperçu temps réel des transitions Crossfade/Fondu au noir) et **Sous-titres synchronisés SRT/VTT & Burn-in FFmpeg** (piste `S1`, éditeur synchronisé, incrustation live + rendu MP4 burn-in, MCP `get_subtitles`/`save_subtitles`/`export_subtitles_srt`).
- **Stade 8 (`v0.10.0` — Implémenté)** : **Mémoire IA & Base de Connaissances Commune par Type de Projet** (`studio_knowledge`, onglet **Mémoire IA**, Playbooks compilés par type de projet, rappel automatique au `create_project` et via `recall_project_playbook`, apprentissage continu via `learn_studio_knowledge` / `studio://knowledge`, validation humaine et promotion 1-clic vers les règles du projet actif).
- **Stade 9 (`v0.11.0` → `v0.12.0` — Implémenté)** : **Studio de Montage Vidéo complet façon CapCut, Lecteur Canvas WYSIWYG AMV & Effets Custom IA/Utilisateur** (montage multi-couches `V/OV/T/A/S`, lecteur `<canvas>` 16:9 temps réel avec caméra beat-sync, Cinémascope, FX AMV additifs & toggle FX Preview ON/OFF, découpe Razor `S`, vitesse `0.25×–4×`, Transform/Keyframes, étalonnage couleur, 11 transitions `xfade`, bibliothèque d'effets paramétrables IA/utilisateur, rendu serveur identique Python Pillow/NumPy + FFmpeg avec cache SHA-256 `projects/<slug>/cache/timeline_segments/<sha256>.mp4`, aperçu rapide de plage `render_timeline_range`, édition chirurgicale batch `patch_timeline_clips` et 11 outils MCP dédiés — 97 outils au total).
