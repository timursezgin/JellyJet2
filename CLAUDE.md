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
- `src/ui/` - shared pieces (`Page` large-title scaffold, `ListRow`, ...).
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
  `viewport-fit=cover` stays for the home-indicator inset. Full-screen layers
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
