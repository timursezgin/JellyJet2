"""
JellyJet orchestrator + album watcher (single process).

Two jobs in one:

1. WATCHER: watches Music/1-Downloading/complete for album folders and hands
   them to beets once a folder is done. "Done" is decided from slskd itself:
     - a folder is still SETTLING while any audio file landed in the last
       SETTLE_SECONDS_CONFIRMED (30s) — lets slow, sequential downloads catch up;
     - it's DOWNLOADING while slskd reports an active transfer for it;
     - once quiet + slskd shows no active transfer: COMPLETE if every transfer
       finished, INCOMPLETE if any errored/cancelled.
   COMPLETE -> beets tags it and moves it straight into the Jellyfin library
   (beets' `directory:`, currently 2-MainLib) under $albumartist/$album — an
   existing artist folder is reused, not duplicated.
   INCOMPLETE / unfilable -> the folder is DELETED (no partial ever reaches
   beets or the library) and the app's job is marked failed.
   Empty leftover folders are removed after EMPTY_FOLDER_GRACE_SECONDS.

2. ORCHESTRATOR HTTP API: a small JSON API the iOS app calls over Tailscale. It
   proxies Soulseek search/queue to the local slskd instance so the app never
   touches slskd directly and slskd's credentials never leave this machine.
   /search expands each song hit to the peer's whole shared folder (like the
   desktop client's "Search for Additional Files in This Directory").

   Endpoints (all except /ping require  Authorization: Bearer <api key> ):
     GET  /ping                      -> {"ok": true}         (no auth)
     GET  /whoami                    -> {"ok": true}         (checks the key)
     GET  /search?q=<text>           -> {"results": [ ...album folders... ]}
          &format=mp3                   only folders whose songs are all MP3
     POST /download                  -> {"jobId": "..."}     queue a whole album
     GET  /jobs                      -> {"jobs": [ ...status... ]}

Config: create  _pipeline/orchestrator/orchestrator.json  next to this file:
    {
      "slskd_url": "http://localhost:5030",
      "slskd_username": "tim",
      "slskd_password": "<slskd web password>",
      "api_port": 8420,
      "api_host": "0.0.0.0"
    }
If that file is missing the HTTP API stays off and only the watcher runs.

The API key is generated on first run and written to
  _pipeline/orchestrator/api_key.txt  -- copy that string into the app once.

Run continuously (Task Scheduler at login, or a terminal):  python watcher.py
One-off check of the slskd connection:                       python watcher.py --selftest
"""

import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# --- Paths ------------------------------------------------------------------
# Defaults are the Windows host layout; the Docker image overrides them with
# JJ_MUSIC_ROOT=/music, JJ_CONFIG_DIR=/config, JJ_BEET_CONFIG=/beets/config.yaml.

MUSIC = Path(os.environ.get("JJ_MUSIC_ROOT", r"C:\Users\Windows 11\Desktop\Music"))
WATCH_DIR = MUSIC / "1-Downloading" / "complete"
INCOMPLETE_DIR = MUSIC / "1-Downloading" / "downloading"
ORCH_DIR = Path(os.environ.get("JJ_CONFIG_DIR", str(MUSIC / "_pipeline" / "orchestrator")))
JOBS_FILE = ORCH_DIR / "jobs.json"
CONFIG_FILE = ORCH_DIR / "orchestrator.json"
API_KEY_FILE = ORCH_DIR / "api_key.txt"
BEET_CONFIG = Path(os.environ.get(
    "JJ_BEET_CONFIG", str(MUSIC / "_pipeline" / "beets" / "config.yaml")))

# "beet" on PATH by default; override in orchestrator.json ("beet_path") if a
# scheduled task can't find it (e.g. full path to beet.exe).
BEET_CMD = "beet"

POLL_SECONDS = 20          # how often the watcher loop checks
JOB_KEEP_HOURS = 48        # drop finished (in-library) jobs from /jobs after this

# A folder in complete/ is "settled" when no audio file has landed for this long.
# Short when slskd confirms it has no active transfer for the folder; the longer
# blind value only applies if slskd is unreachable.
SETTLE_SECONDS_CONFIRMED = 30
SETTLE_SECONDS_BLIND = 120
# An empty (no-audio) folder — a cancelled/aborted download shell — is removed
# once it has been untouched this long.
EMPTY_FOLDER_GRACE_SECONDS = 600

SWEEP_SETTLE_MINUTES = 15  # a downloading/ folder untouched this long, with no
                           # active slskd transfer, is a leftover -> remove it

AUDIO_EXTS = {".mp3", ".flac", ".m4a", ".wma", ".ogg", ".wav", ".aac", ".opus"}

# Formats /search can be limited to (&format=...). For each: the one audio
# extension a folder's songs must all have (covers, .txt, .cue and other
# non-audio files don't count), and words the Soulseek search asks peers to
# leave out, so other formats don't use up the response limit. Peers apply the
# exclusions themselves and some ignore them; the extension check is what's
# guaranteed.
SEARCH_FORMATS = {
    "mp3": {
        "ext": ".mp3",
        "exclude": ["flac", "wav", "m4a", "alac", "ape", "aiff", "ogg", "opus", "wma", "aac"],
    },
}

# Keep child processes (beets) windowless if this ever runs on a Windows host
# outside Docker; a no-op (0) on Linux / in the container.
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

_io_lock = threading.Lock()   # guards jobs.json reads+writes


# ===========================================================================
# WATCHER
# ===========================================================================

def audio_files(folder: Path):
    return [p for p in folder.rglob("*") if p.suffix.lower() in AUDIO_EXTS]


