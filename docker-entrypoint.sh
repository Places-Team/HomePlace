#!/bin/sh
set -e

# Where the database lives inside the container. The host side is a bind mount
# chosen in .env (HOST_DATA_DIR) — see docker-compose.yml.
DATA_DIR="${DATA_DIR:-/data}"
export DATABASE_URL="${DATABASE_URL:-file:${DATA_DIR}/homeplace.db}"

# A bind-mounted directory arrives owned by whoever created it on the host,
# which is almost never the container's user. Rather than demanding the operator
# get the ownership right before the first start, take the ids from PUID/PGID
# (default 1000 — the first human account on most Linux systems) and adjust.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

mkdir -p "$DATA_DIR"
chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null || true

# Next.js writes its incremental/tag cache under .next/cache. The image ships
# that folder owned by root, so the server — which runs dropped to PUID — cannot
# create it, and every revalidate logged "EACCES: mkdir /app/.next/cache". Make
# it writable for the runtime user so caching and revalidation actually work.
mkdir -p /app/.next/cache
chown -R "$PUID:$PGID" /app/.next/cache 2>/dev/null || true

# The schema is applied on every start rather than through a migration history.
# For a single-file SQLite database owned by one application this is the honest
# trade: `db push` is idempotent, and there is no fleet of environments whose
# schema versions could drift apart.
#
# Not piped anywhere: in a pipeline the shell reports the *last* command's exit
# status, so a failing db push would look like success and the panel would come
# up on a database in an unknown state.
echo "→ applying database schema"
if ! su-exec "$PUID:$PGID" node scripts/migrate-file-sizes.mjs; then
  echo "✖ file-size migration failed — refusing to start; check the backup in ${DATA_DIR}/backups"
  exit 1
fi
if ! su-exec "$PUID:$PGID" node node_modules/prisma/build/index.js db push --skip-generate; then
  echo "✖ could not apply the schema — refusing to start on a database in an unknown state"
  echo "  The message above says what Prisma would not do on its own. Nothing has"
  echo "  been changed; your data is exactly as it was before this start."
  echo "  Back up ${DATA_DIR}/homeplace.db before trying anything, and report the"
  echo "  message: a schema an existing installation cannot apply is a bug here,"
  echo "  not something you should have to fix by hand."
  exit 1
fi

echo "→ starting HomePlace on port ${PORT:-3200}"
exec su-exec "$PUID:$PGID" "$@"
