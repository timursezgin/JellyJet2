# Handoff: iOS Jellyfin Music Player

## Overview

A music-only iOS client for a self-hosted Jellyfin server, reached over Tailscale. The
prototype covers the full listening surface: a Home screen with algorithmic "Made for you"
mixes, a Library that mirrors the server's own browse categories, album/artist/playlist
detail screens, an offline Downloads screen, search, settings, and a two-state player
(docked mini-player + full-screen now playing).

The differentiating feature versus existing Jellyfin iOS music clients is **Made for you** —
locally or server-side generated mixes built by reading the library's own metadata (genre,
year, mood/style tags, play counts, last-played dates). Every mix card states *why* it was
generated.

## About the Design Files

The files in this bundle are **design references created in HTML**. They are prototypes that
show intended look, layout, and behavior — they are not production code to port.

The task is to **recreate these designs in the target codebase's environment**. The intended
target is **Flutter (iOS first)**; if you are working in SwiftUI or React Native instead, the
same spec applies. Use the target environment's own idioms — native scroll physics, native
navigation transitions, platform sheets — rather than reproducing the HTML's DOM structure.
Where the HTML fakes something the platform gives you for free (blur bars, sheet
presentation, back-swipe, scroll-to-hide title), use the platform primitive.

**Flutter notes for the main scaffolding:**
- Tab bar → `CupertinoTabScaffold` with `CupertinoTabBar`, or a custom bar if you need the
  mini-player docked above it (recommended: a `Stack` with your own bottom column, since the
  mini-player must persist across tab switches and sit above the tab bar).
- Navigation → one `Navigator` per tab so each tab keeps its own back stack.
- Blur bars → `BackdropFilter` + `ImageFilter.blur(sigmaX: 20, sigmaY: 20)` behind a
  translucent fill.
- Full-screen player → a route with a vertical slide transition, or
  `showCupertinoModalPopup`-style custom route; must be dismissible by drag-down.
- Playback → `just_audio` + `audio_service` (background audio, lock screen, CarPlay later).

## Fidelity

**High fidelity.** Colors, typography, spacing, radii, and animation timings below are final
and should be matched. Two things are deliberately unfinished:

1. **Cover art is flat gray blocks** (`#26262b`) everywhere. Real artwork comes from the
   Jellyfin image API. Keep the same aspect ratios and corner radii.
2. **Sample data is invented** (artists, albums, track titles, counts). All of it is replaced
   by server data.

---

## Design Tokens

### Color

| Token | Value | Used for |
| --- | --- | --- |
| `bg` | `#0a0a0b` | app background, full-screen player background |
| `surface` | `#15151a` | Made-for-you cards, tag tiles, settings server card |
| `sheetSurface` | `#18181d` | bottom sheets |
| `miniPlayerFill` | `rgba(28,28,32,0.82)` | mini-player (over blur) |
| `barFill` | `rgba(10,10,11,0.72)` top bar / `rgba(10,10,11,0.80)` tab bar | blurred chrome |
| `artPlaceholder` | `#26262b` | cover-art blocks |
| `artPlaceholderMini` | `#33333a` | mini-player art |
| `ink` | `#f5f4f3` | primary text, active play button fill |
| `ink70` | `rgba(245,244,243,0.70)` | inactive filter chip label |
| `ink60` | `rgba(245,244,243,0.60)` | inactive player secondary icons |
| `ink50` | `rgba(245,244,243,0.50)` | card subtitles |
| `ink45` | `rgba(245,244,243,0.45)` | mixes' "why" text, row subtitles, meta |
| `ink42` | `rgba(245,244,243,0.42)` | inactive tab bar items |
| `ink35` | `rgba(245,244,243,0.35)` | durations, settings values, section eyebrows |
| `ink30` | `rgba(245,244,243,0.30)` | chevrons, footnotes |
| `ink28` | `rgba(245,244,243,0.28)` | un-downloaded download icon |
| `hairline` | `rgba(255,255,255,0.07)` | all row dividers, card borders, bar borders |
| `artBorder` | `rgba(255,255,255,0.06)` | 1px inset on every art block |
| `controlFill` | `rgba(255,255,255,0.09)` | secondary buttons (Shuffle, icon buttons), scrubber track |
| `fieldFill` | `rgba(255,255,255,0.08)` | search field, inactive filter chips |
| `switchOff` | `rgba(255,255,255,0.16)` | toggle track, off |
| `accent` | `#ec3013` | primary actions, active states, downloaded state, playing track title |
| `accentTint` | `rgba(236,48,19,0.12)` | "New playlist" tile fill |
| `accentBorder` | `rgba(236,48,19,0.35)` | "New playlist" tile border |
| `online` | `#3ecf6a` | Tailscale connected dot and label |

