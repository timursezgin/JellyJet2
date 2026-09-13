import { useEffect } from 'react';
import { create } from 'zustand';

import styles from './toast.module.css';

interface ToastState {
  message: string | null;
  serial: number;
}

const useToastStore = create<ToastState>(() => ({ message: null, serial: 0 }));

/** A short, non-interactive message near the bottom of the screen. */
export function toast(message: string) {
  useToastStore.setState((s) => ({ message, serial: s.serial + 1 }));
}

export function ToastHost() {
  const { message, serial } = useToastStore();

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => useToastStore.setState({ message: null }), 1800);
    return () => clearTimeout(timer);
  }, [message, serial]);

  return (
    <div className={styles.host} aria-live="polite">
      {message && (
        <div key={serial} className={styles.toast}>
          {message}
        </div>
      )}
    </div>
  );
}
