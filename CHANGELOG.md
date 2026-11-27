# Changelog

All notable changes to **VideoStudio** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
