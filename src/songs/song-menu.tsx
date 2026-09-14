import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Heart,
  ListMinus,
  ListPlus,
  ListEnd,
  MicVocal,
  Plus,
  Trash2,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { create } from 'zustand';

import { useSession } from '@/auth/session';
import { queryClient } from '@/data/query-client';
import { deleteItem } from '@/jellyfin/api';
import { navigate, type Route } from '@/nav/navigation';
import { addToQueue, closePlayer, removeFromQueue, usePlayer } from '@/player/player';
import { artistLine, type Track } from '@/player/track';
import { Artwork } from '@/ui/artwork';
import { confirm } from '@/ui/confirm';
import { PlaylistCover } from '@/ui/covers';
import { Sheet } from '@/ui/sheet';
import { toast } from '@/ui/toast';
import { setLiked, useIsLiked } from './likes';
import { addToPlaylist, createPlaylist, removeFromPlaylist, usePlaylistMembership } from './playlists';
import styles from './song-menu.module.css';

/** Where the menu was opened from, when it changes what's offered. */
export interface SongContext {
  /** Viewing this playlist: "Remove from playlist" acts on it directly. */
  playlist?: { id: string; name: string };
}

type View = 'menu' | 'add' | 'remove' | 'new';

interface MenuState {
  track: Track | null;
  context: SongContext;
  open: boolean;
  view: View;
}

const useSongMenu = create<MenuState>(() => ({ track: null, context: {}, open: false, view: 'menu' }));

export function openSongMenu(track: Track, context: SongContext = {}) {
  useSongMenu.setState({ track, context, open: true, view: 'menu' });
}

/** Open the "Add to playlist" list straight away (e.g. from the player). */
export function openAddToPlaylist(track: Track) {
  useSongMenu.setState({ track, context: {}, open: true, view: 'add' });
}

const close = () => useSongMenu.setState({ open: false });
const show = (view: View) => useSongMenu.setState({ view });

export function SongMenuHost() {
  const { track, context, open, view } = useSongMenu();
  if (!track) return null;
  const titles: Record<View, string> = {
    menu: track.name,
    add: 'Add to playlist',
    remove: 'Remove from playlist',
    new: 'New playlist',
  };
  return (
    <Sheet
      open={open}
      onClose={close}
      title={titles[view]}
      closeLabel={view === 'menu' ? 'Done' : 'Cancel'}
      header={
        view === 'menu' ? (
          <div className={styles.song}>
            <Artwork art={track.art} size={48} radius={8} />
            <div className={styles.songText}>
              <p className={styles.songTitle}>{track.name}</p>
              <p className={styles.songArtist}>{artistLine(track)}</p>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={styles.backTitle}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => show('menu')}
          >
            <ChevronLeft size={22} strokeWidth={2.4} />
            <span className="t-sheet-title">{titles[view]}</span>
          </button>
        )
      }
    >
      {view === 'menu' && <MainMenu track={track} context={context} open={open} />}
      {view === 'add' && <AddToPlaylist track={track} />}
      {view === 'remove' && <RemoveFromPlaylist track={track} />}
      {view === 'new' && <NewPlaylist track={track} />}
    </Sheet>
  );
}

function MainMenu({ track, context, open }: { track: Track; context: SongContext; open: boolean }) {
  const liked = useIsLiked(track);
  const permissions = useSession((s) => s.session?.permissions);
  const membership = usePlaylistMembership(track.id, open);
  const inPlaylists = membership.rows.filter((r) => r.entryIds.length > 0);
  const artist = track.artists.find((a) => a.id);

  const go = (route: Route) => {
    close();
    closePlayer();
    navigate(route);
  };

  return (
    <div className={styles.list}>
      <MenuRow
        icon={Heart}
        filled={liked}
        label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
        onClick={() => {
          close();
          void setLiked(track, !liked);
        }}
      />
      {permissions?.canDownload && (
        <MenuRow
          icon={ArrowDownToLine}
          label="Download"
          onClick={() => {
            close();
            toast('Downloads arrive in the next update');
          }}
        />
      )}
      <MenuRow icon={ListPlus} label="Add to playlist" chevron onClick={() => show('add')} />
      {context.playlist ? (
        <MenuRow
          icon={ListMinus}
          label={`Remove from ${context.playlist.name}`}
          onClick={() => {
            close();
            const entries = track.entryId
              ? [track.entryId]
              : (membership.rows.find((r) => r.playlist.Id === context.playlist!.id)?.entryIds ?? []);
            void removeFromPlaylist({ Id: context.playlist!.id, Name: context.playlist!.name }, entries);
          }}
        />
      ) : (
        inPlaylists.length > 0 && (
          <MenuRow icon={ListMinus} label="Remove from playlist" chevron onClick={() => show('remove')} />
        )
      )}
      <MenuRow
        icon={ListEnd}
        label="Add to queue"
        onClick={() => {
          close();
          addToQueue([track]);
          toast('Added to queue');
        }}
      />
      {track.albumId && (
        <MenuRow icon={Disc3} label="Go to album" onClick={() => go({ name: 'album', id: track.albumId!, title: track.album })} />
      )}
      {artist && (
        <MenuRow icon={MicVocal} label="Go to artist" onClick={() => go({ name: 'artist', id: artist.id!, title: artist.name })} />
      )}
      {permissions?.canDeleteFromLibrary && (
        <MenuRow icon={Trash2} label="Remove from library" destructive onClick={() => void removeFromLibrary(track)} />
      )}
    </div>
  );
}

