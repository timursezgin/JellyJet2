import { create } from 'zustand';

import { useSession } from '@/auth/session';
import { isOnline, onReconnect } from '@/connectivity/connection';
import { reportCapabilities } from '@/jellyfin/api';
import { deviceId } from '@/jellyfin/identity';

/**
 * The live connection to Jellyfin (its /socket WebSocket) that lets other
 * devices on the account control this one, and lets this one hear about
 * theirs. Kept open while signed in; reconnects when it drops, when the
 * connection comes back and when the app returns to the front (iOS closes it
 * while the app is suspended).
 */

/** The commands this app carries out when another device sends them. */
const SUPPORTED_COMMANDS = ['SetRepeatMode', 'SetShuffleQueue', 'SetVolume', 'PlayState', 'Play'];

export interface SocketMessage {
  MessageType: string;
  Data?: unknown;
}

type Listener = (message: SocketMessage) => void;

export const useSocket = create<{ connected: boolean }>(() => ({ connected: false }));

let socket: WebSocket | null = null;
let stopped = true;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let keepAliveTimer: ReturnType<typeof setInterval> | undefined;
let retries = 0;
const listeners = new Set<Listener>();
const sessionsListeners = new Set<() => void>();

/** Hear every message from the server (commands, session updates). */
export function onSocketMessage(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Tell the server about this device again (after it's renamed): its sessions
 * pick up the new name, and other devices hear about it straight away.
 */
export function announceDevice() {
  const { client } = useSession.getState();
  if (client) void reportCapabilities(client, SUPPORTED_COMMANDS).catch(() => {});
}

function send(message: SocketMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

/**
 * Ask the server to push the account's sessions (what each device is playing)
 * while `listener` is subscribed; `Sessions` messages then arrive as they change.
 */
export function subscribeSessions(listener: () => void) {
  sessionsListeners.add(listener);
  if (sessionsListeners.size === 1) send({ MessageType: 'SessionsStart', Data: '0,1500' });
  return () => {
    sessionsListeners.delete(listener);
    if (sessionsListeners.size === 0) send({ MessageType: 'SessionsStop' });
  };
}

function socketUrl() {
  const { session } = useSession.getState();
  if (!session) return null;
  const base = new URL(session.serverUrl, window.location.href);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = `${base.pathname.replace(/\/$/, '')}/socket`;
  // A WebSocket can't send headers, so the key goes in the address. Jellyfin 12
  // only reads it as `ApiKey` (the old `api_key` is refused as "Token is required").
  base.search = new URLSearchParams({ ApiKey: session.token, deviceId: deviceId() }).toString();
  return base.toString();
}

function connect() {
  clearTimeout(retryTimer);
  if (stopped || !isOnline() || (socket && socket.readyState <= WebSocket.OPEN)) return;
  const url = socketUrl();
  if (!url) return;

  const ws = new WebSocket(url);
  socket = ws;

  ws.onopen = () => {
    retries = 0;
    useSocket.setState({ connected: true });
    const { client } = useSession.getState();
    if (client) void reportCapabilities(client, SUPPORTED_COMMANDS).catch(() => {});
    if (sessionsListeners.size > 0) send({ MessageType: 'SessionsStart', Data: '0,1500' });
  };

  ws.onmessage = (event) => {
    let message: SocketMessage;
    try {
      message = JSON.parse(String(event.data)) as SocketMessage;
    } catch {
      return;
    }
    if (message.MessageType === 'ForceKeepAlive') {
      // The server closes connections that stay quiet longer than this many seconds.
      const seconds = Number(message.Data) || 60;
      clearInterval(keepAliveTimer);
      keepAliveTimer = setInterval(() => send({ MessageType: 'KeepAlive' }), (seconds * 1000) / 2);
      send({ MessageType: 'KeepAlive' });
      return;
    }
    if (message.MessageType === 'KeepAlive') return;
    if (message.MessageType === 'Sessions') for (const listener of sessionsListeners) listener();
    for (const listener of listeners) listener(message);
  };

  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    clearInterval(keepAliveTimer);
    useSocket.setState({ connected: false });
    if (stopped) return;
    // Try again soon, then less often.
    const delay = [1000, 3000, 10_000, 30_000][Math.min(retries, 3)];
    retries += 1;
    retryTimer = setTimeout(connect, delay);
  };
}

/** While signed in: keep the connection open. Returns a stop function. */
export function startSocket() {
  stopped = false;
  retries = 0;
  connect();
  const offReconnect = onReconnect(connect);
  const onFront = () => {
    if (document.visibilityState === 'visible') connect();
  };
  document.addEventListener('visibilitychange', onFront);

  return () => {
    stopped = true;
    offReconnect();
    document.removeEventListener('visibilitychange', onFront);
    clearTimeout(retryTimer);
    clearInterval(keepAliveTimer);
    const ws = socket;
    socket = null;
    ws?.close();
    useSocket.setState({ connected: false });
  };
}