The accent is the Modernist system's red (`--color-accent`, `#ec3013`). It is the only
non-neutral hue in the app apart from the connection-status green. It is exposed as a
runtime variable (`--ac`) in the prototype so it can be re-themed; ship it as a single
constant.

### Typography

**Archivo** throughout (Google Fonts, weights 400/500/600/700). Archivo is the Modernist
system's typeface for both headings and body. If you prefer to use SF Pro for platform
chrome, keep Archivo for all content type — it is the identity.

| Role | Size | Weight | Tracking | Notes |
| --- | --- | --- | --- | --- |
| Large title | 30 | 700 | -0.5 | screen titles ("Home", "Library") |
| Artist name (detail) | 27 | 700 | -0.5 | |
| Playlist name (detail) | 24 | 700 | -0.4 | |
| Album title (detail) | 22 | 700 | -0.4 | wraps to 2 lines, `text-wrap: pretty` |
| Now-playing title | 21 | 700 | -0.4 | single line, ellipsis |
| Section header | 19 | 600 | -0.3 | "Recently played", "Top songs" |
| Sheet title | 19 | 700 | -0.3 | |
| Mix card name | 17 | 600 | -0.2 | |
| Library category row | 17 | 500 | -0.2 | |
| Now-playing artist | 16 | 400 | — | `ink50` |
| Text input | 16 | 400 | — | |
| Row title | 15.5 | 600 | -0.1 | album/artist/playlist rows |
| Track title | 15 | 500 | — | `accent` when it is the current track |
| Button label | 15–16 | 600 | — | |
| Shelf card title | 14 (large) / 13 (small) | 600 | — | |
| Secondary / subtitle | 12.5 | 400 | — | `ink45` |
| Duration, counts | 12.5 | 400 | — | `ink35`, tabular numerals |
| Caption / footnote | 11.5–12 | 400 | — | `ink30` |
| Tab bar label | 10 | 500 | +0.1 | |
| Mix card kicker | 9.5 | 700 | +1.3 | uppercase, `accent` |
| Settings section eyebrow | 12 | 700 | +1.2 | uppercase, `ink35` |

All numeric runs (durations, counts, IP address, elapsed/remaining) use tabular numerals.

### Spacing & geometry

- Page gutter: **20**. Sheet gutter: **20**. Player gutter: **26**.
- Device canvas: **402 × 874** (iPhone 16 Pro logical size).
- Top bar: **96** tall (status bar + 44pt bar), content bottom-aligned with 8 bottom padding,
  14 horizontal padding.
- Scroll content insets: **top 96, bottom 176** (clears mini-player + tab bar).
- Tab bar: 9 top padding, **26** bottom padding (home-indicator inset), icons 23×23.
- Mini-player: 10 horizontal margin, 8 bottom margin, 8/10 padding, art 42×42 r8.
- Horizontal shelves: gap **14** (Made-for-you: **12**), bottom padding 26.
- Grids: 2 columns, gap **20 vertical / 16 horizontal**.
- Art-bearing rows: 8–9 vertical padding, 13 gap. Text-only rows: 13–15 vertical padding.
- Primary buttons: **44** tall.
- Corner radii: cover art **10** (variable `--art`, 0–18); cards **14**; tag tiles **12**;
  buttons **11–12**; sheet top corners **22**; pills/circles **999**; mini-player art **8**;
  full-player art **14**; artist art fully round.

The Modernist system specifies zero radius. This design deliberately departs from that for
iOS platform fit — per the brief, Modernist contributes the typeface and the accent, iOS
contributes the shapes. The prototype exposes `artRadius` (0–18) as a control so the square
end of that range can be evaluated; **ship at 10**.

### Shadows

- Mini-player: `0 8px 24px rgba(0,0,0,0.45)`
- Sheet / toast: `0 8px 24px rgba(0,0,0,0.50)`
- Full-player cover art: `0 24px 60px rgba(0,0,0,0.60)`

Nothing else has a shadow. Separation is done with hairlines.

### Motion

