import { ArrowDownToLine, Check } from 'lucide-react';
import { useState } from 'react';

import { usePage } from '@/nav/page-context';
import { albumTitle, fileName, type AlbumFile } from '@/pipeline/client';
import { downloadAlbum, findResult, usePipeline } from '@/pipeline/pipeline';
import { formatTime } from '@/player/track';
import { Page } from '@/ui/page';
import { toast } from '@/ui/toast';
import { SlotLine } from './add-albums-screen';
import { formatBytes } from './downloaded-screen';
import styles from './album-result-screen.module.css';

/** One Soulseek album folder: every file in it, so a wrong edition shows before downloading. */
export function AlbumResultScreen({ id, title }: { id: string; title?: string }) {
  usePipeline((s) => s.results);
  const album = findResult(id);
  const { goBack } = usePage();
  const [state, setState] = useState<'idle' | 'busy' | 'queued'>('idle');

  if (!album) {
    return (
      <Page title={title ?? 'Album'} variant="detail">
        <p className={styles.gone}>This search result isn’t around any more. Search again.</p>
      </Page>
    );
  }

  const details = [album.year, `${album.trackCount} tracks`, album.format.toUpperCase(), album.bitrate ? `${album.bitrate} kbps` : null]
    .filter(Boolean)
    .join(' · ');

  const download = async () => {
    if (state !== 'idle') return;
    setState('busy');
    const error = await downloadAlbum(album);
    if (error) {
      setState('idle');
      toast(error);
      return;
    }
    setState('queued');
    toast('Downloading - it appears in your library once tagged');
    window.setTimeout(goBack, 700);
  };

  return (
    <Page title={albumTitle(album)} variant="detail">
      <section className={styles.head}>
        <h1 className={styles.title}>{albumTitle(album)}</h1>
        {album.artist && <p className={styles.artist}>{album.artist}</p>}
        <p className={styles.details}>{details}</p>
        <p className={styles.folder}>{album.folderName}</p>
        <SlotLine album={album} />
        <button type="button" className={styles.download} data-queued={state === 'queued' || undefined} onClick={() => void download()}>
          {state === 'queued' ? <Check size={18} strokeWidth={2.4} /> : <ArrowDownToLine size={18} strokeWidth={2.4} />}
          {state === 'busy' ? 'Starting…' : state === 'queued' ? 'Downloading' : 'Download to library'}
        </button>
      </section>
      <p className={`t-eyebrow ${styles.eyebrow}`}>Files in this folder</p>
      {album.files.map((file, i) => (
        <FileRow key={file.filename} index={i + 1} file={file} />
      ))}
    </Page>
  );
}

function FileRow({ index, file }: { index: number; file: AlbumFile }) {
  const right = [file.length ? formatTime(file.length) : null, file.bitrate ? `${file.bitrate}k` : null].filter(Boolean).join(' · ');
  return (
    <div className={styles.file}>
      <span className={styles.index}>{index}</span>
      <span className={styles.name}>{fileName(file)}</span>
      <span className={styles.meta}>
        {right && <span>{right}</span>}
        <span className={styles.size}>{formatBytes(file.size)}</span>
      </span>
    </div>
  );
}
