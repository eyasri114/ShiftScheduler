#!/usr/bin/env bash
# Runs the migrations, demo seed and row-level security tests against a
# throwaway PostgreSQL database.
#
#   PGURL=postgres://postgres:postgres@localhost:5432 ./scripts/test-db.sh
#
# Quick local PostgreSQL with Docker:
#   docker run -d --name shifts-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
set -euo pipefail
cd "$(dirname "$0")/.."

PGURL="${PGURL:-postgres://postgres:postgres@localhost:5432}"
DB=shifts_test
PSQL=(psql -q -X -v ON_ERROR_STOP=1)

"${PSQL[@]}" "$PGURL/postgres" -c "drop database if exists $DB" -c "create database $DB"
"${PSQL[@]}" "$PGURL/$DB" -f supabase/tests/00_supabase_stub.sql
for f in $(ls supabase/migrations/*.sql | grep -v _storage); do "${PSQL[@]}" "$PGURL/$DB" -f "$f"; done
"${PSQL[@]}" "$PGURL/$DB" -f supabase/seed.sql
for t in supabase/tests/0[1-9]_*.sql; do "${PSQL[@]}" "$PGURL/$DB" -t -f "$t" 2>&1; done \
  | sed 's/^psql:[^:]*:[0-9]*: //; s/^NOTICE:  //' | grep -v '^ *$'