| What | Duration | Curve |
| --- | --- | --- |
| Full-screen player in | 340ms | `cubic-bezier(0.32, 0.72, 0, 1)` (iOS standard) |
| Bottom sheet in | 300ms | `cubic-bezier(0.32, 0.72, 0, 1)` |
| Backdrop fade | 200ms | ease |
| Toast fade | 200ms | ease |
| Regenerate icon spin | 700ms | linear, one rotation |

### Icons

Lucide, 1.9–2.4 stroke width depending on size. Mapping: house, list (Library), 
arrow-down-to-line (Downloads), search, sliders-horizontal (Settings), chevron-right,
chevron-left, play, pause, skip-back, skip-forward, shuffle, repeat, heart,
arrow-down-to-line / circle-check (download states), airplay, list-plus, plus, ellipsis-vertical,
refresh-cw. In Flutter use `lucide_icons` or ship the SVGs.

---

## Information Architecture

Five bottom tabs, each with its own navigation stack:

```
Home        Library                Downloads   Search   Settings
             ├ Artists      → Artist detail
             ├ Albums       → Album detail
             ├ Compilations → Album detail
             ├ Soundtracks  → Album detail
             ├ Tracks
             ├ Playlists    → Playlist detail
             ├ Artist genres
             ├ Album genres
             ├ Styles
             ├ Moods
             ├ Record labels
             └ Folders
```

Overlays that sit above every screen: **mini-player** (docked, persistent),
**full-screen player** (modal, slides up), **bottom sheets** (Add to playlist, New playlist,
Output), **toast**.

---

## Screens

### 1. Home

**Purpose:** get back into something quickly; surface generated mixes.

**Layout:** vertical scroll. Large title "Home". Three sections in order:

1. **Recently played** — horizontal shelf, cards 146 wide. Art 146×146 r10 with a timestamp
   overlaid flush-left-bottom inside the art (10px/700, +1.2 tracking, uppercase,
   `rgba(245,244,243,0.28)`) — "2 hours ago", "Yesterday", "2 days ago", "Last week".
   Below: title 14/600, subtitle 12.5 `ink45`, both single-line ellipsis.
2. **Made for you** — section header row with a right-aligned **Regenerate** control
   (refresh-cw 15px + label 13/600, both `accent`). Horizontal shelf, cards 214 wide,
   min-height 132, `surface` fill, 1px `hairline` border, r14, 14 padding, 10 gap.
   Card contents: kicker row (uppercase accent kicker on the left, a 26px accent circle with
   a white 11px play triangle on the right), then mix name 17/600, then the "why" line
   12/`ink45`, pushed to the bottom (`margin-top: auto`), `text-wrap: pretty`.
3. **Recently added** — horizontal shelf, cards 118 wide, art 118×118, title 13/600,
   subtitle 11.5.

**Top bar (Home only):** right-aligned connection pill — 6px `online` dot + "media-01"
12/500 `ink45`, `white-space: nowrap`.

**Copy — the five Made-for-you cards (set A):**

| Kicker | Name | Why |
| --- | --- | --- |
| Genre mix | Dream Pop Mix | You have returned to Vera Lune and Kite Season nine times this week. |
| Decade mix | The 2010s | Half your listening sits in one decade. Here is the rest of it. |
| Mood · tempo | Late Night Slow | Under 90 BPM, tagged sparse, from records you play after 11pm. |
| Rediscover | Untouched Since 2024 | 38 tracks you loved once and have not played in 14 months. |
| On repeat | Heavy Rotation | Your 25 most played tracks this month, newest first. |

**Set B (after Regenerate):**

| Kicker | Name | Why |
| --- | --- | --- |
| Genre mix | Nordic Jazz Mix | Built around Nils Bergström and five labels you keep landing on. |
| Decade mix | The 1990s | Your library skews older than your listening does. Correcting that. |
| Mood · tempo | Morning Tempo | Bright, 118 BPM and up, from albums you start the day with. |
| Rediscover | Shoegaze Shelf | Kite Season and four neighbours, unplayed since March. |
| On repeat | Climbing Fast | Tracks whose play count doubled in the last two weeks. |

The prototype alternates between two fixed sets to demonstrate the interaction. In the real
app, Regenerate re-runs the mix generator (see **Made for you generation** below) and spins
the icon once (700ms) while it works.

