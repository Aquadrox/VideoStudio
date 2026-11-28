# Changelog

All notable changes to **VideoStudio** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.12.0] - 2026-11-28

### Added
- **Lecteur Temps Réel WYSIWYG `<TimelinePreviewCanvas>` (`apps/web/src/components/TimelinePreviewCanvas.tsx`, `packages/shared/src/amv-engine.ts`)** :
  - Moniteur `<canvas>` 16:9 synchronisé sur le temps `t` de la piste audio à 60 fps (`requestAnimationFrame`), exécutant exactement la même logique déterministe (PRNG FNV-1a + Mulberry32 basé sur `clipId + frameIndex`) que le moteur de rendu serveur.
  - Rendu temps réel de la caméra dynamique (`static`, `push`, `ease`, `pull_back`, `power_pullback`, `crash_zoom`, `p05_vertigo`, `pan`, `z0/z1`, `cx/cy`, `rotDeg`, `beatPulseAmp` sur les downbeats audio, `shakeAmp`, `tremorAmp`), `fx.mangaBlink` (encre N&B contrastée + inversion 1 frame sur 2), `radialSpeedLines`, `horizSpeedLines` (`left/right/diag_up/vert_down`), `particles` (orbes lumineux en mode additif `lighter`), `flashIn`, `fadeOutBlack`, pistes `text` enrichies (`subtitle`, `fontFamily`, `strokeColor`, `glowColor`, `fadeInSec/fadeOutSec`), couches PiP/overlays et bandes noires **Cinémascope** (`bar0 → bar1` en `easeInOutCubic`) dessinées par-dessus tout.
  - Toggle **« FX Preview ON/OFF »** dans la barre du lecteur + inspecteurs visuels caméra / Cinémascope / FX AMV structurés / textes enrichis dans `CapCutClipInspector`.
