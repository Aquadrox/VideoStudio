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

1. **Multi-Projets & Espace de Travail** : isolation par projet, ratio, FPS, résolution cible, statut.
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

- **Stade 1 (Implémenté)** : Socle monorepo + Docker Compose isolé + sécurité dépôt public (Gitleaks CI, `init-env.sh`, `CLAUDE.md`) + DAM Média (Sharp/FFmpeg/ComfyUI metadata) + Serveur MCP v1 (Streamable HTTP) + Web UI temps réel (Projets, Galerie, Live Jobs, Inspecteur, Flux Live, `@ref`).
- **Stade 2** : Comparateur A/B (images & vidéos synchronisées), annotations visuelles sur frames + Inbox Feedback MCP, **Listes de Règles (Rulebooks)** avec surcharge par projet, Bibliothèque de Prompts & Workflows ComfyUI, Hub Skills Claude Code.
- **Stade 3** : Scénarios versionnés, Bible de continuité, Storyboard drag & drop, Studio Audio (WaveSurfer, paroles, `.srt`/`.lrc`), Hub YouTube complet (Miniatures A/B, simulateur, métadonnées, chapitres, Export Pack).
- **Stade 4** : Animatique, Timeline multi-pistes (bascule Draft ↔ HQ), rendu serveur FFmpeg, export OpenTimelineIO / FCPXML / EDL, connecteur YouTube Data API v3 optionnel.
- **Stade 5** : Raccourcis pro (`Cmd+K`, J/K/L), gestion d'espace disque & purge sélective, sauvegardes automatisées et monitoring.