Tapping a mix card opens a **Playlist detail** screen whose subtitle is the "why" line, with
an add button that offers to persist the mix as a real Jellyfin playlist.

---

### 2. Library

**Purpose:** browse the server's own taxonomy rather than a flattened local list. This
mirrors what Jellyfin exposes, so the app never invents a hierarchy the server does not have.

**Layout:** a single list of 12 category rows, each 15 vertical padding, separated by
`hairline` top borders. Row = name (17/500, flush left, flex 1) + count (14 `ink30`, tabular)
+ chevron-right (17px, `rgba(245,244,243,0.30)`). No icons, no artwork — the page is
deliberately typographic and dense.

Below the list, after a closing hairline and 22px gap: a 12px `ink30` footnote —
"Browsing **Music** on media-01 · 8,214 tracks indexed" (library name in `ink60`).

**Categories and destination screen types:**

| Row | Count (sample) | Opens |
| --- | --- | --- |
| Artists | 412 | artist list |
| Albums | 698 | 2-up album grid |
| Compilations | 34 | 2-up album grid |
| Soundtracks | 19 | 2-up album grid |
| Tracks | 8,214 | flat track list |
| Playlists | 12 | playlist list (with New playlist row on top) |
| Artist genres | 57 | tag tiles |
| Album genres | 63 | tag tiles |
| Styles | 88 | tag tiles |
| Moods | 41 | tag tiles |
| Record labels | 126 | text rows |
| Folders | 8 | text rows |

Counts come from the server. Categories the server has no data for should be hidden rather
than shown empty.

---

### 3. Collection screens (reused shells)

**Album grid** — 2 columns, gap 20/16. Cell: 1:1 art r10 full-width of the cell, title
14.5/600 single-line, subtitle 12.5 `ink45` ("Artist · Year").

**Artist list** — rows, 9 vertical padding. 50×50 round art, name 15.5/600,
subtitle 12.5 `ink45` ("Dream pop · 3 albums"), chevron.

**Track list** — rows with a hairline top border. 44×44 art r10, title 15/500, subtitle 12.5
("Artist · Album"), duration 12.5 `ink35` tabular, then a 28px download toggle button.

**Tag tiles** (genres, styles, moods) — 2 columns, gap 12. Tile: `surface` fill, hairline
border, r12, 14 padding, min-height 76, name 15/600 at the top, count 11.5 `ink40` at the
bottom. Tapping a tag should filter albums by that tag (prototype shows a toast).

**Text rows** (labels, folders) — 15 vertical padding, hairline top border, name 15.5/500,
value 13.5 `ink38`, chevron. Folder rows show the server path (`/music/albums`) and its
contents count.

**Playlist list** — a **New playlist** row pinned to the top: 52×52 tile with `accentTint`
fill, `accentBorder` border, r10, centered accent plus icon; label 16/600 accent. Then
playlist rows: 52×52 art r10, name 15.5/600, subtitle 12.5 ("42 songs · Downloaded" when
locally cached), chevron.

---

### 4. Album detail

**Header:** horizontal — 132×132 art r10 on the left; on the right, bottom-aligned:
title 22/700 (wraps), artist 15/600 in **accent** (tappable → artist detail),
meta 12.5 `ink40` ("2024 · 11 tracks · FLAC 16/44").

**Action row:** three buttons, 44 tall, gap 10 — **Play** (flex 1, accent fill, white play
icon + "Play" 15/600 white), **Shuffle** (flex 1, `controlFill`, shuffle icon + label),
**Download** (44×44, `controlFill`, arrow-down-to-line; turns accent when the whole album is
cached, and the icon becomes circle-check).

**Track rows:** hairline top border, 12 vertical padding. Track number 13 `ink30` tabular in
an 18px column, title 15/500 (accent when it is the current track), duration 12.5 `ink35`,
then a 28px download toggle and a 26px ellipsis button (opens the Add-to-playlist sheet for
that track).

**Footer:** hairline, then 12px `ink30` — "Marram Records · 2024 · Indexed 4 Aug 2026".

Tapping any track starts playback of that track and sets the album as the queue.

---

### 5. Artist detail

