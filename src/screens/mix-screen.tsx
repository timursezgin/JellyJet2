import { Check, ListPlus } from 'lucide-react';
import { useState } from 'react';

import { MIX_KICKER } from '@/mixes/generator';
import { findMix, useMixes } from '@/mixes/mixes';
import { findStation } from '@/mixes/stations';
import type { Track } from '@/player/track';
import { createPlaylist } from '@/songs/playlists';
import { SongsCover, StationCover } from '@/ui/covers';
import { HeroIconButton } from '@/ui/hero';
import { Page } from '@/ui/page';
import { TrackCollection } from './playlist-screen';
import styles from './detail-screens.module.css';

/** A Made for you mix: its songs, why it was made, and saving it as a playlist. */
export function MixScreen({ id, title }: { id: string; title?: string }) {
  // Re-read when the pool changes (a regenerate can retire this mix).
  useMixes((s) => s.pool);
  const mix = findMix(id);
  if (!mix) return <Gone title={title ?? 'Mix'} />;
  return (
    <TrackCollection
      title={mix.name}
      kicker={MIX_KICKER[mix.kind]}
      note={mix.why}
      art={<SongsCover tracks={mix.tracks} size={200} />}
      query={listOf(mix.tracks)}
      empty="This mix is empty."
      actions={<SaveAsPlaylist name={mix.name} tracks={mix.tracks} />}
    />
  );
}

/** A station built from picked artists. */
export function StationScreen({ id, title }: { id: string; title?: string }) {
  const station = findStation(id);
  if (!station) return <Gone title={title ?? 'Station'} />;
  return (
    <TrackCollection
      title={station.name}
      kicker="Station"
      note="A temporary mix. Save it to keep it."
      art={<StationCover size={200} />}
      query={listOf(station.tracks)}
      empty="No songs."
      actions={<SaveAsPlaylist name={station.name} tracks={station.tracks} />}
    />
  );
}

const listOf = (tracks: Track[]) => ({ data: tracks, isPending: false, isError: false, refetch: () => {} });

/** Keeps a generated list as a real playlist on the server, named "JellyJet · <name>". */
function SaveAsPlaylist({ name, tracks }: { name: string; tracks: Track[] }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  return (
    <HeroIconButton
      label={state === 'saved' ? 'Saved as a playlist' : 'Save as a playlist'}
      active={state === 'saved'}
      onClick={async () => {
        if (state !== 'idle') return;
        setState('saving');
        const id = await createPlaylist(
          `JellyJet · ${name}`,
          tracks.map((t) => t.id),
          'Saved to your playlists',
        );
        setState(id ? 'saved' : 'idle');
      }}
    >
      {state === 'saved' ? <Check size={20} strokeWidth={2.4} /> : <ListPlus size={20} strokeWidth={2.2} />}
    </HeroIconButton>
  );
}

function Gone({ title }: { title: string }) {
  return (
    <Page title={title} variant="detail">
      <p className={styles.message}>This mix isn’t around any more.</p>
    </Page>
  );
}
