#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# VideoStudio — Instant Blue/Green Rollback Script
# ==============================================================================
# Switches gateway traffic back to the previous Blue/Green slot without
# rebuilding images and without touching ./data, ./skills, or PostgreSQL.
#
# Usage:
#   ./scripts/rollback.sh
#   ./scripts/rollback.sh --drain-seconds 5
# ==============================================================================

DRAIN_SECONDS=3
while [[ $# -gt 0 ]]; do
  case "$1" in
    --drain-seconds)
      DRAIN_SECONDS="${2:-3}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: ./scripts/rollback.sh [--drain-seconds N]" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "docker-compose.yml" ]]; then
  echo "ERROR: Please run ./scripts/rollback.sh from the VideoStudio repository root." >&2
  exit 1
fi

DEPLOY_DIR=".deploy"
SLOT_FILE="${DEPLOY_DIR}/active-slot"
PREV_SLOT_FILE="${DEPLOY_DIR}/previous-slot"
UPSTREAM_FILE="${DEPLOY_DIR}/active-upstream.inc"

if [[ ! -f "$SLOT_FILE" ]]; then
  echo "ERROR: No active Blue/Green slot state found (${SLOT_FILE})." >&2
  exit 1
fi

CURRENT_SLOT="$(tr -d ' \n\r' < "$SLOT_FILE")"
if [[ "$CURRENT_SLOT" == "blue" ]]; then
  ROLLBACK_SLOT="green"
elif [[ "$CURRENT_SLOT" == "green" ]]; then
  ROLLBACK_SLOT="blue"
else
  echo "ERROR: Invalid active slot '${CURRENT_SLOT}'." >&2
  exit 1
fi

echo "↩️  Rolling back VideoStudio: '${CURRENT_SLOT}' → '${ROLLBACK_SLOT}'..."

# Start previous slot using its already-built image (no rebuild!)
docker compose --profile green up -d --no-deps --no-build "server-${ROLLBACK_SLOT}" "web-${ROLLBACK_SLOT}"

# Wait for rollback slot health
echo "⏳ Verifying rollback slot '${ROLLBACK_SLOT}' health..."
READY=false
for _ in $(seq 1 25); do
  if docker compose --profile green exec -T gateway wget -qO- "http://server-${ROLLBACK_SLOT}:3001/api/health" 2>/dev/null | grep -q '"status":"ok"' \
    && docker compose --profile green exec -T gateway wget -qO- "http://web-${ROLLBACK_SLOT}:80/healthz" 2>/dev/null | grep -q 'ok'; then
    READY=true
    break
  fi
  sleep 2
done

if [[ "$READY" != "true" ]]; then
  echo "❌ Rollback slot '${ROLLBACK_SLOT}' failed health check. Keeping '${CURRENT_SLOT}' active." >&2
  exit 1
fi

TMP_FILE="${UPSTREAM_FILE}.tmp.$$"
cat > "$TMP_FILE" <<EOF
set \$active_slot "${ROLLBACK_SLOT}";
set \$active_server "server-${ROLLBACK_SLOT}:3001";
set \$active_web "web-${ROLLBACK_SLOT}:80";
EOF
mv "$TMP_FILE" "$UPSTREAM_FILE"

docker compose --profile green exec -T gateway nginx -t >/dev/null 2>&1
docker compose --profile green exec -T gateway nginx -s reload

printf '%s\n' "$CURRENT_SLOT" > "$PREV_SLOT_FILE"
printf '%s\n' "$ROLLBACK_SLOT" > "$SLOT_FILE"

sleep "$DRAIN_SECONDS"
docker compose --profile green stop "server-${CURRENT_SLOT}" "web-${CURRENT_SLOT}" >/dev/null 2>&1 || true

STUDIO_PORT="$(grep '^STUDIO_PORT=' .env | cut -d= -f2 || echo '3100')"
HEALTH_JSON="$(curl -fsS "http://127.0.0.1:${STUDIO_PORT:-3100}/api/health" 2>/dev/null || echo '{"status":"unknown"}')"
echo "✅ Rollback complete! Active slot is now '${ROLLBACK_SLOT}'."
echo "   ${HEALTH_JSON}"
