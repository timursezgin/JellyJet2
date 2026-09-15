# JellyJet 2 - project context for Claude

The one place for everything about this project: who it's for, the rules, how
it runs, every settled product decision, and what's next. Keep it current when
something changes (it replaced the old `PLAN.md` and `HANDOFF.md`).

## What this is

A **React + TypeScript web app** (Vite) that is a music-only client for the
owner's self-hosted **Jellyfin** server. People add it from Safari to the
iPhone home screen and use it like an app; there is no native app. Live at
**https://jj.timursezgin.work**, used daily by two people: the owner (admin,
can delete from the library and use Add albums) and the owner's girlfriend
(regular user). Feishin is a source of ideas only - no code or logic copied.

It replaced JellyJet v1 (Flutter), which is retired: its repo is archived and
nothing of it remains on tim-box. The one part still in use, the Soulseek
download service behind Add albums, now lives here in `pipeline/`.

## Working with the owner

- **No coding background.** Plain language, recommend one option when there's
  a choice, commands they run in their own fenced `bash` block (keep them
  valid in PowerShell - this is Windows).
- **Genuine solutions only - no hacks or shortcuts.** When a platform limit
  blocks something, say so plainly and offer real fixes.
- Ask before big decisions; don't re-ask the settled ones below.
- The owner reviews on their iPhone and sends annotated screenshots.
- After each tested change: commit, push to `origin`
  (github.com/timursezgin/JellyJet2), publish with `npm run deploy`, and tell
  the owner to close and reopen the home-screen app (twice after big
  service-worker changes). Commit messages end with the session's
  Co-Authored-By line. Don't commit `.claude/launch.json`.

## Rules

- Never put credentials (Jellyfin, slskd, the orchestrator key) in source,
  commits, notes or output. The owner types passwords and the Add albums key
  - never type them, never read `api_key.txt` or `orchestrator.json`. A file
  `pipeline-handoff.md` (owner's notes with credentials) may exist: never
  commit or share it.
- Don't use the owner's real Jellyfin token to explore the API (public
  endpoints like images and `/System/Info/Public` are fine).
- Never perform destructive library actions yourself.
- Outward-facing changes (Cloudflare, tim-box containers and compose files)
  need the owner's go-ahead.
- Never play audio out loud while testing - it comes out of the owner's
  speakers. The pretend servers' audio is silent.

## This computer is tim-box

tim-box (Windows 11, Tailscale 100.115.48.57) is both the dev machine and the
server. Node 24, Git (signed in to GitHub), Caddy, Docker and Playwright WebKit
are installed. Docker is *not* logged in to ghcr.io, so images it pulls must be
public.

**This project folder is also the live site.** The `JellyJet2` container
(`caddy:2-alpine`, port 8091) serves `site/` using the top-level `Caddyfile`
and `docker-compose.yml` - git-ignored running copies of `deploy/`.
`npm run deploy` builds and copies straight into `site/`: live on jj at once.
New files need no restart; a changed Caddyfile needs `docker compose restart`,
a changed compose file `docker compose up -d` (deploy says so).

Hosting chain: Cloudflare tunnel (HTTPS; the `Cloudflared` Windows service,
route for jj → 8091) → Caddy (`deploy/Caddyfile`): `/pipeline/*` →
orchestrator :8420, `/web*` → 404, app files from `site/`, everything else →
Jellyfin :8096. So in production the Jellyfin URL is the page's own origin
(`src/lib/server.ts`). Cloudflare edge-caches static files: build files must
keep content-hashed names, and `/`, `/sw.js` are no-cache.

**Add albums orchestrator** (`pipeline/`, see its README): Python `watcher.py`
= slskd search/download API + album watcher + beets import into
`Desktop\Music\2-MainLib`. A push touching `pipeline/watcher.py` or
`pipeline/Dockerfile` makes GitHub Actions build the public image
`ghcr.io/timursezgin/jellyjet2-orchestrator:latest`; Watchtower on tim-box
pulls it within ~5 min. It runs from `Desktop\Music\_pipeline\slskd\docker-compose.yml`
(service `orchestrator`, container `jellyjet-orchestrator`, beside `slskd` and
`watchtower`) - ask before changing that file, and never read or print its
passwords. Recreate only it with `docker compose up -d --no-deps orchestrator`.

## Running, publishing, testing

Set environment variables PowerShell-style: `$env:NAME="value"; npm run ...`.
After a fresh `npm ci`, run `npx playwright install webkit` once.

- `npm run dev` - dev server on :5173; `/jellyfin/*` and `/pipeline/*` proxy
  to tim-box (`vite.config.ts`; override with `JJ_JELLYFIN` / `JJ_PIPELINE`).
- `VITE_LAYOUT_TEST=1` with `npm run dev` - opens signed in with a pretend
  session (server unreachable), for layout and navigation without an account.
  Real sign-in needs the owner.
- `npm run build` - typecheck + production build to `dist/`.
- `npm run serve-local` - `dist/` on http://localhost:8792 through the real
  Caddyfile (service worker + downloads work: localhost is secure).
  `JELLYFIN_UPSTREAM` / `PIPELINE_UPSTREAM` point it at pretend servers.
- `npm run deploy` - build + publish (above). `tool/deploy.mjs` also works from
  another PC via `\\100.115.48.57\Users\Windows 11\Desktop\JellyJet2` or
  `JJ_DEPLOY_TARGET`.

Tests (Playwright WebKit; each file's header has exact usage):
- `tool/swipe-test.mjs` - swipe-back stress test against the pretend-session
  dev server on :5199 (`npx vite --port 5199` with `VITE_LAYOUT_TEST=1`). Run
  after touching `StackView`. A swipe's end must run exactly once:
  re-finishing an old animation used to pop a second page and freeze pages
  half-shifted.
- `tool/offline-test.mjs` - downloads/offline end to end against a pretend
  Jellyfin on :8793 (`npm run build`, then serve-local with
  `JELLYFIN_UPSTREAM=localhost:8793`).
- `tool/extras-test.mjs` - mixes, save as playlist, radios, artist mix, Add
  albums with a pretend key; also needs `PIPELINE_UPSTREAM=localhost:8795`.
- `tool/perf-test.mjs` - smoothness numbers against a 12k-song pretend library
  (start-up, React commits, dropped frames, cover pop-in, saved-cache size).
- `tool/start-test.mjs` - start on a slow connection (proxy :8794) and a
  published update reaching an open app.

Testing on this PC:
- **Windows WebKit can't play audio** (`play()` throws NotSupportedError, no
  `navigator.mediaSession`). So "offline playback" (offline-test) and the
  Library/Decade radio checks (extras-test) fail here for that reason alone;
  everything else should pass. Playback is checked on the iPhone.
- The Browser pane can't register service workers and is often hidden (no
  rAF, stale screenshots): check visuals with Playwright WebKit screenshots at
  402x874, and on the owner's iPhone.
