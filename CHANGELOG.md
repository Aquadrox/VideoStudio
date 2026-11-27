# Changelog

All notable changes to **VideoStudio** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-27

### Added
- **Docker & Public Repo Security**: Isolated PostgreSQL 16 Docker network (`videostudio-internal`, never exposed on host), Nginx LAN gateway (`docker-compose.yml`), `scripts/init-env.sh`, `.env.example`, strict `.gitignore`/`.dockerignore`, `CLAUDE.md`, and GitHub Actions CI with Gitleaks secret scanning.
- **Shared Contracts (`@videostudio/shared`)**: Zod validation schemas, WebSocket realtime event contracts, and universal `@ref` / `studio://` URI helpers.
- **Backend API & Media Pipeline (`@videostudio/server`)**: Fastify REST API for projects/assets/activities/jobs, Drizzle ORM PostgreSQL bootstrap, Sharp & FFmpeg thumbnail/proxy generation, HTTP Range (`206`) media streaming, LAN ComfyUI URL/base64/multipart ingestion, and pure-TS ComfyUI PNG/video metadata extractor.
- **MCP Server v1 (Streamable HTTP)**: `/mcp` endpoint with constant-time Bearer token auth exposing `studio://` resources and Claude Code tools (`list_projects`, `create_project`, `get_project_overview`, `register_asset`, `list_assets`, `update_asset`, `resolve_reference`, `log_activity`, `start_job`, `update_job`).
- **Realtime LAN Web Studio (`@videostudio/web`)**: Dark cinema NLE workbench UI, multi-project workspace, WebSocket live updates, Claude Live Jobs progress banner, drag-and-drop upload, 1-click `@ref` copy, asset inspector with frame-by-frame video stepping (`-1f`/`+1f`), lineage navigation, ComfyUI metadata inspector, and Live Activity Feed.
- **Automated Tests**: Unit & integration tests for `@ref`/`studio://` parsing, security guardrails (Bearer auth, path traversal, SSRF), ComfyUI PNG metadata extraction, and MCP Streamable HTTP authentication & JSON-RPC handshake.
