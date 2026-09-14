# JellyJet 2 - plan

A React web app for the owner's Jellyfin server. Anyone with the link adds it to
their phone's home screen and uses it like an app. It replaces the Flutter web
version of JellyJet; the Flutter iPhone app (`~/Desktop/JellyJet`) is separate
and untouched. Feishin is a source of ideas only - no code or logic is copied.

## Decisions (settled with the owner, 2026-09-13)

### Song buttons
- Every song row and the full player: **heart | download arrow | (…)**. Each is
  a large tappable block, not just the icon. The old (+) button is gone.
- **(…) menu:** like, download, add to playlist, remove from playlist, add to
  queue, go to album, go to artist, remove from library.
  - *Remove from playlist* outside a playlist lists the playlists containing
    the song to pick from; hidden if it's in none.
  - *Remove from library* only for admins with media deletion allowed.
- **Liked and downloaded are properties of the song**, shown identically
  everywhere (any album, playlist, queue, search result).
- Liking never downloads anything.

### Downloads
- Download buttons on **songs, playlists, albums and Liked Songs**.
- A downloaded playlist/album/Liked Songs **automatically fetches songs added
  to it later**.
- **Removing a download always asks first.** The song leaves the Downloaded
  list but stays listed in its playlists. A downloaded playlist keeps fetching
  new songs but does not re-fetch one whose download was removed.
- Taking a song out of a playlist only happens via the (…) menu.
- Quality: Settings choice, **Original** (default) or **Smaller**.
- Who can download: Jellyfin's per-user "Allow media downloading" setting.
- Storage: the site's own storage on the phone (Cache Storage for the files,
  IndexedDB for the list - chosen over OPFS because the service worker must
  read the files to play them offline, which is proven in WebKit),
  `navigator.storage.persist()` so iOS doesn't clear it, and the list of
  downloads backed up to the Jellyfin account (display preferences
  `jellyjet-downloads`) for one-tap re-download. Downloads only from the
  home-screen app on iOS (a Safari tab has separate storage), and only on the
  secure (https / localhost) address.
- Unliking a song in a downloaded Liked Songs, or a song leaving a downloaded
  playlist on the server, lets go of its download unless something else
  (another collection, or downloading it on its own) keeps it.

### Offline
- The normal app with an "Offline" notice under the page title. Songs that can't play are grey,
  playable ones white; lists stay browsable.
- Likes and playlist edits made offline save instantly and sync when back
  online.

### Layout
- Phone first; desktop layout later.
- Tabs: **Home · Search · Library · Settings** (the Downloaded tab was dropped
  on 2026-09-14: Downloaded lives at the top of Library).
- Offline: a notice under each page's title, "Offline • Go to Downloaded",
  where "Go to Downloaded" opens the Downloaded list.
- **Liked Songs** and **Downloaded** are special playlists, shown at the top
  of Library (not inside Playlists).
- **Hidden search**: swipe down to reveal it in playlists (including Liked and
  Downloaded), artist pages and library lists.
- No pull-to-refresh; lists refresh automatically.

### Scope of the first version
- Username + password sign-in (no Quick Connect).
- Add new albums (the existing Soulseek orchestrator on tim-box via
  `/pipeline`), Made for you mixes, Stations.
- Playback reported to Jellyfin (`/Sessions/Playing*`) so play counts and the
  mixes stay accurate.

### Lock screen (decided 2026-09-14)
- Playback continues with the phone locked, songs advance, lock-screen
  next/previous work.
- Accepted iOS web-app limit: after pausing from the lock screen, iOS puts the
  app to sleep and gives the lock-screen player to another app; resuming means
  opening JellyJet. No workarounds (genuine solutions only). A native app for
  the owner remains a possible later addition.

### Hosting
- Own container **JellyJet2** in tim-box `Desktop\JellyJet2`, port **8091**,
  next to the original **JellyJet** container on 8090. jj.timursezgin.work is
  switched between versions by changing the port on its Cloudflare route; the
  address stays the same so phone downloads stay tied to jj.
- Publish: `sh tool/deploy.sh`. Work is pushed to GitHub after each tested step.

## Steps

0. **Setup** - toolchain, project, design tokens, container, publish script. ✅
1. **Sign-in and app frame** - sign-in, five tabs, page slide animations. ✅ (real-account sign-in to be confirmed by the owner)
2. **Player** - mini + full player, queue, lock-screen controls, instant next
   song. *Checkpoint: owner tests locked-screen playback on the iPhone.* ✅
3. **Browsing** - Home, Library, albums, artists, playlists, Liked Songs,
   Search, swipe-down search. ✅ (owner to check with real data)
4. **Song buttons** - heart | download | (…) everywhere, the (…) menu,
   playlist add/remove. ✅ (download button placeholder until step 5)
5. **Downloads and offline** - storage, collection downloads, Downloaded tab,
   grey songs, offline edit sync, quality setting, backup/re-download. ✅
   (tested end to end in WebKit against a pretend server; owner to test on the
   phone over https)
6. **Extras** - Made for you mixes (the original JellyJet's recipes, built on
   the phone, kept until Regenerate, savable as "JellyJet · <name>"
   playlists), Stations (Artist mix, Library radio - offline it shuffles the
   downloads - and Decade radio), Add albums on Library for admins with
   deletion rights (key from `api_key.txt` entered once per phone, Soulseek
   search, file list, download progress, cancel). ✅ (tested end to end in
   WebKit against pretend servers; mixes and stations checked with real data
   on the Simulator; owner to try Add albums with the real key)
7. **Smoothness pass** on the phone; desktop layout later.