- Test servers started in the background keep ports busy; stop them after.

## Settled product decisions

### Song buttons
- Every song row and the full player: **heart | download arrow | (…)**, each a
  large tappable block. **(…) menu:** like, download, add to playlist, remove
  from playlist, add to queue, go to album, go to artist, remove from library.
  - *Remove from playlist* outside a playlist lists the playlists containing
    the song; hidden if none. *Remove from library* only for admins with media
    deletion allowed.
- **Liked and downloaded are properties of the song**, shown identically
  everywhere. Liking never downloads anything.
- A not-downloaded arrow is pale grey in rows; in the full player it matches
  the heart and (…) (pale there only when offline, i.e. unusable).
- Tapping the song that's already playing does nothing (paused: resumes).

### Downloads
- Download buttons on songs, playlists, albums and Liked Songs. A downloaded
  collection **automatically fetches songs added later**.
- **Removing a download always asks first.** The song leaves Downloaded but
  stays in its playlists; a downloaded playlist won't re-fetch a song whose
  download was removed. Unliking (in a downloaded Liked Songs) or a song
  leaving a downloaded playlist lets go of its download unless something else
  keeps it.
- Taking a song out of a playlist only happens via the (…) menu.
- Quality in Settings: **Original** (default) or **Smaller**. Who can
  download: Jellyfin's per-user "Allow media downloading".
- Storage: Cache Storage for files + IndexedDB for the list (not OPFS: the
  service worker must read the files to play offline), `navigator.storage.persist()`,
  and the list backed up to the Jellyfin account (display preferences
  `jellyjet-downloads`) for one-tap re-download. Only in the home-screen app
  on iOS, and only on https/localhost.

### Offline
- The normal app with a row under each page title: "(cloud-off) Offline •
  **Go to Downloaded**" (just "Offline" on the Downloaded page). Songs that
  can't play are grey; lists stay browsable.
- Likes, playlist edits and plays made offline save instantly and sync later.

### Layout and look (phone)
- Tabs: **Home · Search · Library · Settings**. **Liked Songs** and
  **Downloaded** sit at the top of Library (not inside Playlists). Add albums
  on Library is a round **+** (admins with deletion rights).
