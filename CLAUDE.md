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
- **Work locally; don't commit or push after each change** (it's slow). Ask
  the owner whether to commit and push to `origin`
  (github.com/timursezgin/JellyJet2) roughly every 10 messages or after a
  major change, and only do it on a yes. Commit messages end with the
  session's Co-Authored-By line. Don't commit `.claude/launch.json`.
- After a tested change, publish with `npm run deploy` (that's how the owner
  tries it on the iPhone) and tell them to close and reopen the home-screen
  app (twice after big service-worker changes).
- **Versioning:** the app's version is `version` in `package.json` (also in
  `package-lock.json`), shown beside the server's name on Home ("v2.3.0") and
  in its own card next to the server's on Settings, with the build date.
  Raise it with each commit that changes the app: the last number for fixes
  (2.1.0 → 2.1.1), the middle one for new features (2.1.1 → 2.2.0). Started
  at 2.1.0 (versioning, device names, one-place-at-a-time Play on).

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
- Two devices (handoff, Play on): two Playwright browser contexts (separate
  storage = separate device ids) against a pretend Jellyfin that also speaks
  the live connection and tracks sessions; restart it between runs (it
  doesn't expire vanished devices the way Jellyfin does). offline-test ends
  by stopping serve-local; start it again before extras-test.

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
- Tabs: **Home · Search · Library · Settings**. **Liked Songs**, **Liked
  Albums** and **Downloaded** sit at the top of Library (not inside Playlists). Add albums
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
  Full player's bottom row: where it plays on the left (Play on, AirPlay),
  lyrics and queue on the right.
- **Liked Albums** (`songs/liked-albums.ts`): an album's own heart, kept as a
  Jellyfin favourite on the album - not a playlist, and separate from liking
  its songs. The heart sits between Shuffle and download on album pages; the
  Liked Albums page is a grid of whole albums (A-Z, hidden search; with a
  mouse, the same white play symbol on each cover as Home's row). Offline
  changes go through the outbox like song likes.
- **Home rows:** Recently played (songs, newest first, like the Liked Songs
  row; refreshed once the server has a song's start report; "see all" is a
  song list), Liked Songs, Liked Albums (with a mouse, a white play symbol on
  the cover plays the whole album from its first song; cover or name opens
  it), Made for you, Recently added, Stations.
  Playback reported to Jellyfin (`/Sessions/Playing*`) so play counts and
  mixes stay accurate.
- **Lyrics** (from Jellyfin's lyrics plugin, `/Audio/{id}/Lyrics`): a quote
  icon at the full player's bottom right, beside the queue
  shows them across the whole area above the song title, edge to edge (not
  inside the cover's square), with the whole cover - edges included -
  darkened and softly blurred behind; stays on from song to song. The lyrics
  area keeps clear of the handle (28px) and the title (36px). Archivo Medium,
  centred. The sung line zooms 10% (`transform: scale`, never a font-size
  change: re-wrapping and neighbours shifting looked jumpy); timed lines wrap
  at 1/1.1 of the width so the zoomed line fits the margins. It sits in the
  exact vertical middle (half-height room above the first line and below the
  last). Timed lyrics light up the sung line, follow the song
  (pausing 3.5s after a hand scroll) and seek on tap; plain lyrics just
  scroll; otherwise "No lyrics for this song yet". Fetched only while shown.
- **Continue on another device** (`player/handoff.ts`): while music plays, a
  note (queue window of up to 300 song ids, index, position, shuffle, repeat,
  device name, time) is kept in display preferences `jellyjet-playback` -
  written on play/pause/skip/seek/queue changes and every 30s while playing,
  never just for opening the app. When the app opens or comes to the front
  (visible/focus, at most every 5s) and the note is from another device, newer
  than this device's own last listening (`jj.handoff.activeAt.<user>`), under a
  week old and not at the same song and place, a card offers "Left off on …
  · Continue". The songs are fetched before offering, so Continue starts
  playback straight from the tap (iOS). × remembers that note as dismissed;
  playing anything here removes the card. Continue also pauses the device the
  note came from, if it's still playing.
- **Both are per Jellyfin account, never server-wide.** The note lives in the
  account's own display preferences. For Play on, Jellyfin's session lists
  include other accounts' devices (an admin may control them), so the list
  and remote mode keep only sessions whose `UserId` is the signed-in user, and
  a device ignores commands whose `ControllingUserId` is another account.
- **Play on another device** (Spotify Connect style, JellyJet only), with
  **one place at a time per account**: every open JellyJet keeps Jellyfin's
  live connection (`/socket`, `remote/socket.ts`), reports capabilities and
  stays subscribed to the account's sessions the whole time it's signed in
  (also asked for on open/front/reconnect, every 5s while the connection is
  down, every 30s otherwise). Other devices send it Play / Playstate /
  GeneralCommand messages (`remote/receiver.ts`, carried out one at a time).
  - **Follow:** when another device is playing and nothing plays (or waits for
    a tap) here, this device becomes its **remote** by itself (`remote/remote.ts`):
    the player store mirrors that device from the pushed `Sessions` updates,
    with its **queue from that device's playback note** (`player/playback-note.ts`,
    the handoff note; read ~2s after each report from it, at most every 3s,
    and on coming to the front; right after sending songs, those songs).
    Jellyfin 12 ignores `NowPlayingQueue` in start/progress reports (it only
    keeps one from a stop report), so reports no longer carry it. The
    transport functions in `player.ts` send it commands,
    volume is replaced by "Playing on …", the queue is read-only (tap a song to
    play it there) and the handoff card is hidden. A controlled device paused
    stays followed; if another starts playing, it follows that one.
  - A device is only followed if its report is recent - within a minute of the
    newest activity the server has recorded for any session (this device's own
    requests keep that current, so the server's clock is compared with itself).
    A session left behind by an app that was killed can still claim to be playing.
  - If a followed device doesn't do as it's told within 8s (play or pause), it
    isn't really there: a toast says so and the music comes back to this device,
    queue and all. Together with the check above, a phone is never left unable
    to play because a ghost session says something else is playing.
  - **Claim:** music starting on a device (not as a remote) pauses any other
    device on the account that's playing. Devices just paused are ignored for
    8s while their reports catch up (no ping-pong).
  - The device button (player bar, mini player, full player) opens "Play on":
    This device + other JellyJet sessions. Choosing one sends it the queue (up
    to 200 ids, from the same spot, playing or paused as it was) plus repeat
    and `SetShuffleQueue` with `KeepOrder`; the remote ignores that device's
    old state until it reports the sent song, and if it hasn't within 12s
    ("… didn't respond": asleep or gone) the music stays here, paused at the
    same spot. "This device" brings the music and queue here (the other pauses).
  - Between songs a device reports nothing playing for a moment; the remote
    only shows it stopped after 5s. A controlled device missing for 10s ends
    remote mode, keeping its queue (a toast only if it was playing).
  - iOS limits: a paused/locked iPhone app is suspended and can't receive; a
    song sent to a phone that hasn't played since opening shows a "Ready to
    play here" card (autoplay needs a tap) and is reported as paused there.
- **Update available** (`update/update.ts`): each build writes
  `/version.json` (version + build time, `vite.config.ts`, also baked in as
  `__APP_VERSION__`/`__APP_BUILD__`). An open app fetches it (fresh address,
  no-store) 3s after start, on coming to the front - shown again, its window
  clicked into (`focus`: a computer's window left open is never hidden),
  back online - at most once a minute, and every 2 min while visible; a
  different build - or the service worker reporting it saved a newer page -
  shows "New version available. Update?" under the version: on Home under
  "v2.3.0" (right-aligned with it), on Settings in the version card
  (`update/update-notice.tsx`). Tapping
  asks the service worker to save the new page and files (`refresh-shell`
  message, 8s limit) and reloads. Published = `npm run deploy`, not a git push.
- **Device name** (Settings → This device): browsers can't read the phone's or
  computer's own name, so it's guessed from the browser ("iPhone (Safari)")
  unless named here. Kept per device (localStorage `jj.deviceName`, cleaned to
  header-safe ASCII, max 40), sent as the `Device` in the auth header - so it
  shows in Play on, "Playing on …", the handoff card and Jellyfin - and
  re-announced (capabilities) on save so other devices see it at once.
- **A song that loads but never starts** (`player.ts`, `watchStart`): iOS can
  accept `play()` after a long pause and make no sound (WebKit 295518), which
  left the queue stopped at the next song. Three seconds after a song is meant
  to start, if it isn't actually moving, the song is loaded again with a fresh
  source (still loading on a slow connection just waits, up to 15s); if that
  doesn't start it either, the "Ready to play here" card asks for a tap rather
  than sitting silent.
- **Offline detection** (`connectivity/connection.ts`): a failed request
  only counts once `/System/Ping` also fails (6s limit) - a single slow reply
  used to flip the app "offline", and the next song, not downloaded, was
  skipped, stopping the music.
- **Made for you** mixes (v1's recipes, built on the phone, kept until
  Regenerate, savable as "JellyJet · <name>" playlists). Home shows **eight**
  (`MIXES_IN_VIEW`); Regenerate slides the pool window on by four, so half the
  cards are new, and rebuilds the pool when fewer than that are left (a small
  library then gets the same kinds of mix with different songs). Genre mixes
  come from the top five genres, to keep the pool bigger than the screen. **Stations**: Artist
  mix, Library radio (offline it shuffles downloads), Decade radio.
- **Add albums** (admins with deletion rights): key from
  `_pipeline/orchestrator/api_key.txt` typed once per phone; Soulseek search
  with **[MP3 only] (default) / [No filter]** chips, file list, progress; swipe
  a download row left for **Cancel** (in progress) or **Dismiss** (done or
  failed).
- **Lock screen:** playback continues locked, songs advance, next/previous
  work. While paused, the app re-states what's playing to iOS every 5s
  (`keepSessionAwake`: playback state, handlers, and the song every 15s) so the
  lock-screen player doesn't go quiet. **Tried on iOS 27 (Sept 2026): it does
  not fix the timeout** - once the app has been paused a while, its lock-screen
  player still can't restart it ([WebKit 243258], open), because iOS suspends
  the app and nothing in the page runs. The refresh is kept (it keeps the
  player's details right while the app is alive) but don't expect more from it;
  a real fix needs Apple, or a native app. Accepted iOS limit: paused from the lock screen, iOS suspends the web
  app and hands the lock-screen player elsewhere; resuming needs the app
  opened. No workarounds (a silent-audio trick was tried and removed at the
  owner's request). A native app remains a possible later addition.

### Desktop (windows 1000px wide and up)
Kept light: the same screens, optimised for mouse and keyboard. Below 1000px
the phone layout is exactly as before (`src/ui/use-desktop.ts` +
`@media (min-width: 1000px)`; hover styles use `(hover: hover) and (pointer: fine)`).
- **Left sidebar:** Home, Search, Library, Settings; Liked Songs, Liked Albums, Downloaded;
  Playlists (+ new). Liked/Downloaded/playlists open on top of Library's first page.
- **Bottom player bar** (no full-screen player on desktop): cover and title go to
  the album, artist to the artist; the names get a fixed 150px (wrapping to two
  lines each) with heart | download | (…) right after, never moving; shuffle,
  previous, play, next, repeat and a progress bar (middle column at most
  500px); at the right Play on, volume, Lyrics, Queue, evenly spaced.
- **Queue and lyrics** open in a framed panel at the right edge (one at a time;
  the button toggles). The left edge drags to resize, 280px up to half the
  window; double-click resets. Open panel and width are remembered.
- **Song lists** are columns - Title | Artist | Album | Length | buttons (album
  pages drop Album) - under a sticky header: click a column to sort A-Z, again
  Z-A, a third time back to the list's own order (the Tracks page sorts on the
  server and just flips). Playing from a sorted list plays in that order.
  Artist/album names are links (`TextLink`: inline text, so they can "…" and
  line-clamp). A play symbol shows on the cover (or over the track number)
  when clicking would start the song; Home's liked-song cards get a plain white
  one in the cover's bottom-left corner.
  Album grids fit more covers per row.
- **Mouse:** hover highlights; right-click a song for its (…) menu at the
  mouse; right-click an album cover for Add to / Remove from Liked Albums; the
  (…) button and other sheets open as a small menu / centred window;
  drag a song row onto a sidebar playlist (adds it) or Liked Songs (likes it),
  or an album cover onto Liked Albums (likes it), with the item and a round
  red (+) following the mouse. Albums go nowhere else and songs don't go in
  Liked Albums: over those the (+) becomes a grey "no" sign, the cursor
  not-allowed, and the sidebar fades the places that won't take it. Shelves get tall
  rounded arrow buttons level with the covers, hidden searches stay visible, Add albums rows show Cancel/Dismiss on
  hover, pages switch without the iPhone slide.
- **Keys:** Space play/pause; ←/→ 10s; Ctrl+←/→ previous/next; Ctrl+F or /
  Search; Alt+← or the mouse back button: back; Esc closes menus.
- The Browser pane emulates a touch device (no hover, `(hover: hover)` false):
  check desktop visuals with Playwright WebKit at 1440x900.

## Status and next

Done and in daily use: everything above, plus a performance pass (instant
start from the saved page with safe background updates, WOFF2 fonts, capped
saved cache, covers that never fade in twice, cheap per-row lookups). The
desktop layout is live and being tried out by the owner.

Possible later: install as a desktop app (Chrome/Edge) with downloads/offline.

## Code layout

- `src/jellyfin/` - `client.ts` (fetch + MediaBrowser auth header),
  `identity.ts` (device id/name, ASCII-only header values), `types.ts`,
  `api.ts` (all requests; Jellyfin 12: `/Genres` not `/MusicGenres`,
  `/Artists/AlbumArtists` not `/Persons`, `ApiKey` not `api_key` for streams
  and the `/socket` live connection). Jellyfin's own log
  (`C:\ProgramData\Jellyfin\Server\log`) shows why a request was refused.
  An anonymous probe of `/socket` through Cloudflare returns 502; that's not a
  fault (signed-in connections pass).
- `src/auth/session.ts` - zustand session store (restore / signIn / signOut,
  permissions from the user policy), localStorage `jj.session`. Restore opens
  the app at once and only signs out on a 401.
- `src/nav/` - per-tab page stacks (`navigation.ts`), `StackView` (iOS
  push/pop slides, left-edge swipe-back, Web Animations API), `PageContext`.
- `src/shell/app-shell.tsx` - tabs + route → screen mapping (phone), or
  sidebar + pages + side panel + player bar (desktop). `--chrome-bottom` is the
  space pages keep clear at the bottom. `sidebar.tsx`, `shortcuts.ts` (keys,
  mouse back button, Search focus requests).
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
  remove by entry id, create), `liked-albums.ts` (the same for albums, as
  Jellyfin favourites), `song-buttons.tsx`, `song-menu.tsx` (the (…) sheet,
  New playlist, and an album's right-click menu).
- `src/player/player.ts` - one audio element, queue (localStorage
  `jj.player.<userId>`, saved only after restore), lock-screen handlers.
  `full-player.tsx` - the full-screen player (phone); `lyrics.tsx` - its lyrics
  view (the panel scrolls inside the player's drag-to-close area: `data-no-drag`
  plus its own `touch-action: pan-y`), also used by the desktop side panel.
  Desktop: `player-bar.tsx`, `side-panel.tsx` (queue/lyrics frame, width),
  `queue-sheet.tsx` exports `QueueList` for both.
  `handoff.ts` - the "where was I" note and Continue card; `track-lookup.ts` -
  songs by id. Position: always read `currentPosition()` and listen with
  `subscribePosition()` (not audio events) - in remote mode the position is
  the other device's.
- `src/remote/` - the live connection, commands received, remote mode and the
  "Play on" picker (see Features).
- `src/songs/song-drag.tsx` - desktop drag of a song row or album cover onto
  the sidebar (pointer events, not HTML drag and drop; drop targets carry
  `data-drop-id`; `accepts()` decides which places take which).
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
  `jj.mixes.<userId>`, eight shown, Regenerate rotates then rebuilds),
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
- `tool/icons.mjs` - draws the app icons (the JJ in Archivo Bold on the app's
  red, second J raised like a beamed note) with Playwright, straight into
  `public/`. `--preview` writes samples instead. Re-run it if the look changes,
  and **raise the `?v=` on every icon address** (`index.html`,
  `public/manifest.webmanifest`, `sign-in-screen.tsx`): the file names stay the
  same, so Cloudflare, browsers and the service worker would go on serving the
  old pictures (the desktop install prompt showed the old icon this way). An
  iPhone only picks up a new icon when the home-screen icon is re-added.

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
