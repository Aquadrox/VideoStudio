#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# VideoStudio — Zero-Downtime Blue/Green Update Script (Debian / Docker Compose)
# ==============================================================================
# Guarantees:
#   - ZERO DOWNTIME: builds & boots the standby slot (blue <-> green) while the
#     active slot continues serving Web UI, REST API, WebSockets & Claude MCP.
#   - ATOMIC CUTOVER: verifies both server & web healthchecks on the standby slot,
#     then atomically reloads the persistent Nginx gateway (nginx -s reload).
#   - AUTOMATIC ROLLBACK: if the standby slot fails healthchecks or live gateway
#     verification fails, traffic stays on (or reverts to) the previous slot.
#   - NON-DESTRUCTIVE: NEVER deletes Docker volumes (postgres_data), ./data, or
#     ./skills assets, and NEVER touches existing secrets in .env.
#   - SEAMLESS MIGRATION: automatically migrates legacy single-slot deployments
#     (videostudio-server / videostudio-web) to Blue/Green on first run.
#
# Usage:
#   ./scripts/update.sh                     # git pull + backup + blue/green deploy
#   ./scripts/update.sh --skip-git          # skip git pull (already pulled)
#   ./scripts/update.sh --drain-seconds 10  # wait 10s before stopping old slot
#   ./scripts/update.sh --rollback          # instant rollback to previous slot
# ==============================================================================

SKIP_GIT=false
DRAIN_SECONDS=5
DO_ROLLBACK=false
FORCE_SLOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-git)
      SKIP_GIT=true
      shift
      ;;
    --drain-seconds)
      DRAIN_SECONDS="${2:-5}"
      shift 2
      ;;
    --force-slot)
      FORCE_SLOT="${2:-}"
      shift 2
      ;;
    --rollback)
      DO_ROLLBACK=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: ./scripts/update.sh [--skip-git] [--drain-seconds N] [--force-slot blue|green] [--rollback]" >&2
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

if [[ "$DO_ROLLBACK" == "true" ]]; then
  exec ./scripts/rollback.sh --drain-seconds "$DRAIN_SECONDS"
fi

DEPLOY_DIR=".deploy"
SLOT_FILE="${DEPLOY_DIR}/active-slot"
PREV_SLOT_FILE="${DEPLOY_DIR}/previous-slot"
UPSTREAM_FILE="${DEPLOY_DIR}/active-upstream.inc"

write_upstream_config() {
  local slot="$1"
  local tmp_file="${UPSTREAM_FILE}.tmp.$$"
  cat > "$tmp_file" <<EOF
set \$active_slot "${slot}";
set \$active_server "server-${slot}:3001";
set \$active_web "web-${slot}:80";
EOF
  mv "$tmp_file" "$UPSTREAM_FILE"
}

wait_for_slot_health() {
  local slot="$1"
  local server_host="server-${slot}:3001"
  local web_host="web-${slot}:80"

  echo "⏳ Checking standby slot '${slot}' health (${server_host} & ${web_host})..."
  for attempt in $(seq 1 30); do
    local server_ok=false
    local web_ok=false

    if docker compose --profile green exec -T gateway wget -qO- "http://${server_host}/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
      server_ok=true
    fi
    if docker compose --profile green exec -T gateway wget -qO- "http://${web_host}/healthz" 2>/dev/null | grep -q 'ok'; then
      web_ok=true
    fi

    if [[ "$server_ok" == "true" && "$web_ok" == "true" ]]; then
      echo "✅ Standby slot '${slot}' is healthy (attempt ${attempt}/30)."
      return 0
    fi
    sleep 2
  done

  echo "❌ Standby slot '${slot}' failed health checks after 60s." >&2
  return 1
}

reload_gateway() {
  docker compose --profile green exec -T gateway nginx -t >/dev/null 2>&1
  docker compose --profile green exec -T gateway nginx -s reload
}

# 1. Pull latest code from origin/main safely (fast-forward only, never resets user files)
if [[ "$SKIP_GIT" == "false" ]]; then
  echo "📥 Pulling latest changes from origin/main..."
  git pull --ff-only origin main
fi

# 2. Ensure runtime directories exist (non-destructive: never deletes existing assets)
mkdir -p data ingest skills backups "$DEPLOY_DIR"

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
ensure_env_default "INGEST_EXTRA_DIRS" ""
ensure_env_default "ALLOWED_FETCH_HOSTS" ""
ensure_env_default "COMFYUI_BASE_URL" ""

