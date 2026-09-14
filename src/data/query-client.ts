import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { createStore, del, get, set } from 'idb-keyval';

import { useConnection } from '@/connectivity/connection';
import { JellyfinError } from '@/jellyfin/client';

/** The one cache for everything read from Jellyfin. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Library data changes rarely; refresh in the background, never block.
      staleTime: 60_000,
      // Kept for a week so pages opened before stay browsable offline.
      gcTime: 7 * 24 * 60 * 60_000,
      retry: (failures, error) => !(error instanceof JellyfinError && error.network) && failures < 1,
      refetchOnWindowFocus: true,
    },
  },
});

// Queries wait (instead of failing) while Jellyfin is unreachable, and
// refresh as soon as it's back.
onlineManager.setEventListener((setOnline) => {
  setOnline(useConnection.getState().online);
  return useConnection.subscribe((s) => setOnline(s.online));
});

// Everything shown is saved on the phone, so the app opens with the last
// known library even with no connection.
const idb = createStore('jellyjet2-cache', 'queries');
export const queryPersister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get<string>(key, idb).then((v) => v ?? null),
    setItem: (key, value) => set(key, value, idb),
    removeItem: (key) => del(key, idb),
  },
  key: 'library',
  throttleTime: 2000,
});

export const persistOptions = {
  persister: queryPersister,
  maxAge: 7 * 24 * 60 * 60_000,
  buster: 'v1',
  dehydrateOptions: {
    // Searches are throwaway; everything else is worth keeping.
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[]; state: { status: string } }) =>
      query.state.status === 'success' && query.queryKey[0] !== 'search',
  },
};
