import { ChevronRight, CircleAlert, CircleCheck, Clock, Search, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { useOnline } from '@/connectivity/connection';
import { navigate } from '@/nav/navigation';
import { albumTitle, isActiveJob, type AlbumResult, type DownloadJob } from '@/pipeline/client';
import {
  clearSearch,
  connectPipeline,
  forgetPipeline,
  cancelOrDismissJob,
  forgetJob,
  refreshJobs,
  searchSoulseek,
  usePipeline,
} from '@/pipeline/pipeline';
import { confirm } from '@/ui/confirm';
import { Page } from '@/ui/page';
import { SectionHeader } from '@/ui/section';
import { SwipeRow } from '@/ui/swipe-row';
import { toast } from '@/ui/toast';
import { formatBytes } from './downloaded-screen';
import styles from './add-albums-screen.module.css';

/**
 * Search Soulseek and download whole albums to the server: tim-box fetches
 * them, beets tags them, and they appear in the library.
 */
export function AddAlbumsScreen() {
  const key = usePipeline((s) => s.key);
  const online = useOnline();
  return (
    <Page title="Add albums">
      {!online ? (
        <p className={styles.message}>Adding albums needs a connection.</p>
      ) : key ? (
        <Connected />
      ) : (
        <Setup />
      )}
    </Page>
  );
}

function Connected() {
  const query = usePipeline((s) => s.query);
  const searching = usePipeline((s) => s.searching);
  const results = usePipeline((s) => s.results);
  const searchError = usePipeline((s) => s.searchError);
  const jobs = usePipeline((s) => s.jobs);
  const [text, setText] = useState(query);
  const [openJob, setOpenJob] = useState<string | null>(null);

  useEffect(() => {
    void refreshJobs();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 2) return;
    (document.activeElement as HTMLElement | null)?.blur();
    void searchSoulseek(text);
  };

  return (
    <>
      {/* Searches only when submitted: Soulseek doesn't want a request per keystroke. */}
      <form className={styles.controls} onSubmit={submit} action="">
        <label className={styles.field}>
          <Search size={17} strokeWidth={2.2} />
          <input
            type="search"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Album or artist, then search"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (!e.target.value) clearSearch();
            }}
          />
          {text && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => {
                setText('');
                clearSearch();
              }}
              aria-label="Clear search"
            >
              <X size={14} strokeWidth={3} />
            </button>
          )}
        </label>
      </form>

      {jobs.length > 0 && (
        <>
          <SectionHeader title="Downloads" />
          {jobs.map((job) => (
            <JobRow
              key={job.jobId}
              job={job}
              open={openJob === job.jobId}
              onOpenChange={(open) => setOpenJob((current) => (open ? job.jobId : current === job.jobId ? null : current))}
            />
          ))}
        </>
      )}

      {searching ? (
        <p className={styles.message}>
          <span className={styles.spinner} />
          Searching Soulseek - this can take up to a minute
        </p>
      ) : searchError ? (
        <p className={styles.message}>{searchError}</p>
      ) : results ? (
        <>
          <SectionHeader title="Results" />
          {results.length === 0 ? (
            <p className={styles.message}>Nothing matched that on Soulseek right now.</p>
          ) : (
            results.map((album) => <ResultRow key={album.id} album={album} />)
          )}
        </>
      ) : (
        jobs.length === 0 && (
          <p className={styles.intro}>
            Search for an album. Pick a version and it downloads to your server, gets tagged, and shows up in your library.
          </p>
        )
      )}

      <button
        type="button"
        className={styles.forget}
        onClick={async () => {
          const ok = await confirm({
            title: 'Forget the key?',
            message: 'You’ll need the key from api_key.txt again to add albums on this phone.',
            confirmLabel: 'Forget',
            destructive: true,
          });
          if (ok) forgetPipeline();
        }}
      >
        Forget the download server key
      </button>
    </>
  );
}

