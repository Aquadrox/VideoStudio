# CLAUDE.md — VideoStudio Engineering & Security Rules

## 1. Public Repository Security Rules (MANDATORY)

This GitHub repository (`Aquadrox/VideoStudio`) is **PUBLIC**. Every contributor and AI agent MUST strictly enforce the following rules:

- **NEVER** commit `.env`, API keys, Bearer tokens, OAuth credentials (`client_secret*.json`), database passwords, private SSH/TLS keys, or personal LAN IP addresses/hostnames.
- **NEVER** hardcode secrets or personal machine paths in source code, Dockerfiles, scripts, or documentation. Always read from `process.env` and document placeholders in `.env.example`.
- **NEVER** commit generated media files, database dumps, or anything inside `data/`.
- Before committing, verify `git status` and `git diff --cached` contain zero secrets or local config files.

## 2. Architecture Overview

Monorepo managed with `pnpm` workspaces:
- `packages/shared`: Zod schemas, TypeScript domain types, `@ref` & `studio://` URI helpers, and WebSocket event contracts shared across API, MCP, and Web UI.
- `apps/server`: Fastify backend (TypeScript), Drizzle ORM + PostgreSQL 16, WebSocket realtime hub (`/ws`), MCP Server via Streamable HTTP (`/mcp`), and Media Pipeline (Sharp + FFmpeg/ffprobe + ComfyUI PNG/MP4 metadata extractor).
- `apps/web`: React 19 + Vite + TypeScript studio web UI served via Nginx in Docker Compose (proxying `/api`, `/ws`, `/mcp`).
- `docker/`: Production Dockerfiles and Nginx reverse proxy configuration.

## 3. Development Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## 4. Coding, Git, PR & Testing Conventions (MANDATORY)

- **Protected `main` branch**: Never push directly to `main`. Always work on dedicated branches (`feat/...`, `fix/...`, `ci/...`, `docs/...`, `refactor/...`, `test/...`, `chore/...`) and open a Pull Request.
- **Conventional Commits & PR titles**: Follow standard prefixes (`feat:`, `fix:`, `ci:`, `docs:`, `refactor:`, `test:`, `chore:`) with clear scope when helpful (e.g. `feat(rules): add project-overridable rulebooks`).
- **No merge without tests**: Every feature, bug fix, or API/MCP/UI addition MUST include automated tests (`pnpm test` must pass in CI across all workspaces).
- **Versioning & Changelog**: Maintain Semantic Versioning (SemVer) in `package.json` manifests and update `CHANGELOG.md` for every user-facing change or stage release.
- Keep validation schemas in `packages/shared` as single source of truth.
- Never bypass path traversal checks (`resolveSafePath`) or SSRF checks (`assertSafeFetchUrl`).
- Keep PostgreSQL strictly isolated inside the internal Docker network (`videostudio-internal`) — never expose port 5432 to the host in `docker-compose.yml`.
- Preserve clean modular architecture: `routes/` -> `services/` -> `db/`.