- **Hidden search**: swipe down to reveal it in playlists (incl. Liked and
  Downloaded), artist pages and library lists. No pull-to-refresh; lists
  refresh automatically.
- Song rows 56pt, item rows 60pt, list rows ~46pt; tap areas ≥ 44pt.
- Page headers album-style everywhere: a 132pt cover with the name beside it
  (playlists, Liked, Downloaded, mixes, stations, artists); a mix's "why"
  sentence goes full width underneath.
- Back is a red **‹** with no text: inline with the big title on list pages
  ("‹ Playlists"); on album/playlist pages the small bar title is centred.
- Title bars always frosted glass, fading into the black status bar (see iOS
  notes). Icons and grey text use solid colours (see-through greys showed
  seams). No scroll bars anywhere.
- Liked Songs: tapping a red heart slides the row left to reveal a red Unlike;
  Unlike flies the row out and the rows below ease up. No toasts for liking.
- Swipe-back from the left edge follows the finger and freezes vertical
  scrolling.

### Features
- Username + password sign-in (no Quick Connect).
- Player: mini + full player, queue, lock-screen controls, instant next song.
  Playback reported to Jellyfin (`/Sessions/Playing*`) so play counts and
  mixes stay accurate.
- **Lyrics** (from Jellyfin's lyrics plugin, `/Audio/{id}/Lyrics`): a quote
  icon at the full player's bottom left (AirPlay and queue sit bottom right)
  shows them across the whole area above the song title, edge to edge (not
  inside the cover's square), with the whole cover - edges included -
  darkened and softly blurred behind; stays on from song to song. The lyrics
  area keeps clear of the handle (28px) and the title (36px). Archivo Medium,
  centred; the sung line is 10% larger (20% was too jumpy) (a real font-size change, so long
  lines re-wrap within the margins). The sung line sits in the exact vertical
  middle of the area (half-height room above the first line and below the
  last; re-aimed once the size change ends). Timed lyrics light up the sung line, follow the song
  (pausing 3.5s after a hand scroll) and seek on tap; plain lyrics just
  scroll; otherwise "No lyrics for this song yet". Fetched only while shown.
- **Made for you** mixes (v1's recipes, built on the phone, kept until
  Regenerate, savable as "JellyJet · <name>" playlists). **Stations**: Artist
  mix, Library radio (offline it shuffles downloads), Decade radio.
- **Add albums** (admins with deletion rights): key from
  `_pipeline/orchestrator/api_key.txt` typed once per phone; Soulseek search
  with **[MP3 only] (default) / [No filter]** chips, file list, progress; swipe
  a download row left for **Cancel** (in progress) or **Dismiss** (done or
  failed).
- **Lock screen:** playback continues locked, songs advance, next/previous
  work. Accepted iOS limit: paused from the lock screen, iOS suspends the web
  app and hands the lock-screen player elsewhere; resuming needs the app
  opened. No workarounds (a silent-audio trick was tried and removed at the
  owner's request). A native app remains a possible later addition.

## Status and next

Done and in daily use: everything above, plus a performance pass (instant
start from the saved page with safe background updates, WOFF2 fonts, capped
saved cache, covers that never fade in twice, cheap per-row lookups).

**Next: the desktop layout.** Nothing is decided yet - **ask the owner before
building**, e.g.:
- At what window width it starts; the phone layout must stay exactly as is
  below that.
- Navigation: a left sidebar instead of bottom tabs? What's in it (Home,
  Search, Library sections, playlists)?
- Player: a full-width bottom bar? What happens to the full-screen player and
  the queue (side panel)?
- Lists: multi-column song tables (title, artist, album, time) or wider phone
  rows? Hover states, right-click for (…), keyboard shortcuts (space)?
- Install as a desktop app (Chrome/Edge) with downloads/offline?

Approach: one codebase and one set of screens - layout at a CSS breakpoint
plus a few desktop-only components (sidebar, player bar), not forked pages.
Check the phone layout is untouched (tests use 390-402px viewports).

## Code layout

- `src/jellyfin/` - `client.ts` (fetch + MediaBrowser auth header),
  `identity.ts` (device id/name, ASCII-only header values), `types.ts`,
  `api.ts` (all requests; Jellyfin 12: `/Genres` not `/MusicGenres`,
  `/Artists/AlbumArtists` not `/Persons`, `ApiKey` not `api_key` for streams).
- `src/auth/session.ts` - zustand session store (restore / signIn / signOut,
  permissions from the user policy), localStorage `jj.session`. Restore opens
  the app at once and only signs out on a 401.
- `src/nav/` - per-tab page stacks (`navigation.ts`), `StackView` (iOS
  push/pop slides, left-edge swipe-back, Web Animations API), `PageContext`.
- `src/shell/app-shell.tsx` - tabs + route → screen mapping. `--chrome-bottom`
  is the space pages keep clear at the bottom.
- `src/screens/` - one file per screen.
- `src/data/queries.ts` - every library read as a TanStack Query hook (cached,
  refreshed in the background; long lists paged 100 at a time).
  `query-client.ts` - the shared cache, persisted to IndexedDB; long paged
  lists keep only their first 3 pages in the saved copy.
- `src/ui/` - shared pieces: `Page` (large or detail header, hidden swipe-down
  search, exposes its scroller), `VirtualList`/`VirtualGrid` (only visible
  rows; fixed row heights), `TrackRow`, `Hero`, covers, sheets, swipe rows.
- `src/songs/` - `likes.ts` (liked = session change → loaded Liked Songs list
  → the song's own data), `playlists.ts` (membership, add without duplicates,
  remove by entry id, create), `song-buttons.tsx`, `song-menu.tsx` (the (…)
  sheet and New playlist).
- `src/player/player.ts` - one audio element, queue (localStorage
  `jj.player.<userId>`, saved only after restore), lock-screen handlers.
  `full-player.tsx` - the full-screen player; `lyrics.tsx` - its lyrics view
  (the panel scrolls inside the player's drag-to-close area: `data-no-drag`
  plus its own `touch-action: pan-y`).
- `src/downloads/` - `downloads.ts` (index: songs with `sources`, collections
  with `excluded`, jobs, progress; IndexedDB), `engine.ts` (queue, fetching
  into Cache Storage `jellyjet2-audio` at `/offline/audio/<id>`, covers in
  `jellyjet2-images`, collection sync), `backup.ts`, `lifecycle.ts` (starts it
  all while signed in), buttons.
- `src/connectivity/connection.ts` - server reachable or not; every request
  reports in; pings while offline; TanStack's onlineManager follows it.
- `src/offline/outbox.ts` - likes/playlist edits/plays made offline, sent later.
- `src/mixes/` - `generator.ts` (recipes from play counts, last played, likes,
  genres, years), `mixes.ts` (pool per account in localStorage
  `jj.mixes.<userId>`, four shown, Regenerate rotates then rebuilds),
  `stations.ts` (Library/Decade radio, Artist mix).
- `src/pipeline/` - Add albums client: `client.ts` (orchestrator API via
  `/pipeline`, Bearer key), `pipeline.ts` (key in localStorage
  `jj.pipelineKey`, cleared on sign-out; jobs polled every 10s while active;
  asks Jellyfin to refresh when an album lands).
- `src/theme/tokens.css` - design tokens. Fonts (Archivo) are WOFF2 in
  `public/fonts/`.
- `public/sw.js` - app shell offline, `/offline/audio/*` with Range support,
  stored covers. The app opens from the saved page at once; a newer page is
  fetched in the background and saved only after all its `/assets` and
  `/fonts` files are (old assets pruned); `main.tsx` reloads into it if that's
  within 6s of opening and untouched. Don't rename the `jellyjet2-shell-v2`
  cache: activate deletes other shell caches, which would break an offline
  start.
- `pipeline/` - the orchestrator (see "This computer is tim-box").
- `deploy/` - Caddyfile + compose for the `JellyJet2` container.

## Code and platform lessons

- Zustand selectors that build objects need `useShallow`, or React loops
  (error #185) - offline-test caught it.
- Inputs need font-size ≥ 16px or iOS zooms the page.
- Home-screen web apps have storage separate from Safari tabs; deleting the
  icon deletes downloads.
- Status bar style must stay `black`, not `black-translucent`: with
  translucent, iOS 26 stops painting a home-screen app 62pt above the bottom
  (WebKit bug 301108, open). `viewport-fit=cover` stays for the home-indicator
  inset. iOS fills the black bar with the page colour; title bars fade into it
  (`page.module.css`). Revisit when Apple fixes the bug. The style is captured
  when the icon is added: re-add the icon to see a change.
- Full-screen layers use `height: var(--app-height)`; html/body must not clip
  overflow.
- Player: the next song is started synchronously inside `ended` (iOS
  lock-screen rule). Lock-screen action handlers are re-registered on every
  `playing` (iOS drops ones set before audio played and shows skip-15s
  buttons). A "silent pause" with a second audio element confused the
  lock-screen state and was removed.
