import { create } from 'zustand';

/** Preferences kept on this phone. */

export type DownloadQuality = 'original' | 'smaller';

interface Settings {
  downloadQuality: DownloadQuality;
}

const KEY = 'jj.settings';

function load(): Settings {
  try {
    return { downloadQuality: 'original', ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { downloadQuality: 'original' };
  }
}

export const useSettings = create<Settings>(load);

export function updateSettings(change: Partial<Settings>) {
  useSettings.setState(change);
  localStorage.setItem(KEY, JSON.stringify(useSettings.getState()));
}