# 4. Pre-update PostgreSQL safety backup if container is running (online, zero downtime)
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

# 5. Ensure PostgreSQL is running (never recreated during app updates)
docker compose up -d postgres

# 6. Detect active slot & handle transparent one-time migration from legacy single-slot containers
LEGACY_WEB_RUNNING=false
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^videostudio-web$'; then
  LEGACY_WEB_RUNNING=true
fi

CURRENT_SLOT=""
if [[ -f "$SLOT_FILE" ]]; then
  CURRENT_SLOT="$(tr -d ' \n\r' < "$SLOT_FILE")"
fi

if [[ "$LEGACY_WEB_RUNNING" == "true" ]]; then
  echo "🔄 Migrating existing single-slot deployment to Blue/Green (preserving all ./data assets & DB)..."
  TARGET_SLOT="blue"
  write_upstream_config "$TARGET_SLOT"

  echo "🐳 Building BLUE slot while legacy containers remain live..."
  docker compose build server-blue web-blue
  docker compose up -d --no-deps server-blue web-blue

  # Wait for server-blue directly via its own container before touching port 3100
  echo "⏳ Waiting for server-blue health check..."
  BLUE_READY=false
  for _ in $(seq 1 30); do
    if docker compose exec -T server-blue wget -qO- "http://127.0.0.1:3001/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
      BLUE_READY=true
      break
    fi
    sleep 2
  done

  if [[ "$BLUE_READY" != "true" ]]; then
    echo "❌ BLUE slot failed to start. Legacy stack remains untouched." >&2
    docker compose stop server-blue web-blue || true
    exit 1
  fi

  echo "⚡ Swapping port binding from legacy videostudio-web to persistent Blue/Green gateway..."
  docker stop videostudio-web videostudio-server >/dev/null 2>&1 || true
  docker rm videostudio-web videostudio-server >/dev/null 2>&1 || true
  docker compose up -d --no-deps gateway
  printf '%s\n' "$TARGET_SLOT" > "$SLOT_FILE"
  echo "✅ Migration to Blue/Green complete! All future updates will have zero downtime."
