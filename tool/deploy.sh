#!/bin/sh
# Builds JellyJet 2 and copies it to tim-box's Desktop\JellyJet2 folder, where
# the JellyJet2 container serves it. The container picks up new files at once;
# only a Caddyfile or docker-compose.yml change needs a restart on tim-box.
set -eu

export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.."

TARGET="/Volumes/Users/Windows 11/Desktop/JellyJet2"
if [ ! -d "$TARGET" ]; then
  echo "Can't see $TARGET - is tim-box's share mounted?" >&2
  exit 1
fi

npm run build

mkdir -p "$TARGET/site"
# Hashed build files first, the page and service worker last, so a phone never
# loads a page whose files haven't arrived yet.
rsync -r --exclude '*.map' --exclude index.html --exclude sw.js dist/ "$TARGET/site/"
rsync dist/sw.js dist/index.html "$TARGET/site/"
# Old hashed build files are removed once the new page is in place.
rsync -r --delete --exclude '*.map' dist/ "$TARGET/site/"

cmp -s deploy/Caddyfile "$TARGET/Caddyfile" || {
  cp deploy/Caddyfile "$TARGET/Caddyfile"
  echo "Caddyfile changed - run 'docker compose restart' in Desktop\\JellyJet2 on tim-box."
}
cmp -s deploy/docker-compose.yml "$TARGET/docker-compose.yml" || {
  cp deploy/docker-compose.yml "$TARGET/docker-compose.yml"
  echo "docker-compose.yml changed - run 'docker compose up -d' in Desktop\\JellyJet2 on tim-box."
}

echo "Published JellyJet 2 ($(git rev-parse --short HEAD 2>/dev/null || echo local))."