async function removeFromLibrary(track: Track) {
  close();
  const { client, session } = useSession.getState();
  if (!client || !session) return;
  const ok = await confirm({
    title: 'Remove from library?',
    message: `“${track.name}” will be permanently deleted from ${session.serverName}, including its file. This can’t be undone.`,
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (!ok) return;
  try {
    await deleteItem(client, track.id);
    // Take it out of the queue too, so nothing tries to play a missing file.
    const queue = usePlayer.getState().queue;
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].id === track.id) removeFromQueue(i);
    void queryClient.invalidateQueries();
    toast('Removed from library');
  } catch {
    toast('Couldn’t remove it - check your permissions in Jellyfin');
  }
}

function AddToPlaylist({ track }: { track: Track }) {
  const membership = usePlaylistMembership(track.id, true);
  return (
    <div className={styles.list}>
      <button type="button" className={styles.row} onClick={() => show('new')}>
        <span className={styles.newTile}>
          <Plus size={20} strokeWidth={2.4} />
        </span>
        <span className={styles.newLabel}>New playlist</span>
      </button>
      {membership.rows.map(({ playlist, entryIds, known }) => {
        const already = entryIds.length > 0;
        return (
          <button
            key={playlist.Id}
            type="button"
            className={styles.row}
            disabled={!known}
            onClick={() => {
              close();
              if (already) toast(`Already in ${playlist.Name}`);
              else void addToPlaylist(playlist, [track.id]);
            }}
          >
            <PlaylistCover playlistId={playlist.Id} size={44} radius={8} />
            <span className={styles.rowLabel}>{playlist.Name}</span>
            {already ? (
              <Check className={styles.check} size={20} strokeWidth={2.6} aria-label="Already added" />
            ) : (
              <span className={styles.add}>{known ? 'Add' : ''}</span>
            )}
          </button>
        );
      })}
      {membership.loading && membership.rows.length === 0 && <p className={styles.note}>Loading playlists…</p>}
    </div>
  );
}

function RemoveFromPlaylist({ track }: { track: Track }) {
  const membership = usePlaylistMembership(track.id, true);
  const rows = membership.rows.filter((r) => r.entryIds.length > 0);
  return (
    <div className={styles.list}>
      {rows.map(({ playlist, entryIds }) => (
        <button
          key={playlist.Id}
          type="button"
          className={styles.row}
          onClick={() => {
            close();
            void removeFromPlaylist(playlist, entryIds);
          }}
        >
          <PlaylistCover playlistId={playlist.Id} size={44} radius={8} />
          <span className={styles.rowLabel}>{playlist.Name}</span>
          <span className={styles.remove}>Remove</span>
        </button>
      ))}
      {rows.length === 0 && <p className={styles.note}>This song isn’t in any of your playlists.</p>}
    </div>
  );
}

function NewPlaylist({ track }: { track: Track | null }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const serverName = useSession((s) => s.session?.serverName);

  useEffect(() => setName(''), [track]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    await createPlaylist(trimmed, track ? [track.id] : []);
    setBusy(false);
    close();
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <input
        className={styles.input}
        placeholder="Playlist name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        enterKeyHint="done"
        maxLength={120}
      />
      <button type="submit" className={styles.create} disabled={!name.trim() || busy}>
        {track ? 'Create and add song' : `Create on ${serverName ?? 'the server'}`}
      </button>
      <p className={styles.note}>Playlists are saved to your Jellyfin account and only you can see them.</p>
    </form>
  );
}

// --- "New playlist" on its own (from the Playlists page) --------------------

const useNewPlaylist = create<{ open: boolean }>(() => ({ open: false }));
export const openNewPlaylist = () => useNewPlaylist.setState({ open: true });

export function NewPlaylistHost() {
  const open = useNewPlaylist((s) => s.open);
  return (
    <Sheet open={open} onClose={() => useNewPlaylist.setState({ open: false })} title="New playlist" closeLabel="Cancel">
      <NewPlaylistStandalone onDone={() => useNewPlaylist.setState({ open: false })} />
    </Sheet>
  );
}

function NewPlaylistStandalone({ onDone }: { onDone(): void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    await createPlaylist(trimmed, []);
    setBusy(false);
    setName('');
    onDone();
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <input
        className={styles.input}
        placeholder="Playlist name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        enterKeyHint="done"
        maxLength={120}
      />
      <button type="submit" className={styles.create} disabled={!name.trim() || busy}>
        Create playlist
      </button>
      <p className={styles.note}>Playlists are saved to your Jellyfin account and only you can see them.</p>
    </form>
  );
}

function MenuRow({
  icon: Icon,
  label,
  onClick,
  filled,
  chevron,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  onClick(): void;
  filled?: boolean;
  chevron?: boolean;
  destructive?: boolean;
}) {
  return (
    <button type="button" className={styles.menuRow} data-destructive={destructive || undefined} onClick={onClick}>
      <Icon size={21} strokeWidth={2} fill={filled ? 'currentColor' : 'none'} className={filled ? styles.filled : undefined} />
      <span className={styles.menuLabel}>{label}</span>
      {chevron && <ChevronRight size={18} strokeWidth={2.2} className={styles.chevron} />}
    </button>
  );
}
