#!/bin/sh
# Container entrypoint (PID 1 is tini). Runs from the service's own directory, so relative defaults such as
# ../../deployments/<chainId>.json and ./data/ resolve exactly as in development, and always as the
# unprivileged `node` user: when started as root it first hands mounted volumes (Fly mounts them root-owned)
# to `node`, then drops privileges.
set -eu
cd "/app/services/${SERVICE}"
if [ "$(id -u)" = "0" ]; then
  for dir in ${DATA_DIRS:-/data}; do
    if [ -d "$dir" ]; then chown -R node:node "$dir"; fi
  done
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"
