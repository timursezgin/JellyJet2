# JellyJet 2 - handoff (from the Mac session, 2026-09-14)

This project was built over many sessions on the owner's Mac. Work now moves to
the owner's Windows PC. Read this file, then `CLAUDE.md` (how to work, code
layout, running and testing) and `PLAN.md` (the settled product decisions).
Together they replace the Mac session's private notes.

## 0. First job on the new computer: cut the last ties to JellyJet v1

**JellyJet v1 (the Flutter app, github.com/timursezgin/JellyJet, the
`JellyJet` container on tim-box port 8090) is abandoned and will be archived
and unreachable.** Everything JellyJet 2 still needs from it must be moved into
this repo, linked from here, or made to work with this version. Known
dependencies:

1. **The Soulseek download service behind "Add albums" - moved (2026-09-14).**
   - `pipeline/` (from v1 commit `4961510`; `watcher.py` and `Dockerfile`
     identical) and `.github/workflows/orchestrator-image.yml` now live in this
     repo and build the public image
     `ghcr.io/timursezgin/jellyjet2-orchestrator:latest`.
   - With the owner's go-ahead, the `image:` line in tim-box's
     `Desktop\Music\_pipeline\slskd\docker-compose.yml` was switched to it and
     only the `orchestrator` service recreated (container still called
     `jellyjet-orchestrator`, port 8420, Watchtower label kept). Checked:
     `/ping` directly and via `/pipeline` on 8091, `/whoami` refuses no key,
     watcher running. A copy of the old compose file is next to it
     (`docker-compose.yml.bak-2026-09-14`).
   - The owner downloaded an album with it on 2026-09-15: works.
2. **The design spec** - was copied to `docs/design/`, then removed from the
   folder on 2026-09-15 at the owner's request (in git history at `e17a2cd`).
   It was written for the Flutter app; tokens are in `src/theme/tokens.css`
   and the owner's decisions here and in `PLAN.md` override it.
3. **Hosting** - the `JellyJet2` container (`Desktop\JellyJet2`, port 8091)
   serves this app; jj.timursezgin.work points at 8091 (checked: it serves
   this build). On 2026-09-15, at the owner's request, the v1 `JellyJet`
   container (port 8090) was removed, `Desktop\JellyJet` sent to the Recycle
   Bin, and the old `jellyjet-orchestrator` and `slskd-orchestrator` images
   deleted. The owner archives the v1 repo on GitHub.

**Done: nothing depends on JellyJet v1 any more.**

## 1. Who you're working with

- The owner has **no coding background**. Plain language, recommend one option
  when there's a choice, commands in their own fenced blocks (PowerShell on
  Windows).
- **Genuine solutions only - no hacks or shortcuts.** When a platform limit
  blocks something, say so plainly and offer real fixes. (A "silent audio"
  trick to keep iOS awake was tried and removed at the owner's request.)
- Ask before big decisions; don't re-ask settled ones (below and in `PLAN.md`).
- Commit and push to github.com/timursezgin/JellyJet2 after each tested
  change, then publish with `npm run deploy`. Tell the owner to close and
  reopen the home-screen app to get it (after big service-worker changes,
  twice).
- The owner reviews on their iPhone and sends annotated screenshots.
- Two people use the app: the owner (admin, can delete from library, can use
  Add albums) and the owner's girlfriend (regular user).

## 2. Safety rules (standing)

- Never put credentials (Jellyfin, slskd, the orchestrator key) in source,
  commits, notes or output. Never read `api_key.txt`. The owner types
  passwords and the Add albums key; never type them.
- Don't use the owner's real Jellyfin token to explore the API (public
  endpoints like images and `/System/Info/Public` are fine).
- Never perform destructive library actions yourself. Never touch the
  deprecated `Music_Test` folder on tim-box. Outward-facing changes (Cloudflare,
  tim-box containers) need the owner's go-ahead.
- A file called `pipeline-handoff.md` (the owner's own notes, with
  credentials) may exist on the owner's machines: never commit or share it.
- Don't play audio out loud during tests (it comes out of the owner's
  speakers); use the pretend servers, whose audio is silent.

## 3. Where things stand

Steps 0-6 of `PLAN.md` are done and tested; step 7 (smoothness) is largely
done. The app is live at https://jj.timursezgin.work and used daily on iPhones.

Built and settled (details in `PLAN.md`):
- Sign-in (username + password), four tabs: **Home · Search · Library ·
  Settings** (the Downloaded tab was removed; Downloaded and Liked Songs sit
  at the top of Library).
- Player with lock-screen controls and instant next song; queue.
- Browsing, swipe-down hidden search in lists, per-song heart | download | (…)
  buttons everywhere.
