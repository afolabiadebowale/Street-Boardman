-- Least-privilege runtime database role (TASK-034).
--
-- Run against a target database as the owning/migrator role:
--   psql "$DATABASE_URL" -v app_password="$APP_DB_PASSWORD" -f prisma/roles.sql
--
-- Roles are cluster-wide in Postgres, not per-database — if you run this
-- against both your dev and test databases on the same server (the usual
-- local setup), use the SAME $APP_DB_PASSWORD both times. Running it twice
-- with two different passwords doesn't give each database its own
-- password; it just overwrites the role's one password, silently breaking
-- whichever connection was using the earlier value.
--
-- Two roles from here on:
--   - The role in DATABASE_URL (e.g. `postgres`, or a dedicated migrator
--     role) owns the schema and is what `prisma migrate deploy`/`dev` and
--     `prisma/seed.js` run as. It keeps full DDL rights — that's expected.
--   - streetboardman_app is what the running server AND worker processes
--     actually connect as in production (APP_DATABASE_URL). It can read
--     and write rows in existing tables, but cannot create, alter, or
--     drop anything, and cannot create new roles/databases. A SQL
--     injection or a compromised dependency in the running app therefore
--     can't touch schema or provision itself more access, even via a raw
--     query — see tests/integration/dbRoles.test.js for the enforcement
--     proof.
--
-- Every statement here is safe to re-run (idempotent), including after
-- future migrations add new tables — the ALTER DEFAULT PRIVILEGES at the
-- bottom auto-grants those too, as long as they're created by the same
-- role that runs this script.

-- psql's :'var' substitution only happens in plain statements, not inside
-- dollar-quoted DO/function bodies — so role creation has to be built as
-- text and run via \gexec rather than a DO $$ ... $$ block like the
-- grants below.
SELECT 'CREATE ROLE streetboardman_app LOGIN PASSWORD ''' || :'app_password' || ''''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'streetboardman_app') \gexec

SELECT 'ALTER ROLE streetboardman_app WITH LOGIN PASSWORD ''' || :'app_password' || ''''
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'streetboardman_app') \gexec

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO streetboardman_app', current_database());
END
$$;

-- Postgres 15+ already revokes CREATE on the public schema from PUBLIC by
-- default, but this pins the same behavior on older server versions too
-- (e.g. some managed Postgres offerings still default to pre-15
-- semantics) — without it, any login role can CREATE TABLE in public by
-- default, which would defeat the point of this file.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO streetboardman_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO streetboardman_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO streetboardman_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO streetboardman_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO streetboardman_app;
