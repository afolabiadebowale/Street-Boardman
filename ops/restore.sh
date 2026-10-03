#!/usr/bin/env bash
# Restores a backup made by ops/backup.sh, replacing the current data.
#
#   ops/restore.sh ~/backups/streetboardman-YYYY-MM-DD.sql.gz
#
# Stops api and worker first so nothing writes mid-restore, and asks for
# confirmation because everything since the backup is lost.
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:?usage: ops/restore.sh <backup.sql.gz>}"
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }

read -r -p "Replace ALL current data with $FILE? Type 'restore' to continue: " answer
[ "$answer" = "restore" ] || { echo "Cancelled."; exit 1; }

docker compose stop api worker
gunzip -c "$FILE" | docker compose exec -T postgres psql -U postgres -d streetboardman -v ON_ERROR_STOP=1 --quiet
docker compose start api worker
docker compose ps