# slskd transfer states (substring match, case-insensitive).
_ACTIVE_STATES = ("queued", "inprogress", "initializing", "requested")
_FAILED_STATES = ("errored", "cancelled", "canceled", "rejected", "timedout", "timed out")


def _transfer_state_is(f, needles):
    s = str(f.get("state", "")).lower()
    return any(n in s for n in needles)


def _files_for_folder(all_downloads, folder_name):
    """slskd download-file records whose remote path contains [folder_name].
    [all_downloads] is one GET /transfers/downloads payload; None means slskd
    was unreachable this tick."""
    if all_downloads is None:
        return None
    key = folder_name.lower()
    hits = []
    for entry in (all_downloads if isinstance(all_downloads, list) else [all_downloads]):
        for d in (entry.get("directories") or []):
            for f in (d.get("files") or []):
                if key and key in (f.get("filename") or "").lower():
                    hits.append(f)
    return hits


def folder_verdict(folder: Path, all_downloads):
    """One of: 'empty' | 'downloading' | 'settling' | 'incomplete' | 'complete'.

    The download is judged from slskd's own transfer records, not from a file
    count we stored — whatever the chosen folder ends up containing IS the
    album, as long as every file slskd queued for it actually arrived.
    """
    files = audio_files(folder)
    if not files:
        return "empty", "no audio files"

    quiet_for = time.time() - max(p.stat().st_mtime for p in files)
    transfers = _files_for_folder(all_downloads, folder.name)

    if transfers is not None and any(_transfer_state_is(f, _ACTIVE_STATES) for f in transfers):
        return "downloading", "slskd still transferring"

    threshold = SETTLE_SECONDS_CONFIRMED if transfers is not None else SETTLE_SECONDS_BLIND
    if quiet_for < threshold:
        return "settling", f"quiet {int(quiet_for)}s / {threshold}s"

    if transfers is None:
        return "complete", f"quiet {int(quiet_for)}s, slskd unreachable — assuming complete"
    if any(_transfer_state_is(f, _FAILED_STATES) for f in transfers):
        done = sum(1 for f in transfers if _transfer_state_is(f, ("completed",)))
        return "incomplete", f"{done}/{len(transfers)} files arrived, the rest errored or were cancelled"
    return "complete", "all transfers finished, none failed"


def _rmtree_quiet(path: Path, why: str):
    try:
        if path.exists():
            shutil.rmtree(path)
            print(f"[watcher] deleted {why}: {path}")
    except OSError as e:
        print(f"[watcher] couldn't delete {path}: {e}", file=sys.stderr)


def _beets_import(folder: Path, noautotag: bool = False):
    # --noincremental: the watcher deletes folders it finishes with, so beets'
    # own incremental tracking would just get in the way (a folder it skipped
    # once could never be retried).
    args = [BEET_CMD, "-c", str(BEET_CONFIG), "import", "-q", "--noincremental"]
    if noautotag:
        args.append("-A")   # don't autotag; use the files' own metadata
    args.append(str(folder))
    result = subprocess.run(args, capture_output=True, text=True,
                            creationflags=_NO_WINDOW)
    mode = "as-is" if noautotag else "autotag"
    out = result.stdout.strip()
    print(f"[watcher] beets ({mode}) rc={result.returncode}"
          + (f":\n{out}" if out else " (no output)"))
    if result.stderr.strip():
        print(f"[watcher] beets ({mode}) stderr:\n{result.stderr.strip()}", file=sys.stderr)
    return result


def import_folder(folder: Path) -> bool:
    """Hand a folder to beets. Returns True only if beets actually moved the
    audio out (that's the real success signal — `beet import -q` exits 0 even
    when it *skips* an album it can't confidently match).

    Autotag first; if that skips the album, retry as-is (`-A`) so a release with
    odd tags still files using its own metadata rather than being called a
    failure.
    """
    if not audio_files(folder):
        return False
    print(f"[watcher] handing off to beets: {folder}")
    _beets_import(folder)
    if not audio_files(folder):
        return True
    print(f"[watcher] beets couldn't match {folder.name}; importing as-is")
    _beets_import(folder, noautotag=True)
    if not audio_files(folder):
        return True
    print(f"[watcher] {folder.name} still has audio after both passes — will retry",
          file=sys.stderr)
    return False


def _newest_mtime_within(folder: Path) -> float:
    newest = folder.stat().st_mtime
    try:
        for p in folder.rglob("*"):
            try:
                newest = max(newest, p.stat().st_mtime)
            except OSError:
                pass
    except OSError:
        pass
    return newest


def _dirs_holding_files(root: Path):
    """Every directory under [root] that directly contains at least one file.
    slskd nests incomplete transfers as <username>/<remote path>/<album>, so the
    interesting level is wherever the actual audio sits, at any depth."""
    out = set()
    try:
        for p in root.rglob("*"):
            if p.is_file():
                out.add(p.parent)
    except OSError:
        pass
    out.discard(root)
    return out


def _prune_empty_dirs(root: Path):
    """Remove now-empty directories under [root] (deepest first), leaving [root]."""
    if not root.exists():
        return
    try:
        dirs = sorted((p for p in root.rglob("*") if p.is_dir()),
                      key=lambda p: len(p.parts), reverse=True)
    except OSError:
        return
    for d in dirs:
        try:
            if not any(d.iterdir()):
                d.rmdir()
        except OSError:
            pass


