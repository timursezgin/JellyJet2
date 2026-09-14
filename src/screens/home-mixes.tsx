import { CalendarClock, ChevronRight, Play, Radio, RefreshCw, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useSession } from '@/auth/session';
import { navigate } from '@/nav/navigation';
import { MIX_KICKER } from '@/mixes/generator';
import { loadMixes, regenerateMixes, useMixes, visibleMixes } from '@/mixes/mixes';
import { DECADES, startDecadeRadio, startLibraryRadio } from '@/mixes/stations';
import { playTracks } from '@/player/player';
import { SectionHeader, Shelf } from '@/ui/section';
import { Sheet } from '@/ui/sheet';
import styles from './home-mixes.module.css';

/** Home's "Made for you": four mix cards and Regenerate. */
export function MadeForYou() {
  const userId = useSession((s) => s.session?.userId);
  const mixes = useMixes(useShallow(visibleMixes));
  const generating = useMixes((s) => s.generating);
  const error = useMixes((s) => s.error);
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    if (userId) loadMixes(userId);
  }, [userId]);

  const regenerate = () => {
    // The icon turns once for a quick change, and keeps turning while new mixes are built.
    setSpinning(true);
    window.setTimeout(() => setSpinning(false), 700);
    void regenerateMixes();
  };

  return (
    <>
      <SectionHeader
        title="Made for you"
        trailing={
          <button type="button" className={styles.regenerate} onClick={regenerate} disabled={generating}>
            <RefreshCw size={15} strokeWidth={2.4} data-spinning={spinning || generating || undefined} />
            Regenerate
          </button>
        }
      />
      {mixes.length > 0 ? (
        <Shelf>
          {mixes.map((mix) => (
            <div key={mix.id} className={styles.card}>
              <button
                type="button"
                className={styles.open}
                onClick={() => navigate({ name: 'mix', id: mix.id, title: mix.name })}
              >
                <span className="t-kicker">{MIX_KICKER[mix.kind]}</span>
                <span className={`t-mix-card-name ${styles.name}`}>{mix.name}</span>
                <span className={styles.why}>{mix.why}</span>
              </button>
              <button
                type="button"
                className={styles.play}
                onClick={() => playTracks(mix.tracks, 0, { shuffle: false })}
                aria-label={`Play ${mix.name}`}
              >
                <Play size={11} fill="currentColor" strokeWidth={0} />
              </button>
            </div>
          ))}
        </Shelf>
      ) : generating ? (
        <Shelf>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={styles.placeholder} />
          ))}
        </Shelf>
      ) : (
        <p className={styles.empty}>{error ?? 'Play some music and your mixes will appear here.'}</p>
      )}
    </>
  );
}

/** Home's Stations: Artist mix, Library radio, Decade radio. */
export function Stations() {
  const [decadesOpen, setDecadesOpen] = useState(false);
  return (
    <>
      <SectionHeader title="Stations" />
      <div className={styles.stations}>
        <button type="button" className={styles.station} onClick={() => navigate({ name: 'artist-mix' })}>
          <UserPlus size={20} strokeWidth={2.2} />
          <span>
            Artist
            <br />
            mix
          </span>
        </button>
        <button type="button" className={styles.station} onClick={() => void startLibraryRadio()}>
          <Radio size={20} strokeWidth={2.2} />
          <span>
            Library
            <br />
            radio
          </span>
        </button>
        <button type="button" className={styles.station} onClick={() => setDecadesOpen(true)}>
          <CalendarClock size={20} strokeWidth={2.2} />
          <span>
            Decade
            <br />
            radio
          </span>
        </button>
      </div>
      <Sheet open={decadesOpen} onClose={() => setDecadesOpen(false)} title="Decade radio" closeLabel="Cancel">
        <div className={styles.decades}>
          {DECADES.map((decade) => (
            <button
              key={decade}
              type="button"
              className={styles.decade}
              onClick={() => {
                setDecadesOpen(false);
                void startDecadeRadio(decade);
              }}
            >
              {decade}s
              <ChevronRight size={17} strokeWidth={2} />
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}
