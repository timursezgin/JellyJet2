import { Component, type ErrorInfo, type ReactNode } from 'react';

import styles from './error-boundary.module.css';

interface State {
  error: Error | null;
}

/**
 * If anything in the app fails while drawing, show a way back instead of an
 * empty black screen. Playback lives outside React, so music keeps going.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('JellyJet crashed while drawing', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={styles.screen} role="alert">
        <h1 className="t-large-title">Something went wrong</h1>
        <p className="t-secondary">JellyJet hit an unexpected problem. Reloading usually fixes it.</p>
        <button type="button" className={styles.reload} onClick={() => window.location.reload()}>
          Reload
        </button>
        <p className={styles.detail}>{this.state.error.message}</p>
      </div>
    );
  }
}
