#!/usr/bin/env sh
set -eu

UPSTREAM_DIR="/etc/nginx/active-upstream"
UPSTREAM_FILE="${UPSTREAM_DIR}/active-upstream.inc"
SLOT_FILE="${UPSTREAM_DIR}/active-slot"

mkdir -p "$UPSTREAM_DIR"

if [ ! -f "$UPSTREAM_FILE" ]; then
  SLOT="blue"
  if [ -f "$SLOT_FILE" ]; then
    READ_SLOT="$(tr -d ' \n\r' < "$SLOT_FILE")"
    if [ "$READ_SLOT" = "blue" ] || [ "$READ_SLOT" = "green" ]; then
      SLOT="$READ_SLOT"
    fi
  fi
  cat > "$UPSTREAM_FILE" <<EOF
set \$active_slot "${SLOT}";
set \$active_server "server-${SLOT}:3001";
set \$active_web "web-${SLOT}:80";
EOF
  printf '%s\n' "$SLOT" > "$SLOT_FILE"
fi

exec nginx -g 'daemon off;'