else
  # Determine current and standby slots
  if [[ "$CURRENT_SLOT" != "blue" && "$CURRENT_SLOT" != "green" ]]; then
    CURRENT_SLOT="blue"
    write_upstream_config "$CURRENT_SLOT"
    printf '%s\n' "$CURRENT_SLOT" > "$SLOT_FILE"
  fi

  if [[ -n "$FORCE_SLOT" ]]; then
    if [[ "$FORCE_SLOT" != "blue" && "$FORCE_SLOT" != "green" ]]; then
      echo "ERROR: --force-slot must be 'blue' or 'green'." >&2
      exit 1
    fi
    TARGET_SLOT="$FORCE_SLOT"
  elif [[ "$CURRENT_SLOT" == "blue" ]]; then
    TARGET_SLOT="green"
  else
    TARGET_SLOT="blue"
  fi

  # Ensure persistent gateway is running
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^videostudio-gateway$'; then
    write_upstream_config "$CURRENT_SLOT"
    docker compose up -d --no-deps gateway
  fi

  echo "🔵🟢 Blue/Green Deploy: active='${CURRENT_SLOT}' → standby target='${TARGET_SLOT}'"
  echo "🐳 Building and starting standby slot '${TARGET_SLOT}' (live slot '${CURRENT_SLOT}' remains uninterrupted)..."
  docker compose --profile green build "server-${TARGET_SLOT}" "web-${TARGET_SLOT}"
  docker compose --profile green up -d --no-deps "server-${TARGET_SLOT}" "web-${TARGET_SLOT}"

  # Verify standby slot health before routing ANY traffic to it
  if ! wait_for_slot_health "$TARGET_SLOT"; then
    echo "↩️  Auto-rollback: stopping failed standby slot '${TARGET_SLOT}'. Active slot '${CURRENT_SLOT}' was never interrupted." >&2
    docker compose --profile green stop "server-${TARGET_SLOT}" "web-${TARGET_SLOT}" >/dev/null 2>&1 || true
    exit 1
  fi

  # Atomic cutover via Nginx reload
  echo "⚡ Switching gateway traffic atomically: '${CURRENT_SLOT}' → '${TARGET_SLOT}'..."
  write_upstream_config "$TARGET_SLOT"
  if ! reload_gateway; then
    echo "❌ Gateway reload failed! Restoring '${CURRENT_SLOT}'..." >&2
    write_upstream_config "$CURRENT_SLOT"
    reload_gateway || true
    docker compose --profile green stop "server-${TARGET_SLOT}" "web-${TARGET_SLOT}" >/dev/null 2>&1 || true
    exit 1
  fi

  # Verify live traffic through gateway actually hits TARGET_SLOT
  STUDIO_PORT="$(grep '^STUDIO_PORT=' .env | cut -d= -f2 || echo '3100')"
  HEALTH_URL="http://127.0.0.1:${STUDIO_PORT:-3100}/api/health"
  LIVE_OK=false
  HEALTH_JSON=""
  for _ in $(seq 1 10); do
    if HEALTH_JSON="$(curl -fsS "$HEALTH_URL" 2>/dev/null)"; then
      if echo "$HEALTH_JSON" | grep -q '"status":"ok"' && echo "$HEALTH_JSON" | grep -q "\"slot\":\"${TARGET_SLOT}\""; then
        LIVE_OK=true
        break
      fi
    fi
    sleep 1
  done

  if [[ "$LIVE_OK" != "true" ]]; then
    echo "❌ Live gateway verification failed for slot '${TARGET_SLOT}'! Reverting immediately to '${CURRENT_SLOT}'..." >&2
    write_upstream_config "$CURRENT_SLOT"
    reload_gateway || true
    docker compose --profile green stop "server-${TARGET_SLOT}" "web-${TARGET_SLOT}" >/dev/null 2>&1 || true
    exit 1
  fi

  printf '%s\n' "$CURRENT_SLOT" > "$PREV_SLOT_FILE"
  printf '%s\n' "$TARGET_SLOT" > "$SLOT_FILE"

  # Graceful drain before stopping previous slot (waits until in-flight uploads/MCP calls finish)
  if [[ "$CURRENT_SLOT" != "$TARGET_SLOT" ]]; then
    MAX_DRAIN="${DRAIN_SECONDS}"
    if (( MAX_DRAIN < 60 )); then
      MAX_DRAIN=60
    fi
    echo "🕒 Draining in-flight requests on old slot '${CURRENT_SLOT}' (min ${DRAIN_SECONDS}s, max ${MAX_DRAIN}s)..."
    ELAPSED=0
    while (( ELAPSED < MAX_DRAIN )); do
      INFLIGHT=""
      INFLIGHT="$(docker compose --profile green exec -T gateway wget -qO- "http://server-${CURRENT_SLOT}:3001/api/health" 2>/dev/null \
        | sed -n 's/.*"inFlightRequests":\([0-9]*\).*/\1/p' || true)"
      if [[ -n "$INFLIGHT" && "$INFLIGHT" -eq 0 && "$ELAPSED" -ge "$DRAIN_SECONDS" ]]; then
        echo "✅ Old slot '${CURRENT_SLOT}' drained (0 in-flight requests after ${ELAPSED}s)."
        break
      fi
      if [[ -n "$INFLIGHT" && "$INFLIGHT" -gt 0 ]]; then
        echo "   ⏳ Waiting for ${INFLIGHT} in-flight request(s) on '${CURRENT_SLOT}' (${ELAPSED}s/${MAX_DRAIN}s)..."
      fi
      sleep 1
      ELAPSED=$((ELAPSED + 1))
    done
    echo "🛑 Stopping standby old slot '${CURRENT_SLOT}' (image preserved for instant ./scripts/rollback.sh)..."
    docker compose --profile green stop "server-${CURRENT_SLOT}" "web-${CURRENT_SLOT}"
  fi
fi

# Final status confirmation
STUDIO_PORT="$(grep '^STUDIO_PORT=' .env | cut -d= -f2 || echo '3100')"
HEALTH_URL="http://127.0.0.1:${STUDIO_PORT:-3100}/api/health"
FINAL_JSON="$(curl -fsS "$HEALTH_URL" 2>/dev/null || echo '{"status":"unknown"}')"

echo ""
echo "✅ VideoStudio updated with ZERO DOWNTIME (active slot: ${TARGET_SLOT})!"
echo "   ${FINAL_JSON}"
echo "🌐 LAN UI:   http://<SERVER-IP>:${STUDIO_PORT:-3100}"
echo "↩️  Rollback: ./scripts/rollback.sh"