function ResultRow({ album }: { album: AlbumResult }) {
  const details = [album.artist, `${album.trackCount} tracks`, album.format.toUpperCase(), album.bitrate ? `${album.bitrate} kbps` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <button
      type="button"
      className={styles.result}
      onClick={() => navigate({ name: 'album-result', id: album.id, title: albumTitle(album) })}
    >
      <span className={styles.resultText}>
        <span className={styles.resultTitle}>
          <span className={styles.ellipsis}>{albumTitle(album)}</span>
          {album.year ? <span className={styles.year}>{album.year}</span> : null}
        </span>
        <span className={styles.resultDetails}>{details}</span>
        <SlotLine album={album} />
      </span>
      <ChevronRight size={17} strokeWidth={2} className={styles.chevron} />
    </button>
  );
}

export function SlotLine({ album }: { album: AlbumResult }) {
  return (
    <span className={styles.slot} data-free={album.hasFreeSlot || undefined}>
      {album.hasFreeSlot ? <CircleCheck size={12} strokeWidth={2.4} /> : <Clock size={12} strokeWidth={2.4} />}
      {album.hasFreeSlot ? 'Free slot' : album.queueLength > 0 ? `Queue ${album.queueLength}` : 'May queue'}
      {' · '}
      {album.user} · {formatBytes(album.totalBytes)}
    </span>
  );
}

/** A download. Swipe it left: Cancel while it's going, Dismiss once it's done. */
function JobRow({ job, open, onOpenChange }: { job: DownloadJob; open: boolean; onOpenChange(open: boolean): void }) {
  const active = isActiveJob(job);
  const status =
    job.state === 'queued'
      ? 'Waiting for a slot'
      : job.state === 'downloading'
        ? `Downloading ${Math.round(job.progress * 100)}%`
        : job.state === 'tagging'
          ? 'Tagging and filing'
          : job.state === 'inLibrary'
            ? 'Added to your library'
            : job.note || 'Couldn’t finish';

  return (
    <SwipeRow
      actionLabel={active ? 'Cancel' : 'Dismiss'}
      open={open}
      onOpenChange={onOpenChange}
      onAction={async () => {
        const error = await cancelOrDismissJob(job.jobId);
        if (error) toast(error);
        return !error;
      }}
      onGone={() => forgetJob(job.jobId)}
    >
      <div className={styles.job} data-state={job.state}>
        <span className={styles.jobIcon}>
          {job.state === 'inLibrary' ? (
            <CircleCheck size={18} strokeWidth={2.2} />
          ) : job.state === 'failed' ? (
            <CircleAlert size={18} strokeWidth={2.2} />
          ) : (
            <span className={styles.spinner} />
          )}
        </span>
        <span className={styles.jobText}>
          <span className={styles.jobTitle}>{albumTitle(job)}</span>
          <span className={styles.jobStatus}>
            {job.artist ? `${job.artist} · ` : ''}
            {status}
          </span>
          {job.state === 'downloading' && (
            <span className={styles.bar}>
              <span style={{ transform: `scaleX(${Math.max(0.02, job.progress)})` }} />
            </span>
          )}
        </span>
      </div>
    </SwipeRow>
  );
}

function Setup() {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    const problem = await connectPipeline(key.trim());
    setBusy(false);
    if (problem) setError(problem);
  };

  return (
    <form className={styles.setup} onSubmit={submit}>
      <p className={styles.setupTitle}>Connect the download server</p>
      <p className={styles.setupText}>
        Albums are fetched by the download service on tim-box. Enter the key from its
        <code> _pipeline/orchestrator/api_key.txt</code> file once; it’s kept on this phone.
      </p>
      <input
        className={styles.keyInput}
        type="password"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="Key"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" className={styles.connect} disabled={!key.trim() || busy}>
        {busy ? 'Connecting…' : 'Connect'}
      </button>
    </form>
  );
}