- **Édition chirurgicale batch `patch_timeline_clips` & Aperçu rapide de plage `render_timeline_range` (total : 97 outils MCP)** :
  - **`patch_timeline_clips`** (`POST /api/projects/:id/timeline/patch`) : modifier 1 à N clips précis par `clipId` ou `title` sans ré-envoyer toute la timeline (`replace_asset`, `update`, `move`, `reorder` avec `ripple: true`, `insert`, `delete`).
  - **`render_timeline_range`** (`POST /api/projects/:id/timeline/render-range` + bouton **Plage** dans l'UI) : rend uniquement l'extrait `[startSec, endSec]` avec audio synchronisé en réutilisant le cache de segments et archive dans `renders/previews`.
- **Moteur Serveur Identique (`render_amv_segment.py` + fallback FFmpeg) & Cache par Segment SHA-256** :
  - Script serveur Python Pillow + NumPy (`apps/server/scripts/render_amv_segment.py`, `python3-pil`/`python3-numpy` dans `docker/Dockerfile.server`) partageant exactement le même PRNG et les mêmes équations caméra/Cinémascope/FX que le Canvas Web, avec repli FFmpeg automatique.
  - Stockage du cache par segment dans **`projects/<slug>/cache/timeline_segments/<sha256>.mp4`** (invalidation sur `assetId`, `assetUpdatedAt`, `inSec`, `outSec`, `durationSec`, `camera`, `cinemascope`, `fx`, `flashIn`, `beatTimes`, `resolution`, `fps`, `renderEngine`).
- **Couverture de tests de non-régression étendue (44 fichiers, 152 tests)** : ajout de `amv-engine.test.ts`, `stage4.service.test.ts`, `effects.service.test.ts`, `capcut-preview.test.ts`, et extension de `effects-utils.test.ts`, `nle-export.test.ts`, `stage4.routes.test.ts`, `mcp.routes.test.ts`.

## [0.11.0] - 2026-11-28

### Added
- **Studio de Montage Vidéo complet façon CapCut (`TimelinePanel`, `EffectsLibraryDrawer`, `CapCutClipInspector`, `Stage4Service`, `effects-schemas.ts`, `effects-utils.ts`)** :
  - **Architecture Studio 3 colonnes** : panneau **Ressources CapCut** à gauche (`Médias`, `Effets`, `Transitions`, `Textes`), **Moniteur de compositing temps réel** au centre et **Inspecteur de clip à onglets** à droite (`Base / Transform / Vitesse`, `Couleur`, `FX`, `Audio`, `Texte`, `Keyframes`).
  - **Multi-pistes avancé & outils CapCut** : pistes **Vidéo (`V1+`)**, **Overlay / PiP (`OV`)**, **Textes (`T`)**, **Audio multi-pistes (`A1+`)** et **Sous-titres (`S1`)** ; outil **Couper / Razor (`S`)**, **Dupliquer**, **Ripple Delete**, **Undo / Redo**, **Vitesse (`0.25×`–`4×`)**, **Transform**, **Étalonnage couleur**, **11 transitions FFmpeg `xfade`**, **Keyframes** et **mixage multi-pistes audio**.
- **Bibliothèque d'Effets Custom Partagée IA & Utilisateur (`video_effects`, `EffectsService`, `effects.routes.ts`)** : 12 effets pro intégrés + création d'effets par l'IA (MCP) ou l'utilisateur (UI) avec validation anti-injection FFmpeg.
- **9 nouveaux outils MCP (total : 95 outils)** + ressource `studio://effects` et `fonts-dejavu-core` dans `docker/Dockerfile.server`.

## [0.10.0] - 2026-11-28

### Added
- **Mémoire IA & Base de Connaissances Commune par Type de Projet (`KnowledgePanel`, `KnowledgeService`, `knowledge.routes.ts`, `knowledge-schemas.ts`, `knowledge-utils.ts`, table additive `studio_knowledge`)** :
  - Nouvel onglet dédié **« Mémoire IA »** commun à tous les projets pour pérenniser les **Règles**, **Prompts validés**, **Skills / Procédures**, **Presets techniques ComfyUI** et **Leçons / Retours d'expérience**, ciblés par **type de projet** (`Global`, `YouTube Long`, `YouTube Short`, `Clip Musical`, `Animation`, `Publicité`, `Expérimental`).
  - **Apprentissage continu via MCP** : 5 nouveaux outils MCP (**`recall_project_playbook`**, **`learn_studio_knowledge`**, **`list_studio_knowledge`**, **`update_studio_knowledge`**, **`delete_studio_knowledge`**) et 2 ressources MCP (`studio://knowledge`, `studio://playbooks/{projectType}`).
  - **Rappel automatique au lancement d'un projet** : `create_project` rappelle automatiquement le **Playbook Studio** correspondant au type du projet créé (et `recall_project_playbook` agrège la Mémoire commune + Rulebooks + Prompt Templates + Workflows ComfyUI + Skills `SKILL.md` dans un brief compilé, tout en incrémentant les compteurs de rappel).
  - **Validation humaine & promotion 1-clic** : badges `Appris par IA` / `Vérifié` / `Épinglé`, compteur `Rappelé N×`, vue **Playbook par Type de Projet** avec copie 1-clic, bouton **« Appliquer au projet actif »** pour injecter directement une règle apprise dans le projet courant, et guide/snippet prêt à copier dans `CLAUDE.md`.
- **Barre d'avancement des imports & file d'upload en temps réel (`UploadQueueTray`, `upload-queue.ts`, `api.uploadAssetFile`)** :
  - Suivi octet par octet via `XMLHttpRequest` lors du **glisser-déposer** ou de l'import multi-fichiers (vidéos, images, audio, docs) : barre de progression globale pondérée + liste détaillée par fichier.
  - Distinction claire entre **`En attente`**, **`Envoi en cours (X% · Mo envoyés / total · vitesse Mo/s · ETA)`**, **`Traitement serveur (vignette, proxy FFmpeg & métadonnées…)`**, **`Terminé ✓`** (cliquable pour inspecter directement l'asset) et **`Erreur`**, avec bouton **Annuler** par fichier.

## [0.9.0] - 2026-11-28

### Added
- **Dossier de Production & Export PDF / Pitch Deck (`ProductionDossierModal`, `DossierService`, `dossier-utils.ts`, `dossier.routes.ts`)** :
  - Génération en 1 clic d'un **Dossier de Production A4 (Portrait)** ou d'un **Pitch Deck (A4 Paysage)** combinant couverture cinéma, **Bible de continuité**, **Scénario**, **Planche Storyboard Croquis**, **Découpage technique Pré-prod**, **Briefs IA** et **Prompts/LoRAs**.
  - Aperçu en direct dans la modale accessible depuis **Pré-prod** et **Storyboard Croquis**, impression/export **PDF** natif, téléchargement **`.html` autonome** (images embarquées) ou **`.md`**, et archivage direct dans Médias `/exports`.
  - Outil MCP **`export_production_dossier`** pour Claude Code.
- **Timeline NLE v2 — Édition directe, Waveforms, Beats Suno/LRC & Aperçu Transitions (`TimelinePanel`, `TimelineWaveform`, `timeline-v2-utils.ts`)** :
  - **Glisser-déposer direct** des clips sur la timeline et **redimensionnement (Trim In/Out)** par poignées gauche/droite avec sauvegarde automatique au relâchement.
  - **Aimantation (Snap)** intelligente sur les bords de clips, la tête de lecture et les marqueurs rythmiques (`Alt` pour désactiver ponctuellement) + guide vertical doré + scrubbing direct sur la règle temporelle.
  - **Formes d'onde audio (Waveforms)** rendues directement dans les blocs audio (`Web Audio API` + cache) et **marqueurs BPM / Paroles Suno LRC** sur la règle et les pistes.
  - **Aperçu temps réel des transitions** (`Crossfade` et `Fondu au noir`) dans le moniteur vidéo avec durée réglable.
- **Sous-titres synchronisés (SRT / VTT / LRC) & Incrustation FFmpeg Burn-in (`SubtitleEditorPanel`, `subtitle-utils.ts`, `Stage4Service`, table additive `project_subtitles`)** :
  - Piste dédiée **`S1 · Sous-titres`** dans la timeline (blocs déplaçables et rognables) + **incrustation cinéma en direct** sur le moniteur vidéo avec style personnalisable (position, taille, couleur, opacité de fond).
  - Éditeur complet synchronisé au curseur (`+ Au curseur`, boutons `In`/`Out`, import depuis **Storyboard**, **Suno/LRC**, ou collage `.srt`/`.vtt`/`.lrc`, export `.srt`/`.vtt` et sauvegarde dans Médias `/subtitles`).
  - Option **`Burn-in ST`** lors du **Rendu MP4 FFmpeg** serveur (`burnSubtitles: true`) pour incruster directement les sous-titres dans la vidéo rendue.
  - Outils MCP **`get_subtitles`**, **`save_subtitles`**, **`export_subtitles_srt`** et paramètre `burnSubtitles` sur **`render_timeline`**.

## [0.8.2] - 2026-11-28

### Added
- **Icône officielle VideoStudio & jeu complet de favicons (`apps/web/public/`, `apps/web/index.html`)** :
  - Création de l'icône vectorielle **clap de cinéma ambre & graphite** (`favicon.svg`), déclinée en `favicon.ico` multi-résolutions (`16/32/48px`), `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` (`180×180`), `icon-192.png`, `icon-512.png`, ainsi que `site.webmanifest` et `<meta name="theme-color" content="#0d1017">` pour les onglets navigateur, favoris et raccourcis bureau/mobile.

## [0.8.1] - 2026-11-28

### Fixed & Improved
- **Atelier Croquis & Plans — Ouverture plein cadre, zoom fluide & mode Plein écran (`SketchStudioPanel`, `studio.css`)** :
  - Correction de l'ouverture initiale du canvas (qui démarrait dézoomé à `300×150px` jusqu'au premier trait) : le canvas calcule désormais automatiquement sa taille optimale via `ResizeObserver` pour occuper **100 % de la zone disponible dès l'ouverture**, dans le respect exact du ratio du projet (`16:9`, `9:16`, `2.39:1`, etc.).
  - **Zoom / Dézoom facile (`35%` à `300%`)** : contrôles `-` / `100%` / `+` dans la barre inférieure, raccourcis clavier `+` / `-` / `0`, et **`Ctrl/Cmd + Molette`** directement sur la zone de dessin avec défilement fluide lorsque zoomé.
  - **Agrandissement de la zone de dessin** : bouton **« Agrandir / Plein écran »** (`F` / `Échap`) pour passer l'atelier en plein écran sans quitter le projet, ainsi qu'un bouton dédié pour **masquer / réafficher l'inspecteur droit** de l'atelier.
- **Documentation & Captures d'écran (`README.md`, `docs/screenshots/`)** :
  - Refonte complète du `README.md` avec guide d'installation pas à pas (Docker Compose, `.env`, LAN, montages ComfyUI, Claude Code MCP), guide d'utilisation complet par module, raccourcis clavier, mises à jour Blue/Green sans coupure et **6 captures d'écran** haute définition de l'interface.

## [0.8.0] - 2026-11-27

### Added
- **Storyboard de Croquis (planche côte à côte), Feuille blanche & liaison bidirectionnelle Pré-prod (`SketchStoryboardView`, `SketchStudioPanel`, `PreprodPanel`, `SketchService`)** :
  - **Mode Feuille blanche à main levée** : bouton rapide **« Feuille blanche »** + sélecteur de papier (`Sombre`, `Feuille blanche`, `Papier crème`, `Ardoise`), encre noire/graphite/couleurs storyboard, et adaptation automatique du contraste des guides (`Grille`, `Règle des tiers`, `Safe Frames`) sur fond clair.
  - **Planche Storyboard Croquis (côte à côte)** : nouvelle vue intégrée à l'atelier permettant de placer ses croquis et plans les uns à côté des autres (`2 / 3 / 4 colonnes` ou **bande horizontale**), réordonner par **Drag & Drop** ou flèches `←`/`→`, éditer la **légende/action** et la **durée (s)** sous chaque case, et **exporter toute la planche en PNG** (téléchargement local ou stockage direct dans Médias `/storyboard`).
  - **Liaison bidirectionnelle totale avec le Storyboard Pré-prod** :
    - Depuis l'atelier ou la planche : lier un croquis à un **Plan Pré-prod** existant, créer directement un nouveau plan dans Pré-prod, ou **« Tout pousser vers Pré-prod »** en 1 clic (toute retouche ultérieure du croquis met automatiquement à jour la vignette `keyframeAssetId` du plan lié !).
    - Depuis le **Storyboard dans Pré-prod** : bandeau d'accès rapide au Storyboard Croquis + boutons **« Dessiner un croquis »** (ouvre une feuille blanche pré-liée au plan), **« Éditer le croquis »**, et sélecteur **« + Lier croquis… »** sur chaque plan.
  - **API REST & MCP** : `PATCH /api/projects/:id/sketches/board-order`, `POST /api/sketches/:id/link-shot`, `POST /api/projects/:id/sketches/sync-to-storyboard`, colonnes additives `in_sketch_board` / `board_order` / `duration_sec` / `caption`, et nouvel outil MCP **`get_sketch_storyboard`** pour Claude Code.

## [0.7.0] - 2026-11-27

### Added
- **Éditeur enrichi & lecteur de fichiers texte dans l'interface (`TextDocumentEditorModal`, `TextDocumentPreview`, `text-document-utils.ts`)** :
  - Prise en charge de tous les fichiers texte usuels : `.md`, `.markdown`, `.txt`, `.log`, `.json`, `.yaml`/`.yml`, `.toml`, `.ini`, `.srt`, `.vtt`, `.lrc`, `.csv`, `.xml`, `.html`, `.css`, `.js`/`.ts`, `.py`, `.sh`, `.sql`, `.fountain`, `.prompt`, etc.
  - **Éditeur enrichi complet** : barre de mise en forme Markdown (`H1/H2/H3`, gras, italique, barré, code inline/bloc, listes, checklists `- [ ]`, citations, tableaux GFM, liens, séparateurs), bascule **Éditer / Split (édition + aperçu enrichi côte à côte) / Lecture**, numéros de lignes synchronisés, **Rechercher & Remplacer (`Ctrl+F`)**, formatage & validation JSON en 1 clic, **visionneuse `.log` colorée par niveau** (`ERROR`, `WARN`, `INFO`, `DEBUG`) avec filtres cliquables, Word Wrap, statistiques live (lignes, mots, caractères, taille UTF-8) et sauvegarde **`Ctrl/Cmd+S`** sur place ou en **nouvelle version (`v2`)** (avec protection automatique des fichiers externes `ingest://` en lecture seule).
  - **Intégration Médias, Inspecteur & Lightbox** : filtre **`Docs`** dans la barre Médias, bouton **« Nouveau texte »** (et commande `Cmd/Ctrl+K`) pour créer un document directement dans le dossier courant, aperçu enrichi directement dans `AssetInspector` et `MediaLightbox`, et ouverture instantanée au double-clic sur un document texte.
  - **Endpoints REST & Outils MCP** : `GET/PUT /api/assets/:id/content`, `POST /api/projects/:id/documents`, ainsi que les outils MCP `read_text_asset` et `save_text_asset` pour Claude Code.

## [0.6.0] - 2026-11-27

### Added
- **Atelier « Croquis & Plans de Scène » (`SketchStudioPanel`, `sketch-renderer.ts`, `SketchService`, `sketch.routes.ts`)** :
  - **Mode Plan de scène / Blocking (vue du dessus)** : placement interactif de **Caméras** (avec cône de champ FOV temps réel selon la focale `24/35/50/85/135mm`, valeur de plan `EWS..INSERT` et mouvement caméra `Dolly In`, `Orbite`, `Travelling`, `Pan`, `Tilt`, `Grue`, `Handheld`, etc.), **Personnages** (avec ajout en 1 clic depuis la **Bible de continuité**, pose, action et direction du regard), **Lumières** (`Key`, `Fill`, `Rim`, `Practical`), **Décors & Accessoires** (`Mur`, `Table`, `Porte`, `Fenêtre`, `Repère X`, `Zone`, `Véhicule`), **Trajectoires de mouvement** droites ou courbes (arc/orbite) et **Ligne des 180°** de continuité.
  - **Mode Croquis Storyboard à main levée (vue cadre)** : **Crayon/Pinceau** lissé, **Marqueur/Surligneur**, **Gomme**, **Formes** (`Flèche`, `Ligne`, `Rectangle`, `Cercle`, cadres **Zoom In / Zoom Out** aux 4 coins façon Storyboarder), **Annotations texte**, **Guides de cadrage cinéma** (`Grille`, `Règle des tiers 3×3`, `Diagonales`, `Croix`, `Safe Frames 90/80`) et **Image de fond (Underlay)** à opacité réglable pour dessiner directement par-dessus un média existant du projet.
  - **Modèles rapides pré-configurés** (*Dialogue 180°*, *Travelling d'approche Dolly In*, *Orbite héroïque*, *Plan d'ensemble + entrée personnage*), **Annuler/Rétablir** (`Ctrl+Z` / `Ctrl+Shift+Z`) et poignée de rotation directe sur le canvas.
  - **Brief IA automatique (`generateAiDirectorBrief`)** : synthétise en direct le placement spatial, les focales, les mouvements caméra/personnages et l'éclairage en un brief prêt à copier pour Claude Code ou ComfyUI (et automatiquement stocké dans `notes` et `promptUsed` de l'asset).
  - **Stockage dans Médias & Ré-édition après coup** : export PNG haute définition adapté au ratio du projet dans `/plans` ou `/croquis` (avec versionnage `v1 → v2` ou remplacement), table PostgreSQL additive `sketches`, bouton **« Éditer le plan / croquis »** et **« Dessiner dessus »** directement depuis l'`AssetInspector`.
  - **Outils MCP dédiés (`list_sketches`, `get_sketch`, `save_sketch`)** : Claude Code peut lister, lire le `sceneData` structuré + le brief IA par UUID ou `@ref`, et créer/mettre à jour un plan de scène programmatiquement.

