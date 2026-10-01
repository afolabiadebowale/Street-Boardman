#!/bin/sh
# Runs once, when the compose Postgres volume is first initialised. Tables
# don't exist yet at this point, but roles.sql's ALTER DEFAULT PRIVILEGES
# covers them: the migrate service creates them afterwards as this same
# owner role, so they inherit streetboardman_app's grants automatically.
set -e
psql -v ON_ERROR_STOP=1 \
  -v app_password="$APP_DB_PASSWORD" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -f /docker-entrypoint-initdb.d/roles.sql.in
