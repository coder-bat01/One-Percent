#!/bin/sh
set -e

# Render (and some other hosts) mount persistent disks as root-owned. Start as
# root only long enough to make the database directory writable, then drop to
# the unprivileged node user for the actual application process.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R node:node /data
  export HOSTNAME=0.0.0.0
  exec gosu node "$@"
fi

export HOSTNAME=0.0.0.0
exec "$@"
