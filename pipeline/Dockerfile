# JellyJet orchestrator + album watcher.
# beets runs inside this container, so beets and its plugins live here.

FROM python:3.12-slim

# beets core ships the musicbrainz / inline / scrub plugins; fetchart needs
# requests, embedart needs an imaging backend (pillow). No chroma plugin, so no
# fpcalc/chromaprint needed.
RUN pip install --no-cache-dir \
      "beets>=2.4" \
      "requests>=2.31" \
      "pillow>=10" \
 && beet version

ENV PYTHONUNBUFFERED=1 \
    JJ_MUSIC_ROOT=/music \
    JJ_CONFIG_DIR=/config \
    JJ_BEET_CONFIG=/beets/config.yaml

WORKDIR /app
COPY watcher.py .

CMD ["python", "watcher.py"]
