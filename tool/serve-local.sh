#!/bin/sh
# Serves the production build (dist/) on http://localhost:8792 exactly as the
# JellyJet2 container does, for testing the service worker and downloads.
#   sh tool/serve-local.sh                 → your real Jellyfin over Tailscale
#   JELLYFIN_UPSTREAM=localhost:8793 sh tool/serve-local.sh   → the tests' pretend server
#   (PIPELINE_UPSTREAM=localhost:8795 for the extras test's pretend download server)
cd "$(dirname "$0")/.."
export LISTEN="http://:8792"
export SITE_ROOT="$PWD/dist"
export JELLYFIN_UPSTREAM="${JELLYFIN_UPSTREAM:-100.115.48.57:8096}"
export PIPELINE_UPSTREAM="${PIPELINE_UPSTREAM:-100.115.48.57:8420}"
exec /opt/homebrew/bin/caddy run --config deploy/Caddyfile --adapter caddyfile
