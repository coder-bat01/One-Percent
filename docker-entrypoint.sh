#!/bin/sh
set -e

export HOSTNAME=0.0.0.0

# Render mounts persistent disks as root-owned. Start as root only long enough
# to make the database directory writable, then drop to the unprivileged node
# user for the actual application process.
#
# This also covers the diskless free plan, where the database lives inside the
# container (for example /app/.data/one-percent.sqlite).
if [ "$(id -u)" = "0" ]; then
  database="${DATABASE_PATH:-/data/one-percent.sqlite}"
  mkdir -p "$(dirname "$database")"
  chown -R node:node "$(dirname "$database")"
  exec gosu node "$@"
fi

exec "$@"
