#!/usr/bin/env bash
# Daily database backup (cron, 02:00): a gzipped pg_dump in ~/backups,
# keeping 14 days. Backups live on this VM — copy them off regularly.
#
# Restore: ops/restore.sh ~/backups/streetboardman-YYYY-MM-DD.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="$HOME/backups"
TARGET="$BACKUP_DIR/streetboardman-$(date +%F).sql.gz"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Dumps as the owner role inside the postgres container (local socket
# auth), so no password is needed or exposed on the command line.
# Written to a temp file first so a failed dump never replaces a good one.
docker compose exec -T postgres pg_dump -U postgres --clean --if-exists streetboardman | gzip > "$TARGET.tmp"
mv "$TARGET.tmp" "$TARGET"
chmod 600 "$TARGET"

find "$BACKUP_DIR" -name 'streetboardman-*.sql.gz' -mtime +14 -delete
echo "$(date -Is) backup ok: $TARGET ($(du -h "$TARGET" | cut -f1))"
