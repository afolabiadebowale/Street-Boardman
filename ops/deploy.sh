#!/usr/bin/env bash
# Pulls the latest deploy branch and rebuilds/restarts what changed.
# Migrations run automatically (api and worker wait for the migrate job).
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
docker compose up -d --build --remove-orphans
docker compose ps

for service in postgres migrate api worker web; do
  echo
  echo "=== $service (last 30 lines)"
  docker compose logs --no-color --tail 30 "$service"
done
