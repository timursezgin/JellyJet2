import {
  ListMusic,
  MessageSquareQuote,
  MonitorSpeaker,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useRef, useState, type PointerEvent } from 'react';

import { navigate } from '@/nav/navigation';
import { DeviceButton } from '@/remote/device-picker';
import { SongButtons } from '@/songs/song-buttons';
import { songContextMenu } from '@/songs/song-menu';
import { Artwork } from '@/ui/artwork';
import { TextLink } from '@/ui/text-link';
import {
  currentTrack,
  cycleRepeat,
  next,
  previous,
  setShuffle,
  setVolume,
  togglePlay,
  toggleMute,
  usePlayer,
} from './player';
import { Scrubber } from './scrubber';
import { toggleSidePanel, useSidePanel } from './side-panel';
import styles from './player-bar.module.css';

/** Desktop: the player along the bottom of the window, whenever something is queued. */
export function PlayerBar() {
  const track = usePlayer((s) => currentTrack(s));
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const panel = useSidePanel((s) => s.view);
  const remote = usePlayer((s) => s.remote);

  if (!track) return null;

  return (
    <div className={styles.bar} onContextMenu={songContextMenu(track)}>
      <div className={styles.song}>
        <button
          type="button"
          className={styles.cover}
          disabled={!track.albumId}
          onClick={() => navigate({ name: 'album', id: track.albumId!, title: track.album })}
          aria-label={track.album ? `Go to ${track.album}` : 'Album'}
          title={track.album}
        >
          <Artwork art={track.art} size={56} radius={8} eager />
        </button>
        <div className={styles.text}>
          <button
            type="button"
            className={styles.title}
            disabled={!track.albumId}
            onClick={() => navigate({ name: 'album', id: track.albumId!, title: track.album })}
            title={track.name}
          >
            <span className={styles.clamp}>{track.name}</span>
          </button>
          <span className={styles.artists} title={track.artists.map((a) => a.name).join(', ')}>
            {track.artists.map((a, i) => (
              <span key={`${a.name}-${i}`}>
                {i > 0 && ', '}
                {a.id ? (
                  <TextLink className={styles.artist} onOpen={() => navigate({ name: 'artist', id: a.id!, title: a.name })}>
                    {a.name}
                  </TextLink>
                ) : (
                  a.name
                )}
              </span>
            ))}
          </span>
        </div>
        <SongButtons track={track} />
      </div>

      <div className={styles.middle}>
        <div className={styles.transport}>
          <button
            type="button"
            className={styles.side}
            data-active={shuffle || undefined}
            onClick={() => setShuffle(!shuffle)}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            title="Shuffle"
          >
            <Shuffle size={18} strokeWidth={2} />
          </button>
          <button type="button" className={styles.skip} onClick={previous} aria-label="Previous song" title="Previous (Ctrl+←)">
            <SkipBack size={20} fill="currentColor" strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.play}
            data-buffering={(buffering && playing) || undefined}
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            {playing ? (
              <Pause size={18} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={18} fill="currentColor" strokeWidth={0} className={styles.playGlyph} />
            )}
          </button>
          <button type="button" className={styles.skip} onClick={next} aria-label="Next song" title="Next (Ctrl+→)">
            <SkipForward size={20} fill="currentColor" strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.side}
            data-active={repeat !== 'off' || undefined}
            onClick={cycleRepeat}
            aria-label={`Repeat: ${repeat}`}
            title={repeat === 'off' ? 'Repeat' : repeat === 'all' ? 'Repeat all' : 'Repeat this song'}
          >
            {repeat === 'one' ? <Repeat1 size={18} strokeWidth={2} /> : <Repeat size={18} strokeWidth={2} />}
          </button>
        </div>
        <Scrubber inline />
      </div>

      <div className={styles.end}>
        <DeviceButton className={styles.side} size={19} />
        {remote ? (
          <span className={styles.remote} title={`Playing on ${remote.deviceName}`}>
            <MonitorSpeaker size={16} strokeWidth={2.2} />
            <span>Playing on {remote.deviceName}</span>
          </span>
        ) : (
          <VolumeControl />
        )}
        <button
          type="button"
          className={styles.side}
          data-active={panel === 'lyrics' || undefined}
          onClick={() => toggleSidePanel('lyrics')}
          aria-label="Lyrics"
          aria-pressed={panel === 'lyrics'}
          title="Lyrics"
        >
          <MessageSquareQuote size={18} strokeWidth={2} />
        </button>
        <button
          type="button"
          className={styles.side}
          data-active={panel === 'queue' || undefined}
          onClick={() => toggleSidePanel('queue')}
          aria-label="Queue"
          aria-pressed={panel === 'queue'}
          title="Queue"
        >
          <ListMusic size={19} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

function VolumeControl() {
  const volume = usePlayer((s) => s.volume);
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const at = (e: PointerEvent) => {
    const rect = track.current!.getBoundingClientRect();
    return (e.clientX - rect.left) / rect.width;
  };

  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className={styles.volume}>
      <button
        type="button"
        className={styles.side}
        onClick={toggleMute}
        aria-label={volume === 0 ? 'Unmute' : 'Mute'}
        title={volume === 0 ? 'Unmute' : 'Mute'}
      >
        <Icon size={19} strokeWidth={2} />
      </button>
      <div
        ref={track}
        className={styles.volumeHit}
        data-dragging={dragging || undefined}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          setVolume(at(e));
        }}
        onPointerMove={(e) => dragging && setVolume(at(e))}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onWheel={(e) => setVolume(volume - Math.sign(e.deltaY) * 0.05)}
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volume * 100)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setVolume(volume - 0.05);
          else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setVolume(volume + 0.05);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className={styles.volumeTrack}>
          <div className={styles.volumeFill} style={{ transform: `scaleX(${volume})` }} />
        </div>
        <div className={styles.volumeKnob} style={{ left: `${volume * 100}%` }} />
      </div>
    </div>
  );
}
