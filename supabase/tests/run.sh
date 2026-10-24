#!/usr/bin/env bash
# Spins up a throwaway Postgres, applies the stub + all migrations, runs every test file.
# Usage: bash supabase/tests/run.sh   (needs Postgres 15+ binaries; set PG_BIN if not on PATH)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/pg_ctl | sort -V | tail -1)")}"
work="$(mktemp -d)"
port="${PGTEST_PORT:-55432}"
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$work"
cleanup() { as_pg "$PG_BIN/pg_ctl -D $work/data stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

as_pg "$PG_BIN/initdb -D $work/data -A trust -U postgres" >/dev/null
as_pg "$PG_BIN/pg_ctl -D $work/data -o '-p $port -k $work -c wal_level=logical' -l $work/log -w start" >/dev/null
psql_() { "$PG_BIN/psql" -h "$work" -p "$port" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }

psql_ -d postgres -c 'CREATE DATABASE b2b'
cat "$here/supabase_stub.sql" "$here"/../migrations/*.sql | psql_ -d b2b >/dev/null
echo "migrations applied"

status=0
for t in "$here"/[0-9]*.sql; do
  echo "== $(basename "$t")"
  if ! cat "$here/helpers.sql" "$t" | psql_ -d b2b -t -A -o /dev/null 2>&1 | sed -n -e 's/^\(psql:[^ ]* \)\{0,1\}NOTICE:  //p' -e 's/^\(psql:[^ ]* \)\{0,1\}ERROR:  /ERROR: /p'; then status=1; fi
done
exit $status