## [0.5.4] - 2026-11-27

### Added
- **Suppression d'assets via MCP (`delete_asset`, `delete_assets_batch`)** :
  - Ajout de `delete_asset(ref, project?, force?)` et `delete_assets_batch(refs[], project?, force?)` dans `mcp-server.ts` pour supprimer un ou plusieurs médias par `@ref`, `studio://` URI ou UUID (avec suppression DB + fichiers gérés dans `DATA_DIR`, sans jamais toucher les fichiers sources externes `ingest://` / `ingest-root://`).
  - Garde-fou de sécurité : les médias `approved`, `winner` ou `final_master` sont protégés par défaut et exigent explicitement `force: true`.
  - Diffusion temps réel `folders.changed` en complément de `asset.deleted` lorsque l'asset supprimé se trouvait dans un sous-dossier.

## [0.5.3] - 2026-11-27

### Added
- **Panneaux latéraux gauche et droite redimensionnables & masquables (`App.tsx`, `panel-layout.ts`, `studio.css`)** :
  - Séparateurs interactifs (`.panel-resizer`, curseur `↔`) permettant d'ajuster librement la largeur du panneau **Projets** (gauche) et de l'**Inspecteur / Live** (droite) avec garde-fou sur l'espace central, double-clic pour réinitialiser la largeur par défaut et ajustement clavier (`←`/`→`).
  - Boutons dédiés pour **masquer / ré-afficher** chacun des panneaux depuis l'en-tête central (et depuis la barre latérale/inspecteur), raccourcis **`Ctrl/Cmd+B`** (panneau gauche) et **`Ctrl/Cmd+Shift+B`** (panneau droit), commandes dans la Palette `Cmd/Ctrl+K`, et persistance automatique dans `localStorage`.

