#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# VideoStudio — Safe Non-Destructive Update Script (Debian / Docker Compose)
# ==============================================================================
# Guarantees:
#   - NEVER deletes Docker volumes (postgres_data) or ./data / ./skills assets.
#   - NEVER touches existing secrets in .env (only appends new optional defaults).
#   - Creates a pre-update PostgreSQL dump in ./backups/ before updating.
#   - Only rebuilds server/web images; existing media assets are untouched.
#
# Usage:
#   ./scripts/update.sh              # git pull + backup DB + rebuild & restart
#   ./scripts/update.sh --skip-git   # skip git pull (if you pulled manually)
# ==============================================================================

SKIP_GIT=false
for arg in "$@"; do
  case "$arg" in
    --skip-git) SKIP_GIT=true ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: ./scripts/update.sh [--skip-git]" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "docker-compose.yml" ]]; then
  echo "ERROR: Please run ./scripts/update.sh from the VideoStudio repository root." >&2
  exit 1
fi

if [[ ! -f ".env" ]]; then
  echo "ERROR: .env not found. Run ./scripts/init-env.sh first." >&2
  exit 1
fi

# 1. Pull latest code from origin/main safely (fast-forward only, never resets user files)
if [[ "$SKIP_GIT" == "false" ]]; then
  echo "📥 Pulling latest changes from origin/main..."
  git pull --ff-only origin main
fi

# 2. Ensure runtime directories exist (non-destructive: never deletes existing assets)
mkdir -p data ingest skills backups

# 3. Append any newly introduced non-secret defaults to .env without touching existing secrets
ensure_env_default() {
  local key="$1"
  local default_val="$2"
  if ! grep -q "^${key}=" .env; then
    echo "${key}=${default_val}" >> .env
    echo "➕ Added missing default ${key}=${default_val} to .env"
  fi
}

ensure_env_default "SKILLS_SYNC_DIR" "/skills"
ensure_env_default "INGEST_HOST_DIR" "./ingest"
ensure_env_default "INGEST_ALLOWED_DIR" "/ingest"
ensure_env_default "ALLOWED_FETCH_HOSTS" ""

# 4. Pre-update PostgreSQL safety backup if container is running
if docker compose ps --status running --services 2>/dev/null | grep -q "^postgres$"; then
  PG_USER="$(grep '^POSTGRES_USER=' .env | cut -d= -f2 || echo 'videostudio')"
  PG_DB="$(grep '^POSTGRES_DB=' .env | cut -d= -f2 || echo 'videostudio')"
  BACKUP_FILE="backups/pre-update-$(date +%Y%m%d-%H%M%S).sql.gz"
  echo "💾 Creating pre-update PostgreSQL backup at ${BACKUP_FILE}..."
  if docker compose exec -T postgres pg_dump -U "${PG_USER:-videostudio}" "${PG_DB:-videostudio}" | gzip > "$BACKUP_FILE"; then
    echo "✅ Backup saved: ${BACKUP_FILE}"
  else
    echo "⚠️  Backup skipped (database may be freshly initialized)."
    rm -f "$BACKUP_FILE"
  fi
fi

# 5. Build ONLY app images (server & web) and roll forward cleanly without destroying volumes or assets
echo "🐳 Building updated VideoStudio images (existing ./data assets & PostgreSQL volume preserved)..."
docker compose build server web
docker compose up -d --remove-orphans

# 6. Wait for health check
STUDIO_PORT="$(grep '^STUDIO_PORT=' .env | cut -d= -f2 || echo '3100')"
HEALTH_URL="http://127.0.0.1:${STUDIO_PORT:-3100}/api/health"

echo "⏳ Waiting for VideoStudio health check (${HEALTH_URL})..."
for _ in $(seq 1 30); do
  if HEALTH_JSON="$(curl -fsS "$HEALTH_URL" 2>/dev/null)"; then
    echo "✅ VideoStudio updated safely! Existing assets and database are preserved."
    echo "   ${HEALTH_JSON}"
    echo "🌐 LAN UI: http://<SERVER-IP>:${STUDIO_PORT:-3100}"
    exit 0
  fi
  sleep 2
done

echo "⚠️  Containers started, but health check timed out. Inspect logs with: docker compose logs -f server" >&2
exit 1