def sweep_downloading(all_downloads):
    """Remove leftover folders slskd abandoned in 1-Downloading/downloading.

    Only ever touches an album folder that (a) slskd has NO in-progress/queued
    transfer for, and (b) hasn't changed in SWEEP_SETTLE_MINUTES — so an active
    download (which writes files one at a time) is never at risk. If slskd can't
    be reached, nothing is swept. Then prunes the empty <username>/... dirs.
    """
    if not INCOMPLETE_DIR.exists():
        return
    active = active_transfer_dirs(all_downloads)
    if active is None:
        return

    settle = SWEEP_SETTLE_MINUTES * 60
    now = time.time()
    for d in _dirs_holding_files(INCOMPLETE_DIR):
        try:
            if d.name in active:
                continue
            if now - _newest_mtime_within(d) < settle:
                continue
            shutil.rmtree(d)
            print(f"[sweeper] removed stale folder: {d.relative_to(INCOMPLETE_DIR)}")
        except (OSError, ValueError) as e:
            print(f"[sweeper] could not remove {d}: {e}", file=sys.stderr)
    _prune_empty_dirs(INCOMPLETE_DIR)


def _folder_matches(dir_path: Path, folder_name: str) -> bool:
    """dir basename == folder_name, allowing slskd's 'exists: rename' suffix
    ('<folder> (1)')."""
    return bool(re.match(rf"{re.escape(folder_name)}(\s*\(\d+\))?$",
                         dir_path.name, re.IGNORECASE))


def purge_download_folders(folder_name: str):
    """Delete a cancelled download's files from 1-Downloading/complete and
    /downloading, wherever slskd put them — it nests incomplete transfers as
    <username>/<remote path>/<album> at arbitrary depth. Finds the album folder
    by name at any level, removes it, prunes the empty parents, retries once
    (Windows can briefly hold a handle after a cancel)."""
    if not folder_name:
        return
    for _ in range(2):
        stubborn = False
        for root in (WATCH_DIR, INCOMPLETE_DIR):
            if not root.exists():
                continue
            hits = [d for d in root.rglob("*")
                    if d.is_dir() and _folder_matches(d, folder_name)]
            for d in hits:
                try:
                    if d.exists():
                        shutil.rmtree(d)
                        print(f"[cleanup] removed {d}")
                except OSError as e:
                    print(f"[cleanup] {d}: {e}", file=sys.stderr)
                    stubborn = True
        _prune_empty_dirs(WATCH_DIR)
        _prune_empty_dirs(INCOMPLETE_DIR)
        if not stubborn:
            return
        time.sleep(1.5)


def cleanup_source_folder(folder: Path):
    if not folder.exists():
        return
    leftover_audio = audio_files(folder)
    if leftover_audio:
        print(f"[watcher] not cleaning up {folder}: "
              f"{len(leftover_audio)} audio file(s) still present")
        return
    try:
        shutil.rmtree(folder)
        print(f"[watcher] removed empty source folder: {folder}")
    except OSError as e:
        print(f"[watcher] could not remove {folder}: {e}", file=sys.stderr)


def watcher_tick(all_downloads):
    """One pass of the watch loop. [all_downloads] is this tick's GET
    /transfers/downloads payload (None if slskd was unreachable)."""
    if not WATCH_DIR.exists():
        print(f"[watcher] {WATCH_DIR} does not exist yet, waiting...")
        return

    # the album folder is wherever the audio actually sits — flat for most
    # peers, but slskd can nest it under <username>/<remote path>/
    folders = sorted(_dirs_holding_files(WATCH_DIR), key=lambda p: str(p).lower())
    for folder in folders:
        verdict, reason = folder_verdict(folder, all_downloads)
        print(f"[watcher] {folder.name}: {verdict} — {reason}")

        if verdict in ("downloading", "settling"):
            continue

        if verdict == "empty":
            # a cancelled/aborted download shell — remove it only once it's been
            # untouched a while AND slskd isn't still feeding it
            tx = _files_for_folder(all_downloads, folder.name)
            still_feeding = tx and any(_transfer_state_is(f, _ACTIVE_STATES) for f in tx)
            stale = time.time() - _newest_mtime_within(folder) > EMPTY_FOLDER_GRACE_SECONDS
            if stale and not still_feeding:
                _rmtree_quiet(folder, "empty leftover folder")
            continue

        if verdict == "incomplete":
            # A partial download never touches beets or the library.
            _mark_jobs_failed(folder.name, f"download didn't finish — {reason}")
            _rmtree_quiet(folder, "incomplete download")
            continue

        # verdict == "complete"
        if import_folder(folder):
            cleanup_source_folder(folder)          # removes the now-empty folder
            _mark_jobs_imported(folder.name)
            print(f"[watcher] {folder.name}: tagged and filed")
        else:
            # beets couldn't place the files (usually the album folder already
            # exists in the library). Don't loop on it — fail + delete.
            _mark_jobs_failed(folder.name,
                              "couldn't tag it — this album may already be in your library")
            _rmtree_quiet(folder, "unfilable folder")

    # clear the empty <username>/<remote path>/ shells slskd's nesting leaves
    _prune_empty_dirs(WATCH_DIR)


# ===========================================================================
# JOBS  (what the app queued, + computed status)
# ===========================================================================