## [0.5.2] - 2026-11-27

### Added
- **Modes d'affichage dans Médias (`MediaListViews`, `AssetCard`, `App.tsx`)** : sélecteur persistant (`localStorage`) pour basculer entre **Miniatures**, **Grandes miniatures**, **Liste compacte** et **Détails (tableau complet triable)**, tout en conservant la multi-sélection, le drag & drop groupé vers les dossiers et la lightbox au double-clic.
- **Vue « Modifications & ajouts récents » (`media-view.ts`, `App.tsx`)** : bouton rapide **Récents** (avec badge compteur sur 24h et sélecteur de période `1h` / `24h` / `7j`) qui rassemble les médias récemment ajoutés ou modifiés sur tous les dossiers du projet, affiche des pastilles distinctes **Ajouté** / **Modifié** + horodatage relatif + lien cliquable vers le dossier, et ajoute un sélecteur de tri global (`Récents modifiés`, `Récents ajoutés`, `Nom A→Z`, `Note ★`, `Taille`).

## [0.5.1] - 2026-11-27

### Added
- **Multi-sélection & déplacement groupé des médias vers les dossiers (`AssetCard`, `App.tsx`, `drag.ts`)** :
  - Sélection multiple dans la galerie via **cases à cocher** sur les cartes, **`Ctrl/Cmd+clic`**, **`Shift+clic`** (sélection par plage), bouton **« Tout sélectionner »** (`Ctrl/Cmd+A`) et **`Échap`** pour effacer la sélection.
  - **Drag & Drop groupé** : glisser l'un des médias sélectionnés déplace l'ensemble de la sélection vers une carte de sous-dossier, le fil d'Ariane (`Racine`, ancêtres, `Parent`) ou la barre d'accès rapide de tous les dossiers du projet (avec indicateur du nombre de médias transportés).
  - **Barre d'actions groupées** (`.bulk-selection-bar`) avec sélecteur de dossier de destination et bouton **« Déplacer ici »** en 1 clic.
