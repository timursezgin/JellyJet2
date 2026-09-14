import { createPortal } from 'react-dom';
import { create } from 'zustand';

import styles from './confirm.module.css';

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
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

export function ConfirmHost() {
  const request = useConfirm((s) => s.request);
  if (!request) return null;
  const answer = (ok: boolean) => {
    useConfirm.setState({ request: null });
    request.resolve(ok);
  };
  return createPortal(
    <div className={styles.backdrop} onClick={() => answer(false)}>
      <div className={styles.alert} role="alertdialog" aria-label={request.title} onClick={(e) => e.stopPropagation()}>
        <div className={styles.text}>
          <h2>{request.title}</h2>
          <p>{request.message}</p>
        </div>
        <div className={styles.buttons}>
          <button type="button" onClick={() => answer(false)}>
            Cancel
          </button>
          <button type="button" data-destructive={request.destructive || undefined} onClick={() => answer(true)}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