def load_jobs():
    with _io_lock:
        if JOBS_FILE.exists():
            try:
                return json.loads(JOBS_FILE.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                pass
        return {}


def save_jobs(jobs):
    with _io_lock:
        JOBS_FILE.parent.mkdir(parents=True, exist_ok=True)
        JOBS_FILE.write_text(json.dumps(jobs, indent=2), encoding="utf-8")


def _mark_jobs_imported(folder_name: str):
    jobs = load_jobs()
    changed = False
    for j in jobs.values():
        if j.get("folderName") == folder_name and j.get("state") != "inLibrary":
            j["state"] = "inLibrary"
            j["finishedAt"] = time.time()
            changed = True
    if changed:
        save_jobs(jobs)


def _mark_jobs_failed(folder_name: str, note: str):
    jobs = load_jobs()
    changed = False
    for j in jobs.values():
        if j.get("folderName") == folder_name and j.get("state") not in ("inLibrary", "failed"):
            j["state"] = "failed"
            j["note"] = note
            j["finishedAt"] = time.time()
            changed = True
    if changed:
        save_jobs(jobs)


def prune_jobs():
    jobs = load_jobs()
    cutoff = time.time() - JOB_KEEP_HOURS * 3600
    kept = {k: v for k, v in jobs.items()
            if not (v.get("state") == "inLibrary" and v.get("finishedAt", 0) < cutoff)}
    if len(kept) != len(jobs):
        save_jobs(kept)


# ===========================================================================
# slskd CLIENT  (stdlib only)
# ===========================================================================

class SlskdHttpError(RuntimeError):
    def __init__(self, code, body, path):
        self.code = code
        self.body = body
        super().__init__(f"slskd {path} -> HTTP {code}: {body[:300]}")


class Slskd:
    """Minimal client for the local slskd REST API (v0). Auth token is cached
    and refreshed on 401."""

    def __init__(self, base_url, username, password):
        self.base = base_url.rstrip("/") + "/api/v0"
        self.username = username
        self.password = password
        self._token = None
        self._lock = threading.Lock()

    # -- transport --------------------------------------------------------

    def _raw(self, method, path, body=None, token=None, timeout=20):
        url = self.base + path
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return None
            ct = resp.headers.get("Content-Type", "")
            if "json" in ct:
                return json.loads(raw)
            return raw.decode("utf-8", "replace")

    def _login(self):
        res = self._raw("POST", "/session", {
            "username": self.username, "password": self.password,
        })
        tok = (res or {}).get("token")
        if not tok:
            raise RuntimeError(f"slskd login: no token in response ({res!r})")
        self._token = tok
        return tok

    def call(self, method, path, body=None, timeout=20):
        with self._lock:
            token = self._token or self._login()
        try:
            return self._raw(method, path, body, token, timeout)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                with self._lock:
                    token = self._login()
                try:
                    return self._raw(method, path, body, token, timeout)
                except urllib.error.HTTPError as e2:
                    raise SlskdHttpError(e2.code, e2.read().decode("utf-8", "replace"), path)
            raise SlskdHttpError(e.code, e.read().decode("utf-8", "replace"), path)

    # -- features --------------------------------------------------------

    def search(self, text, wait_seconds=55):
        """Returns (responses, meta).

        Two slskd quirks handled here:
          * /searches/{id}/responses stays empty until the search is complete;
            a search with few responses can sit "InProgress" a long time, so we
            poll briefly then PUT /searches/{id} to stop it.
          * even once slskd reports responseCount > 0 / isComplete, the
            /responses endpoint lags by a second or two — so we retry the fetch
            until it actually returns the rows (or we give up).
        """
        sid = str(uuid.uuid4())
        try:
            self.call("POST", "/searches", {
                "id": sid, "searchText": text, "responseLimit": 250,
            })
        except SlskdHttpError:
            self.call("POST", "/searches", {"id": sid, "searchText": text})

        def _done(m):
            return bool(m.get("isComplete")) or "completed" in str(m.get("state", "")).lower()

        deadline = time.time() + wait_seconds
        meta = {}
        while time.time() < deadline:
            time.sleep(1.5)
            try:
                meta = self.call("GET", f"/searches/{sid}") or {}
            except (urllib.error.HTTPError, SlskdHttpError):
                meta = {}
            if _done(meta):
                break

        if not _done(meta):
            try:
                self.call("PUT", f"/searches/{sid}")   # stop it
            except (urllib.error.HTTPError, SlskdHttpError):
                pass

        # /responses materialises a beat after the search is "done" — retry.
        responses = []
        expected = None
        for _ in range(6):
            try:
                meta = self.call("GET", f"/searches/{sid}") or meta
                expected = meta.get("responseCount")
            except (urllib.error.HTTPError, SlskdHttpError):
                pass
            try:
                got = self.call("GET", f"/searches/{sid}/responses") or []
            except (urllib.error.HTTPError, SlskdHttpError):
                got = []
            if len(got) > len(responses):
                responses = got
            if responses and (expected is None or len(responses) >= expected):
                break
            time.sleep(1.0)

        try:
            self.call("DELETE", f"/searches/{sid}")
        except Exception:
            pass
        meta = {k: meta.get(k) for k in ("responseCount", "fileCount", "state", "isComplete")}
        return responses, meta

    def enqueue(self, username, files):
        """Queue a download. slskd's request shape has drifted between versions,
        so try the known ones in order and raise the last error if all fail."""
        uq = urllib.parse.quote(username)
        arr = [{"filename": f["filename"], "size": int(f.get("size") or 0)} for f in files]
        attempts = [
            ("POST", f"/transfers/downloads/{uq}", arr),
            ("POST", f"/transfers/downloads/{uq}", {"files": arr}),
            ("POST", "/transfers/downloads", {"username": username, "files": arr}),
        ]
        last = None
        for method, path, body in attempts:
            try:
                return self.call(method, path, body)
            except SlskdHttpError as e:
                last = e
                print(f"[api] enqueue {path} failed HTTP {e.code}: {e.body[:200]}", file=sys.stderr)
                if e.code == 401:
                    raise
        raise last

    def downloads_for(self, username):
        try:
            return self.call("GET",
                             f"/transfers/downloads/{urllib.parse.quote(username)}")
        except (urllib.error.HTTPError, SlskdHttpError):
            return None

    def cancel_downloads(self, username, dir_match):
        """Stop + forget every transfer from [username] whose path contains
        [dir_match]. Returns how many live transfers it stopped.

        Two phases, because slskd rejects ?remove=true on a transfer that is
        still in progress (this is the error that used to surface in the app and
        left the download stuck in slskd's list):
          1. DELETE (no query)  -> cancels a running/queued transfer
          2. DELETE ?remove=true -> drops the now-Completed/Cancelled record
        Phase 2 also mops up any older Completed/Errored rows for the same
        folder so slskd's transfer list doesn't accumulate dead entries.
        """
        uq = urllib.parse.quote(username)

        def _matching():
            dl = self.downloads_for(username) or []
            out = []
            for entry in (dl if isinstance(dl, list) else [dl]):
                for d in (entry.get("directories") or []):
                    for f in (d.get("files") or []):
                        fn = f.get("filename") or ""
                        if f.get("id") and (not dir_match or dir_match in fn):
                            out.append((f["id"], str(f.get("state", ""))))
            return out

        stopped = 0
        for tid, state in _matching():
            if "Completed" in state or "Cancelled" in state:
                continue
            try:
                self.call("DELETE", f"/transfers/downloads/{uq}/{tid}")
                stopped += 1
            except (urllib.error.HTTPError, SlskdHttpError) as e:
                print(f"[api] cancel: stop {tid} -> {e}", file=sys.stderr)

        time.sleep(1.0)  # let slskd settle the cancelled transfers

        for tid, _ in _matching():
            try:
                self.call("DELETE", f"/transfers/downloads/{uq}/{tid}?remove=true")
            except (urllib.error.HTTPError, SlskdHttpError) as e:
                print(f"[api] cancel: forget {tid} -> {e}", file=sys.stderr)

        return stopped

    def all_downloads(self):
        try:
            return self.call("GET", "/transfers/downloads") or []
        except (urllib.error.HTTPError, SlskdHttpError):
            return None   # None = "couldn't tell" (caller must not sweep blindly)

    def list_directory(self, username, directory, timeout=8):
        """Ask a peer for the full contents of one shared folder (the desktop
        client's "Search for Additional Files in This Directory"). Returns a flat
        list of file dicts, or [] if the peer didn't answer."""
        uq = urllib.parse.quote(username, safe="")
        attempts = (
            ("POST", f"/users/{uq}/directory", {"directory": directory}),
            ("POST", f"/users/{uq}/directory", {"directoryName": directory}),
            ("POST", f"/users/{uq}/directory", directory),
        )
        for method, path, body in attempts:
            try:
                res = self.call(method, path, body, timeout=timeout)
            except (urllib.error.HTTPError, SlskdHttpError, TimeoutError, OSError):
                continue
            files = []
            if isinstance(res, dict):
                files = res.get("files") or []
                for d in (res.get("directories") or []):
                    files.extend(d.get("files") or [])
            elif isinstance(res, list):
                for d in res:
                    if isinstance(d, dict):
                        files.extend(d.get("files") or [])
            if files:
                return files
        return []

    def application(self):
        return self.call("GET", "/application")


def active_transfer_dirs(dl):
    """Set of folder basenames slskd currently has an in-progress/queued download
    for. [dl] is a GET /transfers/downloads payload (None -> return None so
    callers skip sweeping)."""
    if dl is None:
        return None
    active = set()
    for entry in (dl if isinstance(dl, list) else [dl]):
        for d in (entry.get("directories") or []):
            for f in (d.get("files") or []):
                if _transfer_state_is(f, _ACTIVE_STATES):
                    fn = (f.get("filename") or "").replace("/", "\\")
                    parts = [x for x in fn.split("\\") if x]
                    if len(parts) >= 2:
                        active.add(parts[-2])
    return active


# ===========================================================================
# SEARCH RESULT SHAPING  (group a peer's files into album folders)
# ===========================================================================

def _split_path(remote_path):
    p = remote_path.replace("/", "\\")
    parts = [x for x in p.split("\\") if x]
    return parts


def _folder_name(remote_path):
    parts = _split_path(remote_path)
    return parts[-2] if len(parts) >= 2 else (parts[0] if parts else "download")


def _dir_of(remote_path):
    p = remote_path.replace("/", "\\")
    return p.rsplit("\\", 1)[0] if "\\" in p else p


# Common non-artist folder names to ignore when guessing the artist from the
# directory above the album folder.
_JUNK_DIRS = {
    "music", "musik", "musique", "shared", "share", "sharing", "complete",
    "completed", "downloads", "download", "soulseek", "soulseek downloads",
    "slsk", "slskd", "collection", "my music", "albums", "discography",
    "flac", "mp3", "lossless", "media", "audio", "@@root", "root",
}
_DASHES = [" - ", " – ", " — ", " ‒ ", "_-_", " -", "- "]


def _guess_artist_album(folder, parent):
    """Best-effort '<Artist> - <Album> (<year>)' parse.

    [folder] is the album folder name, [parent] the directory above it (often the
    artist on a Soulseek share, but just as often junk). Falls back gracefully:
    a null artist is expected and fine — beets fixes tags on import anyway.
    """
    name = folder
    year = None
    m = re.search(r"[\(\[]?(\b(19|20)\d{2})\b[\)\]]?", name)
    if m:
        year = int(m.group(1))
        name = (name[:m.start()] + name[m.end():])
        name = re.sub(r"[\[\]()]{1,}", " ", name)
        name = re.sub(r"\s{2,}", " ", name).strip(" -_.")

    artist, album = None, name
    for sep in _DASHES:
        if sep in name:
            left, right = name.split(sep, 1)
            if left.strip() and right.strip():
                artist, album = left.strip(), right.strip()
                break

    if artist is None and parent:
        cand = parent.strip(" -_.")
        if cand and cand.lower() not in _JUNK_DIRS and not cand.startswith("@@"):
            artist = cand

    return artist, album, year


def shape_results(responses, min_tracks=1, only_ext=None):
    """Group search hits into album folders. With [only_ext] (e.g. ".mp3"), a
    folder with any other kind of audio file is left out."""
    out = []
    for r in responses or []:
        user = r.get("username")
        files = r.get("files") or []
        by_dir = {}
        for f in files:
            fn = f.get("filename", "")
            ext = ("." + f.get("extension", "").lstrip(".")).lower() if f.get("extension") else Path(fn).suffix.lower()
            if ext not in AUDIO_EXTS:
                continue
            by_dir.setdefault(_dir_of(fn), []).append({
                "filename": fn,
                "size": f.get("size", 0),
                "bitRate": f.get("bitRate"),
                "length": f.get("length"),
                "ext": ext.lstrip("."),
            })
        for d, dfiles in by_dir.items():
            if len(dfiles) < min_tracks:
                continue
            if only_ext and any("." + x["ext"] != only_ext for x in dfiles):
                continue
            dparts = _split_path(d)
            folder = dparts[-1] if dparts else d
            parent = dparts[-2] if len(dparts) >= 2 else None
            artist, album, year = _guess_artist_album(folder, parent)
            bitrates = [x["bitRate"] for x in dfiles if x.get("bitRate")]
            exts = {x["ext"] for x in dfiles}
            out.append({
                "id": f"{user}::{d}",
                "user": user,
                "dir": d,
                "folderName": folder,
                "artist": artist,
                "album": album,
                "year": year,
                "trackCount": len(dfiles),
                "totalBytes": sum(x["size"] for x in dfiles),
                "bitrate": round(sum(bitrates) / len(bitrates)) if bitrates else None,
                "format": "/".join(sorted(exts)),
                "hasFreeSlot": r.get("hasFreeUploadSlot", False),
                "queueLength": r.get("queueLength", 0),
                "speed": r.get("uploadSpeed", 0),
                "files": [
                    {
                        "filename": x["filename"],
                        "size": x["size"],
                        "bitrate": x.get("bitRate"),
                        "length": x.get("length"),
                    }
                    for x in sorted(dfiles, key=lambda z: z["filename"].lower())
                ],
            })
    _sort_results(out)
    return out


def _sort_results(results):
    # nicest first: free slot, then more tracks, then higher bitrate
    results.sort(key=lambda x: (not x["hasFreeSlot"], -x["trackCount"], -(x["bitrate"] or 0)))


# How many audio files a "folder" can hold before we assume it's someone's whole
# library rather than one album, and stop treating it as a result.
_MAX_ALBUM_TRACKS = 60
_ENRICH_TOP_N = 12
_ENRICH_WORKERS = 8


def enrich_with_folders(results, slskd, top_n=_ENRICH_TOP_N, only_ext=None):
    """For the strongest results, replace the matched-only file list with the
    peer's *whole* folder listing (a live slskd 'directory contents' call — the
    desktop client's "Search for Additional Files in This Directory"). Nothing is
    stored. Folders that don't expand to a plausible album are dropped, and with
    [only_ext] so are folders whose full listing turns out to hold other audio.
    """
    if not results:
        return results
    targets = results[:top_n]

    def expand(r):
        try:
            raw = slskd.list_directory(r["user"], r["dir"])
        except Exception:
            raw = []
        audio = []
        for f in raw:
            name = f.get("filename") or f.get("name") or ""
            ext = Path(name).suffix.lower()
            if not ext and f.get("extension"):
                ext = "." + str(f["extension"]).lstrip(".").lower()
            if ext not in AUDIO_EXTS:
                continue
            if only_ext and ext != only_ext:
                r["wrongFormat"] = True
                return
            # directory responses put bitrate/length in an attributes[] array
            attrs = {str(a.get("type", "")).lower(): a.get("value")
                     for a in (f.get("attributes") or [])}
            full = name if ("\\" in name or "/" in name) else f"{r['dir']}\\{name}"
            audio.append({
                "filename": full,
                "size": f.get("size", 0),
                "bitrate": f.get("bitRate") or attrs.get("bitrate"),
                "length": f.get("length") or attrs.get("length"),
            })
        if len(audio) <= len(r["files"]) or len(audio) > _MAX_ALBUM_TRACKS:
            return  # peer didn't answer, nothing new, or it's a whole library
        audio.sort(key=lambda z: z["filename"].lower())
        r["files"] = audio
        r["trackCount"] = len(audio)
        r["totalBytes"] = sum(x["size"] for x in audio)
        brs = [x["bitrate"] for x in audio if x.get("bitrate")]
        if brs:
            r["bitrate"] = round(sum(brs) / len(brs))
        r["expandedFromHit"] = True

    with ThreadPoolExecutor(max_workers=_ENRICH_WORKERS) as ex:
        list(ex.map(expand, targets))

    # Keep multi-track folders and anything we successfully expanded; drop lone
    # loose files that couldn't be grown into an album — unless that leaves
    # nothing, in which case show the raw hits rather than an empty screen.
    results = [r for r in results if not r.get("wrongFormat")]
    kept = [r for r in results
            if r["trackCount"] >= 2 or r.get("expandedFromHit")]
    if not kept:
        kept = results[:3]
    _sort_results(kept)
    return kept[:40]


def job_status(job, slskd: Slskd):
    """A job's live state. The watcher writes the terminal states (inLibrary /
    failed) onto the job itself; everything else is derived from slskd + disk."""
    stored = job.get("state")
    if stored == "inLibrary":
        return {"state": "inLibrary", "progress": 1.0,
                "note": job.get("note") or "in your library"}
    if stored == "failed":
        return {"state": "failed", "progress": 0.0,
                "note": job.get("note") or "download didn't finish"}

    folder = job["folderName"]
    local = WATCH_DIR / folder
    on_disk = len(audio_files(local)) if local.exists() else 0

    dl = slskd.downloads_for(job["user"]) or []
    files = []
    for entry in (dl if isinstance(dl, list) else [dl]):
        for d in (entry.get("directories") or []):
            for f in (d.get("files") or []):
                fn = (f.get("filename") or "")
                if (job.get("dir") and job["dir"] in fn) or folder in fn:
                    files.append(f)

    if files:
        total = sum(f.get("size", 0) for f in files) or 1
        done = sum(f.get("bytesTransferred", 0) for f in files)
        if any(_transfer_state_is(f, _ACTIVE_STATES) for f in files):
            return {"state": "downloading", "progress": done / total,
                    "note": f"downloading {int(100 * done / total)}%"}
        if all(_transfer_state_is(f, _FAILED_STATES) for f in files):
            return {"state": "failed", "progress": 0.0, "note": "download failed"}

    if on_disk > 0:
        return {"state": "tagging", "progress": 1.0, "note": "tagging & filing"}
    age = time.time() - job.get("queuedAt", time.time())
    if age > 25 * 60:
        return {"state": "failed", "progress": 0.0, "note": "nothing arrived"}
    return {"state": "queued", "progress": 0.0, "note": "waiting for a slot"}


# ===========================================================================
# HTTP API
# ===========================================================================

class Api(BaseHTTPRequestHandler):
    slskd: Slskd = None
    api_key: str = None

    def log_message(self, fmt, *args):  # quieter logging
        print(f"[api] {self.address_string()} {fmt % args}")

    # -- helpers --------------------------------------------------------

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        got = self.headers.get("Authorization", "")
        if got == f"Bearer {self.api_key}":
            return True
        self._send(401, {"error": "bad or missing api key"})
        return False

    def _body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n))
        except ValueError:
            return {}

    # -- routes --------------------------------------------------------

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        route = u.path.rstrip("/")
        qs = urllib.parse.parse_qs(u.query)

        if route == "/ping":
            return self._send(200, {"ok": True, "service": "jellyjet-orchestrator"})
        if not self._authed():
            return
        if route == "/whoami":
            return self._send(200, {"ok": True})
        if route == "/slskd":
            try:
                app = self.slskd.application()
                return self._send(200, app if isinstance(app, dict) else {"raw": app})
            except Exception as e:
                return self._send(502, {"error": str(e)})
        if route == "/search":
            q = (qs.get("q") or [""])[0].strip()
            if len(q) < 2:
                return self._send(400, {"error": "q must be at least 2 characters"})
            fmt = (qs.get("format") or [""])[0].strip().lower()
            if fmt and fmt not in SEARCH_FORMATS:
                return self._send(400, {"error": f"format must be one of: {', '.join(SEARCH_FORMATS)}"})
            only = SEARCH_FORMATS.get(fmt)
            search_text = q
            if only:
                search_text = q + " " + " ".join("-" + w for w in only["exclude"])
            try:
                # keep headroom under the app's receive timeout for the
                # per-folder expansion pass that follows
                wait = max(5, min(75, int((qs.get("wait") or [42])[0])))
                responses, meta = self.slskd.search(search_text, wait_seconds=wait)
                only_ext = only["ext"] if only else None
                results = shape_results(responses, only_ext=only_ext)
                # Expand each hit to the peer's whole folder (the desktop
                # client's "Search for Additional Files in This Directory").
                results = enrich_with_folders(results, self.slskd, only_ext=only_ext)
                if not results:
                    print(f"[api] search '{q}' -> 0 results  slskd meta={meta}", file=sys.stderr)
                return self._send(200, {"results": results, "debug": meta})
            except Exception as e:
                return self._send(502, {"error": f"slskd search failed: {e}"})
        if route == "/jobs":
            jobs = load_jobs()
            out = []
            for jid, j in sorted(jobs.items(), key=lambda kv: -kv[1].get("queuedAt", 0)):
                try:
                    st = job_status(j, self.slskd)
                except Exception as e:
                    st = {"state": j.get("state", "queued"), "progress": 0.0, "note": f"status error: {e}"}
                out.append({
                    "jobId": jid, "artist": j.get("artist"), "album": j.get("album"),
                    "folderName": j.get("folderName"), "trackCount": j.get("fileCount"),
                    "queuedAt": j.get("queuedAt"), **st,
                })
            return self._send(200, {"jobs": out})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        route = urllib.parse.urlparse(self.path).path.rstrip("/")
        if not self._authed():
            return
        if route == "/download":
            b = self._body()
            user = b.get("user")
            files = b.get("files") or []
            folder = b.get("folderName") or (_folder_name(files[0]["filename"]) if files else None)
            if not (user and files and folder):
                return self._send(400, {"error": "need user, folderName and files[]"})
            try:
                self.slskd.enqueue(user, files)
            except Exception as e:
                return self._send(502, {"error": f"slskd enqueue failed: {e}"})

            jid = uuid.uuid4().hex[:12]
            jobs = load_jobs()
            jobs[jid] = {
                "user": user, "dir": b.get("dir") or _dir_of(files[0]["filename"]),
                "folderName": folder, "fileCount": len(files),
                "artist": b.get("artist"), "album": b.get("album"),
                "queuedAt": time.time(), "state": "downloading",
            }
            save_jobs(jobs)
            return self._send(200, {"jobId": jid})
        return self._send(404, {"error": "not found"})

    def do_DELETE(self):
        route = urllib.parse.urlparse(self.path).path.rstrip("/")
        if not self._authed():
            return
        m = re.match(r"^/jobs/([A-Za-z0-9]+)$", route)
        if not m:
            return self._send(404, {"error": "not found"})
        jid = m.group(1)
        jobs = load_jobs()
        job = jobs.get(jid)
        if not job:
            return self._send(404, {"error": "no such job"})

        in_flight = job.get("state") not in ("inLibrary", "failed")
        if in_flight:
            # still downloading/tagging: stop it and wipe anything on disk
            try:
                n = self.slskd.cancel_downloads(job["user"], job.get("dir") or job["folderName"])
                print(f"[api] cancel {jid}: stopped {n} slskd transfer(s)")
            except Exception as e:
                print(f"[api] cancel {jid}: slskd error {e}", file=sys.stderr)
            purge_download_folders(job.get("folderName") or "")

        jobs.pop(jid, None)
        save_jobs(jobs)
        return self._send(200, {"ok": True, "cancelled": in_flight})


