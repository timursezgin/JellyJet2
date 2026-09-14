# pipeline/ — the tim-box side of "Add albums"

The **orchestrator** = the album watcher + a small HTTP API that JellyJet 2's
Add albums screen calls through `/pipeline` (Caddy forwards it to port 8420). It
runs as a Docker container beside slskd, auto-built by GitHub Actions
(`.github/workflows/orchestrator-image.yml`) and auto-pulled on tim-box by
Watchtower. `watcher.py` is the source; `Dockerfile` + `beets-docker.yaml` +
`docker-compose.full-example.yml` are the container setup.

Moved here from JellyJet v1 (github.com/timursezgin/JellyJet, commit `4961510`),
where the image was `ghcr.io/timursezgin/jellyjet-orchestrator`. The unused
`write_expected_count.py` was left behind.

Nothing here ships in the web app.

## Run it (Docker, on tim-box) — auto-updating

The orchestrator image is **built by GitHub Actions** on every push that touches
`pipeline/watcher.py` or `pipeline/Dockerfile`, and pushed to
`ghcr.io/timursezgin/jellyjet2-orchestrator:latest`. A **Watchtower** container on
tim-box pulls the new image within ~5 minutes. After the one-time setup below you
never rebuild or copy anything.

### One-time setup

1. **Stop the old ways** if present:
   ```powershell
   Unregister-ScheduledTask -TaskName "JellyJet Orchestrator" -Confirm:$false -ErrorAction SilentlyContinue
   Get-Process python* -ErrorAction SilentlyContinue | Stop-Process -Force
   ```

2. **Files on the host** (under `…\Music\_pipeline\`):
   - `beets\config-docker.yaml`  ← copy `beets-docker.yaml` from this folder
   - `orchestrator\orchestrator.json` — keep (has the slskd username/password);
     `api_key.txt` / `state.json` / `jobs.json` stay put.
   - `orchestrator\watcher.py` / `Dockerfile` are **no longer needed on the
     host** — they live in the image now.

3. **Compose file** — replace `…\_pipeline\slskd\docker-compose.yml` with
   `docker-compose.full-example.yml` from this folder (your slskd service +
   `orchestrator` on the GHCR image + `watchtower`).

4. **Make the image public, once.** After the first GitHub Actions run:
   GitHub → your profile → **Packages** → `jellyjet2-orchestrator` → *Package
   settings* → **Change visibility → Public**. (The image contains no secrets —
   creds are all in env / the `/config` volume.) Otherwise tim-box would need a
   `docker login ghcr.io`.

5. **Start everything:**
   ```powershell
   cd "C:\Users\Windows 11\Desktop\Music\_pipeline\slskd"
   docker compose pull
   docker compose up -d
   ```

`slskd`, `jellyjet-orchestrator` and `watchtower` show up in Docker Desktop.
From now on: I push → GitHub builds → Watchtower updates it here. Watchtower is
scoped by label so it **only** touches the orchestrator, never slskd.

### Sanity check / logs

```powershell
curl http://localhost:8420/ping                     # -> {"ok": true, ...}
docker compose logs -f orchestrator                  # the watcher/API
docker compose logs watchtower                       # what it's pulled
```

To force an update instead of waiting: `docker compose pull orchestrator && docker compose up -d orchestrator`.

## The API (for reference)

Base: `http://100.115.48.57:8420` · all routes except `/ping` need
`Authorization: Bearer <api_key>`.

| Route | |
|---|---|
| `GET /ping` | liveness, no auth (still answers `"service": "jellyjet-orchestrator"`) |
| `GET /whoami` | verifies the key |
| `GET /search?q=<text>&wait=10` | `{ results: [ {id,user,dir,folderName,artist,album,year,trackCount,totalBytes,bitrate,format,hasFreeSlot,queueLength,speed,expandedFromHit,files:[{filename,size,bitrate,length}]} ] }`. Each song hit is expanded to the peer's **whole folder** via a live `POST /users/{user}/directory` call (the desktop client's "Search for Additional Files in This Directory"). Nothing is stored. |
| `POST /download` | body `{user, dir, folderName, artist, album, files:[{filename,size}]}` → `{jobId}`. Queues the folder in slskd and records a job. |
| `GET /jobs` | `{ jobs: [ {jobId,artist,album,folderName,trackCount,state,progress,note,queuedAt} ] }` — `state` ∈ `queued · downloading · tagging · inLibrary · failed`. `failed` jobs stay until dismissed. |
| `DELETE /jobs/{id}` | drop / dismiss a job. If it's still in flight: two-phase cancel of the slskd transfer(s) (stop, then `?remove=true` once settled — slskd errors on removing a live transfer) and `rmtree` of its `complete/` + `downloading/` folders (incl. the `<user>/<folder>` layout), retried once. If finished/failed: just removes the record. |

## Watcher logic

A folder in `1-Downloading\complete\` is judged from slskd's own transfer
records, not a stored count — **whatever the chosen folder ends up containing is
the album**, as long as every file slskd queued for it actually arrived:

- **settling** while any audio file landed in the last 30s (slskd confirms quiet)
  or 120s (slskd unreachable) — lets slow sequential downloads catch up;
- **downloading** while slskd has an in-progress/queued transfer for it;
- once quiet + no active transfer → **complete** (every transfer finished) or
  **incomplete** (any errored/cancelled).

**complete** → beets (autotag, then `-A` as-is fallback) → moved straight into
the Jellyfin library (`directory:` in `config-docker.yaml`, currently `2-MainLib`)
as `$albumartist/$album`; an existing artist folder is reused, not duplicated.
**incomplete** or **unfilable** → the folder is **deleted** (no partial ever
reaches beets or the library) and the matching job is marked `failed`.
Empty leftover folders are removed after 10 min if slskd isn't still feeding them.

No `.expected_count` sidecar, no `state.json` — the watcher deletes every folder
it finishes with, so there's nothing to dedup.

## Notes / assumptions to confirm

- slskd v0 routes used: `POST /session`, `POST /searches` + `GET /searches/{id}` +
  `GET /searches/{id}/responses`, `POST /users/{user}/directory`,
  `POST /transfers/downloads/{user}`, `GET /transfers/downloads`,
  `GET /application`.
- slskd puts completed files flat in `1-Downloading\complete\<album>\` but stages
  incomplete transfers under `1-Downloading\downloading\<username>\<remote path>\`.
  The watcher finds the album folder wherever the audio actually sits (any
  depth); cancel + the sweeper remove the whole nested tree and prune the empty
  `<username>\...` shells.
- A sweeper also cleans leftovers out of `1-Downloading\downloading`, but only a
  folder/file that slskd has **no active transfer for** *and* that hasn't changed
  in `SWEEP_SETTLE_MINUTES` (15). If slskd is unreachable it sweeps nothing.
