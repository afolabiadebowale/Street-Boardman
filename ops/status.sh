#!/usr/bin/env bash
# Quick health overview: containers, disk, memory, recent api/worker logs.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

echo "=== containers"
docker compose ps
echo
echo "=== app health (through nginx)"
curl -fsS http://127.0.0.1:8080/health && echo || echo "health check FAILED"
echo
echo "=== disk"
df -h / | tail -1
docker system df
echo
echo "=== memory"
free -h
echo
echo "=== latest backup"
latest="$(find "$HOME/backups" -name 'streetboardman-*.sql.gz' 2>/dev/null | sort | tail -1)"
if [ -n "$latest" ]; then ls -lh "$latest"; else echo "none yet"; fi

for service in api worker; do
  echo
  echo "=== $service (last 20 lines)"
  docker compose logs --no-color --tail 20 "$service"
done