# ===========================================================================
# STARTUP
# ===========================================================================

def read_config():
    """orchestrator.json, with env vars layered on top (env wins). The Docker
    image passes SLSKD_URL / SLSKD_USERNAME / SLSKD_PASSWORD so nothing sensitive
    has to live in a mounted file."""
    cfg = {}
    if CONFIG_FILE.exists():
        try:
            cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except (ValueError, OSError) as e:
            print(f"[orchestrator] bad {CONFIG_FILE}: {e}", file=sys.stderr)
    for env_key, cfg_key in (
        ("SLSKD_URL", "slskd_url"),
        ("SLSKD_USERNAME", "slskd_username"),
        ("SLSKD_PASSWORD", "slskd_password"),
        ("JJ_API_PORT", "api_port"),
        ("JJ_BEET_PATH", "beet_path"),
    ):
        if os.environ.get(env_key):
            cfg[cfg_key] = os.environ[env_key]
    if not cfg.get("slskd_url"):
        return None
    return cfg


def ensure_api_key():
    ORCH_DIR.mkdir(parents=True, exist_ok=True)
    if API_KEY_FILE.exists():
        k = API_KEY_FILE.read_text(encoding="utf-8").strip()
        if k:
            return k
    k = secrets.token_urlsafe(24)
    API_KEY_FILE.write_text(k, encoding="utf-8")
    print(f"[orchestrator] generated API key -> {API_KEY_FILE}")
    return k


