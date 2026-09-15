import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

import styles from './confirm.module.css';

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  /** Null for a single-button notice. */
  cancelLabel?: string | null;
  destructive?: boolean;
  resolve(ok: boolean): void;
}

const useConfirm = create<{ request: ConfirmRequest | null }>(() => ({ request: null }));

/** Ask a yes/no question in a centred alert. Resolves true when confirmed. */
export function confirm(options: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().request?.resolve(false);
    useConfirm.setState({ request: { ...options, resolve } });
  });
}

function answer(ok: boolean) {
  const request = useConfirm.getState().request;
  if (!request) return;
  useConfirm.setState({ request: null });
  request.resolve(ok);
}

export function ConfirmHost() {
  const request = useConfirm((s) => s.request);

  // Escape cancels, before anything else hears it.
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      answer(false);
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [request]);

  if (!request) return null;
  return createPortal(
    <div className={styles.backdrop} onClick={() => answer(false)}>
      <div className={styles.alert} role="alertdialog" aria-label={request.title} onClick={(e) => e.stopPropagation()}>
        <div className={styles.text}>
          <h2>{request.title}</h2>
          <p>{request.message}</p>
        </div>
        <div className={styles.buttons} data-single={request.cancelLabel === null || undefined}>
          {request.cancelLabel !== null && (
            <button type="button" onClick={() => answer(false)}>
              {request.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button type="button" data-destructive={request.destructive || undefined} onClick={() => answer(true)}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
