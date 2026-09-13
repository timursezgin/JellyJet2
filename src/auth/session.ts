import { create } from 'zustand';

import { JellyfinClient, JellyfinError, normalizeServerUrl } from '@/jellyfin/client';
import type { AuthenticationResult, UserDto } from '@/jellyfin/types';
import { fetchPublicInfo } from '@/lib/server';

export interface Permissions {
  isAdmin: boolean;
  /** Jellyfin's per-user "Allow media downloading". */
  canDownload: boolean;
  /** Admins who also have media deletion allowed. */
  canDeleteFromLibrary: boolean;
}

export interface Session {
  serverUrl: string;
  serverName: string;
  token: string;
  userId: string;
  userName: string;
  permissions: Permissions;
}

type Status = 'restoring' | 'signedOut' | 'signedIn';

interface SessionState {
  status: Status;
  session: Session | null;
  /** A client bound to the signed-in session. Null when signed out. */
  client: JellyfinClient | null;
  restore(): Promise<void>;
  signIn(serverUrl: string, username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const STORAGE_KEY = 'jj.session';

function permissionsOf(user: UserDto): Permissions {
  const policy = user.Policy;
  const isAdmin = policy?.IsAdministrator === true;
  const deletion =
    policy?.EnableContentDeletion === true ||
    (policy?.EnableContentDeletionFromFolders?.length ?? 0) > 0;
  return {
    isAdmin,
    canDownload: policy?.EnableContentDownloading === true,
    canDeleteFromLibrary: isAdmin && deletion,
  };
}

function load(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function save(session: Session | null) {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

function signedIn(session: Session) {
  save(session);
  return {
    status: 'signedIn' as const,
    session,
    client: new JellyfinClient(session.serverUrl, session.token),
  };
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'restoring',
  session: null,
  client: null,

  async restore() {
    // Layout testing without an account: `VITE_LAYOUT_TEST=1 npm run dev` opens
    // the app with a pretend session pointed at nothing (development only).
    if (import.meta.env.DEV && import.meta.env.VITE_LAYOUT_TEST && !load()) {
      save({
        serverUrl: 'http://127.0.0.1:9',
        serverName: 'Layout test',
        token: 'layout-test',
        userId: 'layout-test',
        userName: 'layout-test',
        permissions: { isAdmin: true, canDownload: true, canDeleteFromLibrary: true },
      });
    }
    const saved = load();
    if (!saved) {
      set({ status: 'signedOut', session: null, client: null });
      return;
    }
    // Open straight into the app with what we know - it must work offline.
    set(signedIn(saved));
    try {
      const me = await new JellyfinClient(saved.serverUrl, saved.token).get<UserDto>('/Users/Me');
      if (get().session?.token !== saved.token) return;
      set(
        signedIn({
          ...saved,
          userName: me.Name || saved.userName,
          permissions: permissionsOf(me),
        }),
      );
    } catch (error) {
      // Only a rejected token signs out; an unreachable server keeps the session.
      if (error instanceof JellyfinError && error.unauthorized) {
        save(null);
        set({ status: 'signedOut', session: null, client: null });
      }
    }
  },

  async signIn(serverUrl, username, password) {
    const url = normalizeServerUrl(serverUrl);
    const anonymous = new JellyfinClient(url);
    const info = await fetchPublicInfo(url).catch(() => {
      throw new JellyfinError('Can’t reach the server', undefined, true);
    });
    let result: AuthenticationResult;
    try {
      result = await anonymous.post<AuthenticationResult>('/Users/AuthenticateByName', {
        body: { Username: username, Pw: password },
      });
    } catch (error) {
      if (error instanceof JellyfinError && error.unauthorized) {
        throw new JellyfinError('Wrong username or password', 401);
      }
      throw error;
    }
    set(
      signedIn({
        serverUrl: url,
        serverName: info.ServerName,
        token: result.AccessToken,
        userId: result.User.Id,
        userName: result.User.Name,
        permissions: permissionsOf(result.User),
      }),
    );
  },

  async signOut() {
    const client = get().client;
    save(null);
    set({ status: 'signedOut', session: null, client: null });
    // Tell the server so the token stops working; ignore failures (offline).
    await client?.post('/Sessions/Logout', { timeoutMs: 5000 }).catch(() => {});
  },
}));

/** The signed-in client. Only call from screens inside the signed-in app. */
export function useClient(): JellyfinClient {
  const client = useSession((s) => s.client);
  if (!client) throw new Error('useClient() outside a signed-in session');
  return client;
}
