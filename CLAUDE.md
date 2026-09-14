# JellyJet 2 - project context for Claude

## What this is

A **React + TypeScript web app** (Vite) that is a music-only client for the
owner's self-hosted **Jellyfin** server. It is installed from Safari to the
phone's home screen - there is no native app. **Read `PLAN.md` first**: it
holds every product decision and the build steps.

The original JellyJet (Flutter, `~/Desktop/JellyJet`) is a separate project.
Its design spec is the look to follow: `~/Desktop/JellyJet/design_handoff_jellyfin_music_ios/`
(tokens are ported to `src/theme/tokens.css`). Its Jellyfin API usage is a
useful reference; don't port its code wholesale.

## Who you're working with

The owner has **no coding background**. Explain in plain language, recommend
one option when there's a choice, and put any command they run in its own
fenced `bash` block. Ask before big decisions; don't re-ask settled ones in
`PLAN.md`.

## Rules

- Never put credentials (Jellyfin, slskd, orchestrator key) in source, commits
  or output. Don't use the owner's real Jellyfin token for API exploration.
- Never perform destructive library actions yourself.
- Commit and push to `origin` (github.com/timursezgin/JellyJet2) after each
  tested step. Don't commit `.claude/launch.json`.
- Commit messages end with the Co-Authored-By line from the session.

## Running it

- Toolchain: Node via Homebrew - prefix commands with
  `export PATH="/opt/homebrew/bin:$PATH"`.
- `npm run dev` - dev server on :5173. `/jellyfin/*` and `/pipeline/*` are
  proxied to tim-box over Tailscale (`vite.config.ts`).
- `VITE_LAYOUT_TEST=1 npm run dev` - opens signed in with a pretend session
  (server unreachable) for testing layout and navigation without an account.
  Real sign-in needs the owner; never type their password.
- `npm run build` - typecheck + production build to `dist/`.
- `sh tool/serve-local.sh` - the production build on http://localhost:8792 via
  the real Caddyfile (service worker + downloads work: localhost is secure).
