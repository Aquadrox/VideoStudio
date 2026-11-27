#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# VideoStudio — Automated Backup Script (Debian / Cron Ready)
# ==============================================================================
# Creates a timestamped backup archive in ./backups/ containing:
#   - Full PostgreSQL database dump (pg_dump | gzip)
#   - Claude Code skills directory (./skills)
#   - Automatically prunes old archives beyond --retain-days (default: 14)
#   - NEVER touches ./data media assets or .env secrets
#
# Example Debian cron (daily at 03:00):
#   0 3 * * * cd /path/to/VideoStudio && ./scripts/backup.sh --retain-days 14 >> backups/cron.log 2>&1
# ==============================================================================

RETAIN_DAYS=14
BACKUP_DIR="backups"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --retain-days)
      RETAIN_DAYS="${2:-14}"
      shift 2
      ;;
    --dir)
      BACKUP_DIR="${2:-backups}"
      shift 2
      ;;
    *)
      echo "Usage: ./scripts/backup.sh [--retain-days N] [--dir backups]" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "docker-compose.yml" ]]; then
  echo "ERROR: Please run ./scripts/backup.sh from the VideoStudio repository root." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
TMP_DIR="${BACKUP_DIR}/.tmp-backup-${STAMP}"
mkdir -p "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

PG_USER="videostudio"
PG_DB="videostudio"
if [[ -f ".env" ]]; then
  PG_USER="$(grep '^POSTGRES_USER=' .env | cut -d= -f2 || echo 'videostudio')"
  PG_DB="$(grep '^POSTGRES_DB=' .env | cut -d= -f2 || echo 'videostudio')"
fi

echo "💾 [VideoStudio Backup] Starting backup (${STAMP})..."

if docker compose ps --status running --services 2>/dev/null | grep -q "^postgres$"; then
  docker compose exec -T postgres pg_dump -U "${PG_USER:-videostudio}" "${PG_DB:-videostudio}" > "${TMP_DIR}/database.sql"
  echo "✅ PostgreSQL dump captured."
else
  echo "⚠️  PostgreSQL container is not running; skipping SQL dump."
fi

if [[ -d "skills" ]]; then
  cp -a skills "${TMP_DIR}/skills"
  echo "✅ Skills directory captured."
fi

ARCHIVE_PATH="${BACKUP_DIR}/videostudio-backup-${STAMP}.tar.gz"
tar -czf "$ARCHIVE_PATH" -C "$TMP_DIR" .
ARCHIVE_SIZE="$(du -h "$ARCHIVE_PATH" | cut -f1)"
echo "✅ Backup archive created: ${ARCHIVE_PATH} (${ARCHIVE_SIZE})"

if [[ "$RETAIN_DAYS" =~ ^[0-9]+$ ]] && (( RETAIN_DAYS > 0 )); then
  DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'videostudio-backup-*.tar.gz' -mtime +"$RETAIN_DAYS" -print -delete | wc -l)"
  echo "🧹 Pruned ${DELETED} backup(s) older than ${RETAIN_DAYS} days."
fi