- **Drag & Drop des médias dans les dossiers (`AssetCard`, `App.tsx`, `drag.ts`)** : possibilité de glisser-déposer un média directement sur une carte de sous-dossier, sur le fil d'Ariane ou sur la barre d'accès rapide des dossiers, ainsi que d'importer un fichier externe directement en le déposant sur un dossier cible.

## [0.5.0] - 2026-11-27

### Added
- **Stage 5 — Pro Polish, Exploitation, Automated Backups, Watch Folders, Outgoing Webhooks & Optional YouTube Draft Upload (`OpsPanel`, `CommandPalette`, `OpsService`, `WatchFolderService`, `WebhookService`, `YouTubeUploadService`, Closes #7)**:
  - **Pro Keyboard Shortcuts & Command Palette (`Cmd/Ctrl+K`, `?`)**: Added fuzzy Command Palette to jump across projects, all 11 studio modules, `@ref` assets, and quick actions (new project, instant backup, MCP setup, shortcuts help), plus `?` shortcuts cheat-sheet modal, quick triage (`A` approve, `R` needs revision, `1`–`5` rating), and pro video transport (`J`/`K`/`L` shuttle & `←`/`→` frame-by-frame stepping).
  - **Server Health & Resource Monitoring (`GET /api/ops/metrics`)**: Added **Exploitation** tab showing active Blue/Green slot, version, uptime, `inFlightRequests`, WebSocket clients, PostgreSQL & FFmpeg availability, CPU load/cores, host RAM & Node RSS, filesystem free/total space, and YouTube API configuration status.
  - **Disk Space Management & Non-Destructive Selective Cleanup (`GET /api/ops/disk`, `POST /api/ops/cleanup/preview|run`)**: Added per-project & per-folder (`originals`/`proxies`/`thumbnails`/`.tmp`/`backups`) usage breakdown with Dry-Run preview and safe selective purge of old rejected/archived test assets — strictly blocking `approved`, `winner`, `final_master`, and zero-copy `ingest://` / `ingest-root://` references.
  - **Automated Backups (`GET/POST/DELETE /api/ops/backups`, `scripts/backup.sh`)**: Added in-app backup creation (`pg_dump` + full JSON metadata snapshot with redacted webhook secrets + synced `skills/` archive in `BACKUP_DIR`), download/delete endpoints, and a Debian cron-ready `scripts/backup.sh` with `--retain-days` retention.
  - **Watch Folders (`watch_folders`, `/api/ops/watch-folders/*`)**: Added optional ComfyUI → VideoStudio auto-ingest watch folders restricted to `INGEST_ALLOWED_DIR` / `INGEST_EXTRA_DIRS`, with settle-delay protection, background polling, and manual **Scanner** trigger.
  - **Outgoing Webhooks (`webhooks`, `/api/ops/webhooks/*`)**: Added project-scoped & global HTTP POST webhooks with SSRF host validation (`assertSafeFetchUrl`), optional HMAC-SHA256 signing (`X-VideoStudio-Signature: sha256=...`), masked secrets (`hasSecret`), connectivity test button, and automatic emission on `annotation.created`, `asset.created`, `asset.status_changed`, `job.completed`, `job.failed`, `timeline.rendered`, and `backup.completed`.
  - **Optional YouTube Data API v3 Draft Uploader (`GET /api/youtube/upload/status`, `POST /api/projects/:id/youtube/upload-draft`)**: Added zero-dependency OAuth2 refresh-token resumable video upload defaulting to `private` (or `unlisted`) drafts with A/B title & thumbnail pickers, auto-formatted chapters, hashtags, and `containsSyntheticMedia` AI disclosure (configured strictly via local `.env`).
  - **Stage 5 MCP Tools**: Added `get_system_health_and_disk`, `preview_disk_cleanup`, `run_disk_cleanup`, `create_backup`, `list_watch_folders`, `create_watch_folder`, `list_webhooks`, `create_webhook`, and `upload_youtube_draft`.

## [0.4.0] - 2026-11-27

### Added
- **Stage 4 — Multi-Track NLE Timeline, Animatic, FFmpeg Render & NLE Export (`TimelinePanel`, `Stage4Service`, Closes #6)**:
  - Added additive `timeline_tracks`, `timeline_clips`, and `timeline_renders` tables plus `projects.timeline_quality_mode`.
  - Built playable in-browser **Timeline** tab (`TimelinePanel`) with synchronized animatic preview, multi-track `V1`/`A1` sequencer, 1-click Storyboard → Animatic builder, **Draft Proxy ↔ HQ Master** toggle with automatic lineage swapping, background server-side **FFmpeg MP4 render** (live Job progress + ETA, auto-registered into `/renders`), and 1-click **OpenTimelineIO (`.otio`)**, **Final Cut Pro XML (`.fcpxml`)**, and **CMX 3600 (`.edl`)** exports.
  - Added Stage 4 MCP resource (`studio://projects/{slug}/timeline`) and tools (`get_timeline`, `save_timeline`, `build_animatic_from_storyboard`, `switch_timeline_quality`, `render_timeline`, `export_nle`).
- **Live ETA Countdown, Sub-Steps & ComfyUI Job Tracking (`ClaudeLiveBar`, `StudioService`)**:
  - Added `etaSeconds`, `estimatedCompletionAt`, `stepCurrent`, `stepTotal`, `message`, and `comfyPromptIds` on live jobs plus `etaSeconds`/`estimatedCompletionAt` on `agent_tasks`.
  - Upgraded `ClaudeLiveBar` with a 1-second live countdown ETA pill (`ETA 6m 42s`), sub-step counter (`41/62`), job status message, and per-task ETA pills.
  - Added optional background ComfyUI `/history` poller when `COMFYUI_BASE_URL` is configured and `comfyPromptIds[]` are passed to `start_job`.
- **Zero-Downtime Request Draining & Stateless MCP**:
  - Exposed live `inFlightRequests` and `mcpMode: "stateless"` on `/api/health`, added `stop_grace_period: 60s` in `docker-compose.yml`, and upgraded `scripts/update.sh` to poll `inFlightRequests === 0` before stopping the old Blue/Green slot so heavy uploads (`register_asset`) never get cut mid-flight.
- **Compact Paginated MCP Responses & Single-Asset Detail**:
  - Defaulted `list_assets` to `compact: true` with cursor pagination (`cursor`, `limit`, returning `{ total, count, nextCursor, assets }`), defaulted `get_storyboard` to `compact: true` with cumulative absolute `startSec` timecodes, and added `get_asset(ref)`.
- **Idempotent Batch Operations & Multi-Root Read-Only Ingest**:
  - Added `upsert_storyboard` (keyed by `externalId` e.g. `"S04"` so re-runs never create duplicates) and `ingest_folder` (idempotent batch ingestion with automatic parent stem matching e.g. `S10_4k.png` → `S10.png`).
  - Added `INGEST_EXTRA_DIRS` env var for mounting multiple read-only roots via local `docker-compose.override.yml`, plus `localPath` on projects.
- **Asset Relation Types & Compare Deep-Links (`CompareView`)**:
  - Added `relationType` (`revision | upscale | crop | variant`) on assets so upscales/crops/variants stay `v1` instead of bumping revision numbers.
  - Added `/compare?left=@ref&right=@ref` URL deep-linking, smart auto-suggested pairs (`Upscale / HQ`, `Rejet ↔ Correction`), and a 1-click **Copier lien** button in `CompareView`.
- **Server-Side Visual QC, Shot Auto-Linking & Enhanced LRC / Suno Alignment**:
  - Added `record_qc`, `get_frame`, and `contact_sheet` MCP tools + REST endpoints (`PATCH /api/assets/:id/qc`, `POST /api/assets/:id/frame`, `POST /api/assets/:id/contact-sheet`) and visual QC badges (`QC ✓` / `QC !` / `QC ✗`) on `AssetCard` + interactive QC checklist in `AssetInspector`.
  - Auto-linked annotations with `timecodeSec` (or linked keyframe/video asset) to matching storyboard shots (`shotId`/`shotCode`), and added incremental `since` filtering to `get_pending_feedback`.
  - Added `compose_prompt` (combining Continuity Bible entries, ordered reference assets, filtered active rules, and shot prompt), word-level Enhanced LRC (`<mm:ss.xx>`) parsing, and `import_suno_alignment`.

## [0.3.3] - 2026-11-27

### Added
- **Zero-Downtime Blue/Green Deployment (`docker-compose.yml`, `scripts/update.sh`, `scripts/rollback.sh`, Closes #14)**: Added persistent Nginx reverse-proxy `gateway` with dynamic Docker DNS upstream switching (`docker/gateway.conf`, `docker/gateway-entrypoint.sh`), dual `blue`/`green` application slots (`server-blue`/`web-blue`, `server-green`/`web-green` with isolated image tags and `/healthz` probes), live `slot` reporting on `/api/health`, transparent one-time migration from legacy single-slot containers, automatic rollback on failed standby healthchecks, graceful draining, and instant 1-command `./scripts/rollback.sh` — preserving `./data`, `./skills`, and `postgres_data` untouched.
- **Automated Tests**: Added `health.routes.test.ts` and `blue-green.test.ts` covering `/api/health` slot reporting, Docker Compose Blue/Green & PostgreSQL isolation invariants, gateway Nginx directives, and shell script syntax checks.

## [0.3.2] - 2026-11-27

### Added
- **Expandable Claude Live Task List (`ClaudeLiveBar`, Closes #12)**: Added `agent_tasks` table (additive `CREATE TABLE IF NOT EXISTS`), REST endpoints (`/api/projects/:id/tasks`), WebSocket realtime sync (`tasks.changed`), and MCP tools (`sync_agent_tasks`, `update_agent_task`, `list_agent_tasks`, `clear_agent_tasks`, `studio://projects/{slug}/tasks`). The `CLAUDE LIVE` banner stays compact showing only the active `in_progress` task by default, and unfolds on click to inspect all pending, active, completed, and failed tasks with filters and clickable `@ref` links.
- **Media Fullscreen Lightbox (`MediaLightbox`)**: Double-clicking any media card opens a fullscreen preview lightbox supporting 100% image zoom, video frame stepping (`-1f`/`+1f`), Proxy/Original toggle, download, and keyboard navigation (`←`, `→`, `Esc`).
- **YouTube A/B Variant Drag-and-Drop & Delete (`YouTubePanel`)**: Drag-and-drop images from the gallery strip or directly from disk onto Variant A/B/C slots, drag slots to reorder/swap variants, and remove individual thumbnail or title variants in 1 click.
- **Automated Tests**: Added `task-utils.test.ts`, `tasks.routes.test.ts`, and expanded `mcp.routes.test.ts`.

## [0.3.1] - 2026-11-27

### Fixed
- **Per-Project Custom Rule Overrides (`packages/shared/src/rules-engine.ts`, Closes #10)**: Fixed `resolveProjectRules` ignoring `overrideMap` for `projectCustomRules` (which previously forced `isOverridden: false`). Project overrides now apply identically to both global rulebook rules and project-specific custom rules.
- **Qwen-Image-Edit Prompt Extraction (`apps/server/src/services/comfy-metadata.service.ts`)**: Upgraded `resolveNodeText` to recursive cycle-safe graph traversal supporting `TextEncodeQwenImage21`, Switch nodes (`ImpactSwitch`, `Switch`, boolean/index selectors), `StringConcatenate`, and `FluxGuidance` so prompts are automatically extracted from Qwen-Image-Edit PNGs.

### Added
- **Informative & Tag-Scoped Rules**: Added `autoInject` (`boolean`, default `true`) and `appliesToTags` (`string[]`, default `[]`) on rules (plus `autoInjectOverride` and `appliesToTagsOverride` on project overrides). Rules with `autoInject: false` stay informative-only and never pollute generated prompts; tag-scoped rules only inject fragments when matching context tags are passed to `get_active_rules` / `render_prompt_with_rules` (Web UI + REST + MCP).
- **Direct Rule Editing & Deletion via MCP & UI**: Added `update_rule` and `delete_rule` MCP tools, plus direct editing of project-specific custom rules in `RulesPanel`.
- **Update Project Status via MCP & UI**: Added `update_project` MCP tool (`pre_production`, `production`, `editing`, `youtube_ready`, `published`, `archived`) and an inline project status selector in the Web Studio header.
- **Zero-Copy Local Ingest & Configurable Mount**: Added `INGEST_HOST_DIR` env variable in `docker-compose.yml` / `.env.example` / `scripts/update.sh` (non-destructive) and `storageMode: "copy" | "hardlink" | "reference"` on `register_asset` / JSON ingest. `reference` mode streams originals directly from the read-only ingest mount (`ingest://`) without duplicating heavy files into `data/originals/` and strictly prevents deleting source files.
- **Media Subfolders & Navigation**: Added virtual subfolder hierarchy inside **Médias** (breadcrumb bar, `+ Nouveau dossier`, subfolder tiles, flat-vs-folder toggle, targeted upload/drag-and-drop, `Dossier` dropdown in `AssetInspector`, non-destructive folder deletion moving assets to parent), REST endpoints (`/api/projects/:id/folders`), and MCP tools (`list_media_folders`, `create_media_folder`, plus `folderPath` on `register_asset`, `list_assets`, and `update_asset`).
- **Automated Tests**: Added regression tests for project-custom rule overrides & `autoInject`/`appliesToTags` (`rules-engine.test.ts`), folder path normalization (`refs.test.ts`), Qwen-Image-Edit + Switch prompt extraction (`comfy-metadata.service.test.ts`), zero-copy `reference` & `hardlink` ingest (`media.service.test.ts`), and new MCP tools (`mcp.routes.test.ts`).

## [0.3.0] - 2026-11-27

### Added
- **Per-Project Local Git & GitHub Integration (Closes #4)**: Each project can initialize its own local Git repository under `/data/projects/<slug>/repo` with a safe `.gitignore` (excluding raw heavy media & secrets), link a GitHub remote URL (strictly rejecting embedded tokens/credentials), export structured snapshots (script, bible, storyboard, resolved rules, audio lyrics, YouTube metadata), commit, push, and inspect commit history via Web UI (`ProjectGitPanel`) and MCP (`init_project_git_repo`, `sync_and_commit_project_repo`, `get_project_git_status`, `studio://projects/{slug}/git`).
- **Pre-Production Studio (`PreprodPanel`)**: Versioned screenplay/script editor with LCS line-by-line diff viewer, Continuity Bible (`@char-*`, `@loc-*`, `@prop-*`, `@style-*` with visual prompts & LoRAs), and Storyboard breakdown (Scenes → Shots with camera movement, duration, prompts, asset links & status).
- **Audio, Music, Lyrics & Lip-Sync Studio (`AudioPanel`)**: Interactive waveform playback bar with clickable beat/section/lip-sync markers, structured lyrics editor, timed `.lrc` parser, and automatic `.srt` subtitle export.
- **YouTube Packaging Hub (`YouTubePanel`)**: A/B Testing for up to 3 thumbnails & 3 titles (with 60-char mobile truncation & 100-char hard limit checks), Desktop/Mobile & Dark/Light YouTube Feed Simulator with bottom-right duration badge safe-zone overlay, auto-generated chapters from Storyboard, AI disclosure toggle, pre-publish checklist, and 1-click **YouTube Ready Pack** server export (`metadata.md`, `metadata.json`, `subtitles.srt`, thumbnail variants).
- **Non-Destructive Update Script (`scripts/update.sh`)**: Safe one-command Debian/Docker update script that pulls `main`, adds new optional `.env` defaults without modifying secrets, creates a pre-update PostgreSQL dump in `backups/`, rebuilds only app images while preserving all existing `./data` assets and `postgres_data`, and verifies `/api/health`.
- **MCP Server v3**: Added Stage 3 resources & tools covering script, bible, storyboard, audio, YouTube packaging, and per-project Git repos.
- **Automated Tests**: Added `stage3-utils.test.ts`, `project-git.service.test.ts` (real temp Git repo tests), `stage3.routes.test.ts`, `youtube.test.ts`, and expanded `mcp.routes.test.ts`.

## [0.2.0] - 2026-11-27

### Added
- **Visual Review & Annotations**: Interactive pin annotations directly on images and exact paused video frames (capturing normalized `x/y` coordinates, `frameNumber`, and `timecodeSec`), open/resolved status toggle, and real-time Feedback Inbox exposed to Claude Code via MCP (`get_pending_feedback`, `resolve_feedback`, `studio://projects/{slug}/feedback`).
- **A/B Visual Comparator (`CompareView`)**: Side-by-side comparison for images & videos, interactive Before/After swipe slider for images, and synchronized dual video playback (play/pause + `-1f`/`+1f` frame stepping) for Draft vs HQ review.
- **Per-Project Rulebooks & Overrides (`RulesPanel` & `resolveProjectRules`)**: Global reusable rulebooks (seeded with default *Standards Production IA* pack), per-project attachment, inline per-project overrides (e.g. `5 doigts` → `4 doigts` on cartoon projects), custom project rules, automatic positive/negative prompt fragment compilation, and MCP tools (`get_active_rules`, `list_rulebooks`, `set_project_rule_override`, `add_project_custom_rule`, `studio://projects/{slug}/rules`).
- **Reusable Prompt Templates & ComfyUI Workflows (`LibraryPanel`)**: Dynamic `{{variable}}` extraction & rendering with automatic injection of active project rule fragments (`render_prompt_with_rules`), plus versioned ComfyUI `.json` workflow catalog.
- **Claude Code Skills Hub (`SkillsPanel` & `SkillsSyncService`)**: Centralized `SKILL.md` editor (global or project-scoped), full version history with restore, safe disk synchronization to `/skills/<slug>/SKILL.md` (mounted volume in Docker Compose), and MCP tools (`list_skills`, `read_skill`, `save_skill`, `studio://skills`).
- **Specification Update (`docs/cahier-des-charges.md`)**: Added per-project local Git & GitHub repository requirement for Stage 3/4.
- **Automated Tests**: Added comprehensive unit & integration tests across all 3 packages (`rules-engine.test.ts`, `skills-sync.service.test.ts`, `stage2.routes.test.ts`, updated `mcp.routes.test.ts`, and `annotations.test.ts`).

## [0.1.0] - 2026-11-27

### Added
- **Docker & Public Repo Security**: Isolated PostgreSQL 16 Docker network (`videostudio-internal`, never exposed on host), Nginx LAN gateway (`docker-compose.yml`), `scripts/init-env.sh`, `.env.example`, strict `.gitignore`/`.dockerignore`, `CLAUDE.md`, and GitHub Actions CI with Gitleaks secret scanning.
- **Shared Contracts (`@videostudio/shared`)**: Zod validation schemas, WebSocket realtime event contracts, and universal `@ref` / `studio://` URI helpers.
- **Backend API & Media Pipeline (`@videostudio/server`)**: Fastify REST API for projects/assets/activities/jobs, Drizzle ORM PostgreSQL bootstrap, Sharp & FFmpeg thumbnail/proxy generation, HTTP Range (`206`) media streaming, LAN ComfyUI URL/base64/multipart ingestion, and pure-TS ComfyUI PNG/video metadata extractor.
- **MCP Server v1 (Streamable HTTP)**: `/mcp` endpoint with constant-time Bearer token auth exposing `studio://` resources and Claude Code tools (`list_projects`, `create_project`, `get_project_overview`, `register_asset`, `list_assets`, `update_asset`, `resolve_reference`, `log_activity`, `start_job`, `update_job`).
- **Realtime LAN Web Studio (`@videostudio/web`)**: Dark cinema NLE workbench UI, multi-project workspace, WebSocket live updates, Claude Live Jobs progress banner, drag-and-drop upload, 1-click `@ref` copy, asset inspector with frame-by-frame video stepping (`-1f`/`+1f`), lineage navigation, ComfyUI metadata inspector, and Live Activity Feed.
- **Automated Tests**: Unit & integration tests for `@ref`/`studio://` parsing, security guardrails (Bearer auth, path traversal, SSRF), ComfyUI PNG metadata extraction, and MCP Streamable HTTP authentication & JSON-RPC handshake.