- Downloads and offline listening (Cache Storage + IndexedDB, backup list on
  the Jellyfin account, auto-fetch for downloaded collections).
- Made for you mixes, Stations (Artist mix, Library radio, Decade radio).
- Add albums (Soulseek via the orchestrator): key entered once per phone,
  **[MP3 only] (default) / [No filter]** chips, swipe a download row left for
  **Cancel** (while downloading) or **Dismiss** (when done or failed).

The owner's UI decisions from the last sessions (all implemented):
- Song rows 56pt, item rows 60pt, list rows ~46pt; tap areas at least 44pt.
- Tapping the song that's already playing does nothing (paused: resumes).
- Page headers: album-style everywhere - a 132pt cover with the name beside it
  (playlists, Liked Songs, Downloaded, mixes, stations, artists); a mix's
  "why" sentence goes full width underneath.
- Back button is just a red **‹** with no text. On list pages it sits inline
  with the big title ("‹ Playlists", one row); on album/playlist pages the
  small bar title is centred.
- Title bars are always frosted glass. The iOS status bar stays **black**
  (translucent hits WebKit bug 301108 on iOS 26: the bottom of the app stops
  being painted), with a short fade from the bar into it. Revisit when Apple
  fixes the bug.
- Offline: a row under each page title, "(cloud-off icon) Offline • **Go to
  Downloaded**" (the link opens the Downloaded list; just "Offline" on that
  page).
- Liked Songs: tapping a red heart slides the row left to reveal a red
  Unlike underneath (no shadow); Unlike flies the row out and the rows below
  ease up. No toasts for liking/unliking.
- Swipe-back from the left edge follows the finger and freezes vertical
  scrolling (a bug where a second swipe froze pages is fixed; keep
  `tool/swipe-test.mjs` passing).
- Icons and grey text use solid colours (see-through greys showed seams where
  icon strokes cross). No scroll bars anywhere.
- Add albums button on Library is just a round **+**.
- Known, accepted iOS limit: paused from the lock screen, iOS suspends the web
  app; resuming needs the app opened.

Performance work (step 7): instant app start from the saved page with safe
background updates, WOFF2 fonts, a size cap on the saved library cache,
covers that never fade in twice, cheap per-row lookups. Measured with
`tool/perf-test.mjs` and `tool/start-test.mjs`.

## 4. Next: the desktop version

The owner wants to build the **desktop layout** on this computer. `PLAN.md`
has said "phone first, desktop later", so **no desktop decisions are settled
yet: ask the owner before building**, for example:
- At what window width the desktop layout starts, and whether the phone
  layout stays exactly as it is below that (it should keep working unchanged).
- Navigation: a left sidebar instead of the bottom tabs? What goes in it
  (Home, Search, Library sections, playlists)?
- The player: a full-width bar at the bottom? What happens to the full-screen
  player and the queue (a side panel)?
- Lists: multi-column song tables (title, artist, album, time) or the phone
  rows made wider? Hover states, right-click for the (…) menu, keyboard
  shortcuts (space to play/pause)?
- Does the desktop version also install as an app (Chrome/Edge "Install") and
  keep downloads/offline?

Guidance: keep one codebase and one set of screens; add layout at a CSS
breakpoint and a few desktop-only components (sidebar, player bar) rather than
forking pages. Test that the phone layout is untouched (the existing tests use
a 390-402px viewport).

## 5. Setting up this computer (for Claude)

- Needs Git, Node.js (24 LTS or newer), and Tailscale signed in to the owner's
  tailnet (the dev server reaches tim-box at 100.115.48.57).
- `npm install`, then `npm run dev` (http://localhost:5173, real server via
  Tailscale) or `VITE_LAYOUT_TEST=1` for a pretend session (PowerShell:
  `$env:VITE_LAYOUT_TEST="1"; npm run dev`).
- Publishing: `npm run deploy` finds tim-box's folder automatically (on tim-box
  itself `C:\Users\Windows 11\Desktop\JellyJet2`; from another PC
  `\\100.115.48.57\Users\Windows 11\Desktop\JellyJet2` - the owner opens that
  share in File Explorer once and signs in). Or set `JJ_DEPLOY_TARGET`.
- Tests need Playwright (`npm i -D playwright` then
  `npx playwright install webkit`) and Caddy for `npm run serve-local`
  (`winget install CaddyServer.Caddy`). See each test file's header.
- The Mac-only tools used before (iOS Simulator, Homebrew paths) aren't
  available; check phone visuals with Playwright WebKit screenshots at a
  402x874 viewport, and on the owner's iPhone.