- `tool/offline-test.mjs` - end-to-end downloads/offline test in Playwright
  WebKit against a pretend Jellyfin (see its header). Zustand selectors that
  build objects need `useShallow` or React loops (#185) - this test caught it.
- `tool/extras-test.mjs` - step 6 end to end (mixes, save as playlist, radios,
  artist mix, Add albums with a pretend key) in Playwright WebKit against a
  pretend Jellyfin (:8793) and pretend orchestrator (:8795):
  `JELLYFIN_UPSTREAM=localhost:8793 PIPELINE_UPSTREAM=localhost:8795 sh tool/serve-local.sh`.
- `tool/perf-test.mjs` - smoothness numbers against a library-sized pretend
  Jellyfin (12k songs): start-up, React commits, dropped frames scrolling and
  opening pages, cover pop-in/flicker, saved-cache size. With
  `ORIGIN=http://localhost:5199` and `JJ_JELLYFIN=http://localhost:8793 npx vite
  --port 5199` it also reports React render time (development build).
- `tool/start-test.mjs` - app start on a slow connection (a proxy on :8794
  holds the page back 1.5s) and a published update reaching an open app.
  Set `DIST_INDEX` to the absolute `dist/index.html` when run from elsewhere.
- `tool/swipe-test.mjs` - swipe-back stress test (fast repeat swipes, swipe
  then open a page, second finger, random abuse) in Playwright WebKit against
  the pretend-session dev server on :5199. Run it after touching `StackView`.
  A swipe's end must run exactly once: re-finishing an old animation used to
  pop a second page and freeze pages half-shifted.
- The Browser pane can't register service workers; use Playwright WebKit or
  the Simulator for anything offline.
- `sh tool/deploy.sh` - build and copy to tim-box `Desktop\JellyJet2\site`
  (SMB mount `/Volumes/Users/Windows 11/Desktop/JellyJet2`). Served by the
  `JellyJet2` Caddy container (`deploy/`), port 8091.

## Code layout

- `src/jellyfin/` - `JellyfinClient` (fetch + MediaBrowser auth header),
  `identity.ts` (device id/name, ASCII-only header values), response types.
- `src/auth/session.ts` - zustand session store (restore / signIn / signOut,
  permissions from the user policy), persisted to localStorage `jj.session`.
  Restore opens the app immediately and only signs out on a 401.
- `src/nav/` - per-tab page stacks (`navigation.ts`), `StackView` with iOS
  push/pop slides and left-edge swipe-back (Web Animations API), `PageContext`.
- `src/shell/app-shell.tsx` - tabs + route → screen mapping. `--chrome-bottom`
  is the space pages keep clear at the bottom.
- `src/data/queries.ts` - every library read as a TanStack Query hook (cached,
  refreshed in the background; long lists paged 100 at a time).
- `src/jellyfin/api.ts` - the Jellyfin requests (Jellyfin 12: `/Genres` not
  `/MusicGenres`, `/Artists/AlbumArtists` not `/Persons`, `ApiKey` for streams).
- `src/ui/` - shared pieces: `Page` (large or detail header, hidden
  swipe-down search, exposes its scroller), `VirtualList`/`VirtualGrid`
  (draw only visible rows; fixed row heights), `TrackRow`, `Hero`, covers.
- `src/songs/` - per-song state and actions: `likes.ts` (liked = session
  change → loaded Liked Songs list → the song's own data), `playlists.ts`
  (membership, add without duplicates, remove by entry id, create),
  `song-buttons.tsx` (heart | download | (…)), `song-menu.tsx` (the (…) sheet
  and New playlist). `src/data/query-client.ts` is the shared cache.
- `src/downloads/` - `downloads.ts` (index: songs with `sources`, collections
  with `excluded`, jobs, progress; IndexedDB), `engine.ts` (queue, fetching
  into Cache Storage `jellyjet2-audio` at `/offline/audio/<id>`, covers in
  `jellyjet2-images`, collection sync), `backup.ts` (list on the Jellyfin
  account), `lifecycle.ts` (starts it all while signed in), buttons.
- `src/connectivity/connection.ts` - server reachable or not; every request
  reports in; pings while offline. TanStack's onlineManager follows it and the
  query cache is persisted to IndexedDB for offline browsing.
- `src/mixes/` - `generator.ts` (Made for you recipes from play counts, last
  played, likes, genres, years), `mixes.ts` (pool of mixes per account in
  localStorage `jj.mixes.<userId>`, four shown, Regenerate rotates then
  rebuilds), `stations.ts` (Library/Decade radio, Artist mix builder).
- `src/pipeline/` - Add albums: `client.ts` (the orchestrator's API via
  `/pipeline`, Bearer key), `pipeline.ts` (key in localStorage
  `jj.pipelineKey`, cleared on sign-out; search; jobs polled every 10s while
  active; on landing asks Jellyfin to refresh). The key is typed by the owner -
  never read `api_key.txt` or put the key anywhere.
- `src/offline/outbox.ts` - likes/playlist edits/plays made offline, sent later.
- `public/sw.js` - app shell offline, `/offline/audio/*` with Range support,
  stored covers. The app opens from the saved page at once; a newer page is
  fetched in the background and saved only after all its `/assets` and
  `/fonts` files are (old assets pruned), then the app reloads into it if
  that's within 6s of opening and untouched (`main.tsx`). Don't rename the
  `jellyjet2-shell-v2` cache: activate deletes other shell caches, which
  would break an offline start.
- Saved query cache: long paged lists keep only their first 3 pages
  (`data/query-client.ts`). Fonts are WOFF2.
- `src/screens/` - one file per screen.

## How it's hosted

Caddy (`deploy/Caddyfile`): `/pipeline/*` → orchestrator :8420, `/web*` → 404,
app files from `site/`, everything else → Jellyfin :8096. So in production the
Jellyfin server URL is the page's own origin (`src/lib/server.ts`). Cloudflare
tunnel in front provides HTTPS; Cloudflare edge-caches static files, which is
why build files must keep content-hashed names and `/`, `/sw.js` are no-cache.

## iOS web-app notes

- Home-screen web apps have storage separate from Safari tabs; deleting the
  icon deletes downloads.
- Status bar style must stay `black`, not `black-translucent`: with
  translucent, iOS (26) stops painting a home-screen app 62pt above the bottom
  edge (window reports 812 on an 874pt screen and content below is clipped).
  `viewport-fit=cover` stays for the home-indicator inset. This is WebKit bug
  301108 (open): the page can't paint that strip at all. iOS fills the black
  status bar with the page colour; the title bars fade into it with a short
  gradient (`page.module.css`). Owner chose black until Apple fixes it. Full-screen layers
  use `height: var(--app-height)`; html/body must not clip overflow.
- The status bar style is captured when the icon is added: re-add the icon to
  see a change.
- The Browser pane is often hidden (no rAF, stale screenshots): check visuals
  on the iOS Simulator home-screen app instead.
- Player (`src/player/player.ts`): one audio element; the next song is started
  synchronously inside `ended` (iOS lock-screen rule). Stream URL uses
  `ApiKey` (Jellyfin 12 disabled `api_key`). Queue saved per user in
  localStorage `jj.player.<userId>`, only after restore.
- Lock screen: action handlers are re-registered on every `playing` (iOS drops
  ones set before audio played and shows skip-15s buttons). Known iOS limit:
  paused with the screen off, the web app is suspended and loses the
  lock-screen player; resuming needs the app opened. The owner rejected
  workarounds (a "silent pause" with a second element was tried and removed:
  it confused the lock-screen state) - genuine solutions only.
- Never play test audio on the Simulator: it comes out of the owner's Mac.
- Inputs need font-size ≥ 16px or iOS zooms the page.
