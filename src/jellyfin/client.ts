import { authorizationHeader } from './identity';

export class JellyfinError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly network = false,
  ) {
    super(message);
    this.name = 'JellyfinError';
  }

  get unauthorized(): boolean {
    return this.status === 401;
  }
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** Defaults to 30s: an old, busy server can take a while on big queries. */
  timeoutMs?: number;
  /** Let the request finish even if the page is closing (playback reports). */
  keepalive?: boolean;
}

/** Thin HTTP layer over one Jellyfin server. */
export class JellyfinClient {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    readonly token?: string,
  ) {
    this.baseUrl = normalizeServerUrl(baseUrl);
  }

  url(path: string, query?: Query): string {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    return url.toString();
  }

  get<T>(path: string, options?: RequestOptions) {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, options?: RequestOptions) {
    return this.request<T>('POST', path, options);
  }

  delete<T>(path: string, options?: RequestOptions) {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const signal = withTimeout(options.signal, options.timeoutMs ?? 30_000);
    const headers: Record<string, string> = { Authorization: authorizationHeader(this.token) };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetch(this.url(path, options.query), {
        method,
        headers,
        body,
        signal,
        keepalive: options.keepalive,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new JellyfinError('Can’t reach the server', undefined, true);
    }

    if (!response.ok) {
      throw new JellyfinError(await serverMessage(response), response.status);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/** The caller's signal plus a timeout (AbortSignal.any is too new for older iPhones). */
function withTimeout(outer: AbortSignal | undefined, ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
  const stop = () => clearTimeout(timer);
  controller.signal.addEventListener('abort', stop, { once: true });
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
  }
  return controller.signal;
}

async function serverMessage(response: Response): Promise<string> {
  if (response.status === 401) return 'Signed out by the server';
  try {
    const text = await response.text();
    if (text && text.length < 200 && !text.trimStart().startsWith('<')) return text;
  } catch {
    // fall through
  }
  return `The server answered ${response.status}`;
}

/** A bare address gets the page's own scheme; trailing slashes are dropped. */
export function normalizeServerUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return url;
  if (!url.includes('://')) url = `${window.location.protocol}//${url}`;
  return url.replace(/\/+$/, '');
}