**Header:** 104×104 round art, name 27/700, meta 13 `ink42` ("Dream pop · 3 albums · 34
tracks"). Then the same Play / Shuffle pair (no download button).

**Top songs:** section header "Top songs", then exactly **5** rows — rank 15/600
`rgba(245,244,243,0.25)` in a 16px column, title 15/500, subtitle 12 `ink40` with the play
count ("1,200 plays"), duration on the right. Ranked by the server's play count for the
current user.

**Albums:** section header, then a 2-up grid of that artist's albums, subtitle = year only.

---

### 6. Playlist / mix detail

Large 1:1 art (max 200 wide) r10, name 24/700, meta 13 `ink42`. For a saved playlist the
meta is "42 songs · Synced with media-01"; for a generated mix it is the mix's "why" line.

Action row: **Play** (flex 1, accent) + a 44×44 `controlFill` plus button (add songs for a
playlist; "save this mix as a playlist" for a mix).

Track rows: 44×44 art r10, title 15/500, artist 12.5, download toggle.

---

### 7. Downloads

**Storage header:** a row with "4.2 GB of 64 GB used" (13 `ink50`) and "312 tracks"
(13 `ink35`), then a 5px r999 track (`rgba(255,255,255,0.09)`) with an accent fill bar at
the used percentage.

**Albums & playlists** — downloaded sets appear as *units*, never as loose tracks:
54×54 art r10, title 15.5/600, subtitle 12.5 with type and size
("Vera Lune · Album · 11 tracks · 412 MB", "Playlist · 42 tracks · 1.6 GB"), and an accent
circle-check on the right. Tapping opens the normal album/playlist detail screen.

**Songs** — individually downloaded tracks not covered by a downloaded set: 44×44 art, title,
artist, and a download toggle that removes the download when tapped.

Per the brief: **no auto-download**. Downloads are explicit, per song, per album, or per
playlist. Every track row anywhere in the app carries the same download affordance and the
same two states.

---

### 8. Search

Search field: `fieldFill`, r11, 9/12 padding, 17px search icon `rgba(245,244,243,0.45)`,
16px input, placeholder "Artists, songs, albums".

Filter chips below: **All / Songs / Albums / Artists**, 7/14 padding, r999, 13.5/500. Active
= accent fill, white label. Inactive = `fieldFill`, `ink70` label.

**Empty state:** "Recent searches" (15/600 `ink50`) then rows with the query on the left and
its type on the right (12 `ink30`) — "Nils Bergström / Artist", "Blue Hour / Song",
"Late night / Mood", "Marram Records / Label". Each row re-runs that search. Rows separated
by bottom hairlines.

**Results:** one merged list ordered artists → albums → songs, respecting the active filter.
Row: 46×46 art (round for artists, r10 otherwise), title 15.5/500, subtitle 12.5 with the
type prefix ("Artist · Dream pop", "Album · Vera Lune", "Song · Vera Lune"), chevron.
Artist and album rows navigate; song rows start playback.

**No results:** centered 14px `ink35` — "Nothing matched that." (40px vertical padding)

Search should be debounced (~250ms) and hit the server, not just the local cache; downloaded
items should be included when offline.

---

### 9. Settings

**Server card:** `surface` fill, hairline border, r14, 16 padding, 20 side margins.
Contains a 7px `online` dot + "Connected over Tailscale" (13/600, `online`), then
"media-01" 17/600, then "100.84.12.7:8096 · signed in as ozan" (13 `ink45`, tabular).

**Sections** (eyebrow 12/700 uppercase +1.2 `ink35`, then rows with hairline top borders,
14 vertical padding, name 15.5 left, value 14 `ink40` right):

- **Playback** — Gain normalization: Album · Crossfade: Off · Streaming quality: Original
- **Downloads** — Download quality: FLAC · Auto-download: Off · Storage limit: 64 GB
- **Library** — Libraries: Music · Ignored tracks: 7 · Refresh on launch: On

The server connect / Tailscale sign-in flow is **not designed yet** — it was deferred. The
card above is the post-connection state.

---

### 10. Mini-player (docked, persistent)

Appears as soon as anything is playing and stays across tab switches and navigation. Sits
directly above the tab bar inside the same bottom stack: 10 horizontal margin, 8 bottom
margin, r14, `miniPlayerFill` over a 24px blur (saturate 180%), 1px
`rgba(255,255,255,0.09)` border, shadow `0 8px 24px rgba(0,0,0,0.45)`, 8/10 padding.

Contents: 42×42 art r8 → title 14/600 + artist 12 `ink50` (both ellipsis) → 36px play/pause
→ 34px skip-forward. Tapping the body opens the full player; tapping the buttons does not
(stop propagation).

**Not in the prototype but expected on device:** a thin progress line along the bottom edge
of the mini-player, and swipe-left/right on the body to change track.

---

### 11. Full-screen player

Slides up over everything (340ms, `cubic-bezier(0.32,0.72,0,1)`), full-bleed `bg`,
26px side gutter, 34 bottom padding.

Top: a 38×5 r999 grab handle at `rgba(255,255,255,0.22)`, 56 from the top, centered.
Tapping it (and, on device, dragging down) dismisses.

Middle: cover art, 1:1, max 320 wide, centered, r14, hairline border, shadow
`0 24px 60px rgba(0,0,0,0.6)`. Vertically centered in the remaining space.

Bottom block:
1. **Title row** — title 21/700 + artist 16 `ink50` (tappable → artist detail) on the left;
   a 34px **heart** on the right (outline `ink60` → filled accent when favourited).
2. **Scrubber** — 6px r999 track `rgba(255,255,255,0.13)`, fill `#f5f4f3` (not accent),
   then elapsed / remaining below (11.5 `ink40`, tabular, remaining prefixed with "-").
   Must be draggable on device.
3. **Transport** — one row, space-between: shuffle (44px, accent when on) · previous (52px) ·
   **play/pause** (68px circle, `#f5f4f3` fill, 27px `bg`-colored glyph) · next (52px) ·
   repeat (44px, accent when on). Inactive icon color `ink60`.
4. **Secondary row** — three 44px buttons, space-between, 6px side inset: download (accent +
   circle-check when cached), AirPlay (accent when output is not "This iPhone"),
   add-to-playlist (list-plus).

Repeat is a 2-state toggle in the prototype; ship the usual 3-state (off → all → one) with a
"1" badge on the third state.

**Deferred by the brief:** lyrics, queue/up-next, sleep timer, playback speed. Leave room in
the secondary row — a swipe-up on the art or a fourth button is the natural home for a queue.

---

### 12. Bottom sheets

Shared shell: full-screen scrim `rgba(0,0,0,0.5)` (fades 200ms, tap to dismiss), panel with
r22 top corners, `sheetSurface` fill, 1px top hairline, max-height 78%, slides up 300ms.
Header: 38×5 grab handle, then a row with the title (19/700) and a **Cancel** link
(15/600 accent).

**Add to playlist** — subtitle line "Track · Artist" (13 `ink45`), a **New playlist** row
(44×44 accent-tint tile + accent label), then playlist rows with a right-aligned accent
"Add" label. Adding closes the sheet and shows a toast.

**New playlist** — 76×76 art placeholder r10 beside a name field (`rgba(255,255,255,0.07)`,
r10, 12 padding, 16px, placeholder "Playlist name"). Two toggle rows with hairline top
borders: "Visible to other users" (on) and "Download when synced" (off). Toggles are 48×29
r999, 25px white knob, accent when on. Then a 48-tall accent button, r12 — **"Create on
media-01"** — and a centered 11.5 `ink30` footnote: "Written to the Jellyfin server, not
stored locally."

**Output** — rows, 14 vertical padding, hairline top borders: name left (accent when
selected), transport right (13 `ink35`) — "This iPhone", "Kitchen HomePod / AirPlay",
"Sony WH-1000 / Bluetooth", "Living Room TV / AirPlay". On device this is
`AVRoutePickerView`; the sheet exists in the prototype only because the system picker cannot
be mocked in HTML. **Use the real system picker.**

---

### 13. Toast

Centered pill 190 from the bottom, `rgba(28,28,32,0.95)`, 1px `rgba(255,255,255,0.1)`
border, r999, 9/18 padding, 13.5/500, shadow `0 8px 24px rgba(0,0,0,0.5)`, fades in 200ms,
auto-dismisses after **1800ms**, non-interactive. Used for: download started/removed, added
to playlist, playlist created, output changed.

---

## Interactions & Behavior

### Navigation
- Five tabs, each owning an independent navigation stack. Switching tabs preserves the other
  tabs' stacks (the prototype resets them; on device, preserve).
- The top bar shows a back chevron + label ("Library" at depth 1, "Back" deeper) whenever the
  stack is non-empty. Back-swipe from the left edge must work.
- Detail screens (album, artist, playlist) have **no** large title — their hero is the title.
  Category and tab screens show the large title.
- The top bar is always a blurred translucent layer over the scrolling content.

### Playback
- Tapping a track: starts it, sets the containing collection as the queue, reveals the
  mini-player. Does **not** open the full player.
- Tapping the mini-player body: opens the full player. The transition should feel like the
  art growing out of the mini-player.
- Play/Shuffle on a detail screen: plays track 1 / shuffles the collection.
- Progress advances once per second and wraps at the end of the track (prototype behavior);
  real playback advances the queue.

### Downloads
- The download control has exactly two states: **not downloaded** (arrow-down-to-line,
  `ink28`) and **downloaded** (circle-check, accent). Add a third **in-progress** state on
  device — a determinate ring around the icon.
- Album-level download toggles all of that album's tracks; the button reads as downloaded
  only when every track is cached.
- Downloads must survive app restarts and be playable with no server reachable.

### Made for you generation

Inputs available from Jellyfin per track/album: genre, style, mood, year, record label,
`UserData.PlayCount`, `UserData.LastPlayedDate`, `UserData.IsFavorite`, and (if tagged)
BPM. Five generators, one card each:

1. **Genre mix** — take the user's top genres by recent play count, sample tracks weighted
   toward artists with high play counts but excluding the top 3 most-played tracks.
2. **Decade mix** — bucket by `ProductionYear`, pick the decade with the highest recent
   play share, sample across it.
3. **Mood / tempo mix** — filter by mood/style tags plus BPM range; bias by time of day.
4. **Rediscover** — tracks with `PlayCount > 0` and `LastPlayedDate` older than ~9 months.
5. **On repeat** — top `PlayCount` in a trailing window, or fastest-rising play counts.

Each generator must emit a one-sentence **explanation** built from the data it used — that
string is the card's "why" line. Cards should be regenerable on demand and cached until the
next library scan or play-count change. Mixes are ephemeral until the user saves one, at
which point it is written to the server as a real playlist.

### Copy tone

Short, factual, specific, sentence case. State the reason, not the benefit — "38 tracks you
loved once and have not played in 14 months", never "Rediscover your favourites!". No emoji.
No exclamation marks.

---

## State Management

Recommended shape (Riverpod / Bloc / whatever the codebase uses):

**Playback (global, persistent, survives navigation)**
- `currentTrack`, `queue`, `queueIndex`, `isPlaying`, `positionMs`, `durationMs`
- `shuffle: bool`, `repeat: off | all | one`
- `isFavorite` (per current track, synced to the server)
- `output` (system-owned; read only)
- `playerExpanded: bool` (UI)

**Downloads (global, persisted to disk + a local DB)**
- `downloadedTrackIds: Set<String>`
- `downloadedSets`: album/playlist ids with track counts and byte sizes
- `inProgress`: id → progress
- `storageUsedBytes`, `storageLimitBytes`

**Library (cached, invalidated on server scan)**
- category counts, and per-category paged item lists
- album → track lists; artist → top tracks + albums
- playlists (the server is the source of truth; write-through on create/add)

**Session**
- server URL, access token, user id, selected libraries, connection state

**Ephemeral per screen**
- search query + active filter, mix set + regenerating flag, sheet target, toast message

---

## Jellyfin API Mapping

Indicative endpoints — **verify against your server version** (`/openapi.json` on the
server, or the Jellyfin API docs). All authenticated requests carry the
`Authorization: MediaBrowser Token="..."` header.

| Screen / feature | Endpoint |
| --- | --- |
| Sign in | `POST /Users/AuthenticateByName` |
| Music libraries | `GET /UserViews` filtered to `CollectionType == music` |
| Recently added | `GET /Users/{userId}/Items/Latest?IncludeItemTypes=MusicAlbum` |
| Recently played | `GET /Users/{userId}/Items?SortBy=DatePlayed&SortOrder=Descending&IncludeItemTypes=MusicAlbum` |
| Albums / compilations / soundtracks | `GET /Users/{userId}/Items?IncludeItemTypes=MusicAlbum&Recursive=true` (+ genre/tag filters to split) |
| Artists | `GET /Artists/AlbumArtists` |
| Tracks | `GET /Users/{userId}/Items?IncludeItemTypes=Audio&Recursive=true` (paged) |
| Genres / styles / moods | `GET /MusicGenres`, and `Tags` / `Studios` for styles & labels |
| Folders | `GET /Items?ParentId=...` walking the physical tree |
| Album tracks | `GET /Users/{userId}/Items?ParentId={albumId}&SortBy=ParentIndexNumber,IndexNumber` |
| Artist top songs | `GET /Users/{userId}/Items?ArtistIds={id}&IncludeItemTypes=Audio&SortBy=PlayCount&SortOrder=Descending&Limit=5` |
| Artwork | `GET /Items/{id}/Images/Primary?maxHeight=...&tag=...` |
| Stream | `GET /Audio/{id}/universal?...` (or `/stream` for direct play) |
| Playlists | `GET /Users/{userId}/Items?IncludeItemTypes=Playlist` |
| Create playlist | `POST /Playlists` |
| Add to playlist | `POST /Playlists/{id}/Items?Ids=...` |
| Favourite | `POST /Users/{userId}/FavoriteItems/{itemId}` / `DELETE` |
| Report playback | `POST /Sessions/Playing`, `/Sessions/Playing/Progress`, `/Sessions/Playing/Stopped` |
| Search | `GET /Users/{userId}/Items?SearchTerm=...&IncludeItemTypes=Audio,MusicAlbum,MusicArtist` |

**Tailscale:** the app just talks to a hostname/IP on the tailnet — no special client work
beyond letting the user enter one and handling the "tailnet not connected" failure mode. Plan
for that error state explicitly: a persistent banner and a fall-back to Downloads-only
browsing. **Neither is designed yet.**

---

## Not Yet Designed

Flagged so nothing is assumed complete:

1. Server connect / sign-in flow (URL entry, Tailscale guidance, credentials, library picker)
2. Offline / server-unreachable states and error banners
3. Loading and empty states for every list
4. Queue / up-next view
5. Lyrics
6. Sleep timer, playback speed, equalizer
7. CarPlay, Siri, Shortcuts, widgets, lock-screen art
8. Light appearance (dark only by request)
9. iPad and macOS layouts

---

## Assets

- **Typeface:** Archivo (Google Fonts, 400/500/600/700), SIL Open Font License.
- **Icons:** Lucide, ISC license.
- **Cover art:** none bundled — flat `#26262b` blocks stand in for artwork served by the
  Jellyfin image API.
- No images, logos, or brand assets of any kind are included.

## Screenshots

`screenshots/` holds 12 reference captures of the prototype (804 × 1748, 2×). Where a
screenshot and the written spec disagree, the written spec wins — the captures are for
orientation, not measurement.

| File | Shows |
| --- | --- |
| `01-home.png` | Home, top — large title, connection pill, Recently played shelf |
| `02-home-made-for-you.png` | Home, scrolled — Made for you cards with Regenerate, Recently added |
| `03-library.png` | Library browse menu, all 12 server categories |
| `04-albums-grid.png` | Albums category — 2-up grid |
| `05-album-detail-mini-player.png` | Album detail with a track playing and the mini-player docked |
| `06-artist-detail.png` | Artist detail — Top songs (5) then Albums |
| `07-full-player.png` | Full-screen player, playing, track downloaded |
| `08-sheet-add-to-playlist.png` | Add to playlist sheet, opened from the player |
| `09-sheet-new-playlist.png` | New playlist sheet — name, toggles, create action |
| `10-downloads.png` | Downloads — storage bar, downloaded sets, loose songs |
| `11-search-results.png` | Search with a query, merged results and filter chips |
| `12-settings.png` | Settings — server card and grouped rows |

Note: the captures are DOM renders, so the iOS status bar and dynamic island do not appear in
them. They are present in the live prototype and are the platform's own, not part of this design.

## Files in this bundle

| File | What it is |
| --- | --- |
| `Jellyfin Music.dc.html` | The prototype. Open it in a browser — every screen and interaction described above is live. |
| `ios-frame.jsx` | The iPhone bezel / status bar / home-indicator wrapper the prototype renders inside. Not part of the app design. |
| `screenshots/` | 12 reference captures — see the table above. |
| `_ds/` | The Modernist design system this project is bound to — the source of the typeface and the `#ec3013` accent. Its own visual language (flat, square, red-on-white) is intentionally not followed for the app chrome; see the note under Design Tokens. |

The prototype's logic class contains all the sample data (`ARTISTS`, `ALBUMS`, `CATS`,
`TAGSETS`, `PLAYLISTS`, `MIXSETS`) and every interaction handler in one place, which is the
quickest way to read the intended behavior.