def start_api(cfg):
    slskd = Slskd(cfg["slskd_url"], cfg["slskd_username"], cfg["slskd_password"])
    key = ensure_api_key()
    Api.slskd = slskd
    Api.api_key = key
    host = cfg.get("api_host", "0.0.0.0")
    port = int(cfg.get("api_port", 8420))
    httpd = ThreadingHTTPServer((host, port), Api)
    print(f"[orchestrator] HTTP API on {host}:{port}  (key in {API_KEY_FILE.name})")
    threading.Thread(target=httpd.serve_forever, name="api", daemon=True).start()
    return slskd


def selftest():
    cfg = read_config()
    if not cfg:
        print(f"No {CONFIG_FILE} -- create it first (see the docstring).")
        return
    s = Slskd(cfg["slskd_url"], cfg["slskd_username"], cfg["slskd_password"])
    print("logging in to slskd...")
    app = s.application()
    print("  ok. slskd says:",
          json.dumps({k: app.get(k) for k in ("version", "server")}, indent=2) if isinstance(app, dict) else app)
    print('searching "cranberries zombie" ...')
    responses, meta = s.search("cranberries zombie", wait_seconds=55)
    res = shape_results(responses)
    print(f"  slskd meta: {meta}  ({len(res)} folders before expand)")
    res = enrich_with_folders(res, s)
    print(f"  {len(res)} folders after expanding song hits to whole folders. top 5:")
    for r in res[:5]:
        tag = " (expanded)" if r.get("expandedFromHit") else ""
        print(f"   - {r['artist']} / {r['album']} ({r['year']}) "
              f"{r['trackCount']} tracks {r['format']} {r['bitrate']}kbps "
              f"free={r['hasFreeSlot']} user={r['user']}{tag}")

    dl = s.all_downloads()
    print(f"  slskd downloads reachable: {dl is not None}")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return

    print(f"[watcher] watching {WATCH_DIR}")
    cfg = read_config()
    global BEET_CMD
    if cfg and cfg.get("beet_path"):
        BEET_CMD = cfg["beet_path"]
        print(f"[watcher] using beet at {BEET_CMD}")
    slskd = None
    if cfg:
        try:
            slskd = start_api(cfg)
        except Exception as e:
            print(f"[orchestrator] API failed to start: {e}", file=sys.stderr)
    else:
        print(f"[orchestrator] no {CONFIG_FILE} -- HTTP API disabled, watcher only")

    while True:
        try:
            # one slskd query per tick, shared by the watcher and the sweeper
            all_downloads = slskd.all_downloads() if slskd is not None else None
            watcher_tick(all_downloads)
            prune_jobs()
            if slskd is not None:
                sweep_downloading(all_downloads)
        except Exception as e:
            print(f"[watcher] tick error: {e}", file=sys.stderr)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
