#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"

if [[ -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE already exists. Remove or back it up before re-running." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required to generate cryptographically secure tokens." >&2
  exit 1
fi

PG_PASS="$(openssl rand -hex 24)"
MCP_TOKEN="$(openssl rand -hex 32)"

cat > "$ENV_FILE" <<EOF
# Auto-generated local VideoStudio configuration — NEVER commit this file.
STUDIO_PORT=3100
NODE_ENV=production
CORS_ORIGIN=*

POSTGRES_DB=videostudio
POSTGRES_USER=videostudio
POSTGRES_PASSWORD=${PG_PASS}
DATABASE_URL=postgresql://videostudio:${PG_PASS}@postgres:5432/videostudio

MCP_AUTH_TOKEN=${MCP_TOKEN}

DATA_DIR=/data
MAX_UPLOAD_MB=2048
ALLOWED_FETCH_HOSTS=
INGEST_ALLOWED_DIR=/ingest
SKILLS_SYNC_DIR=/skills
EOF

chmod 600 "$ENV_FILE"
mkdir -p data ingest skills

echo "✅ Created $ENV_FILE (permissions 600) with generated secrets."
echo "👉 Start VideoStudio with: docker compose up -d --build"
echo "👉 Register MCP in Claude Code (on your local server):"
echo "   claude mcp add --transport http videostudio http://localhost:3100/mcp --header \"Authorization: Bearer \$(grep '^MCP_AUTH_TOKEN=' .env | cut -d= -f2)\""
