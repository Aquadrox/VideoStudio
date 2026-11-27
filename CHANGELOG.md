# Changelog

All notable changes to **VideoStudio** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
