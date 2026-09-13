/**
 * Where Jellyfin lives, as seen from the app.
 *
 * Published on jj, Caddy passes everything that isn't an app file straight to
 * Jellyfin, so the server is the page's own address. During development on the
 * Mac, Vite forwards /jellyfin to tim-box instead (see vite.config.ts).
 */
export const defaultServerUrl = import.meta.env.DEV
  ? `${window.location.origin}/jellyfin`
  : window.location.origin;

/** The download orchestrator on tim-box, reached through the same address. */
export const pipelineUrl = `${window.location.origin}/pipeline`;

export interface PublicServerInfo {
  ServerName: string;
  Version: string;
  Id: string;
}

/** Jellyfin's unauthenticated "who are you" endpoint. */
export async function fetchPublicInfo(
  serverUrl: string,
  signal?: AbortSignal,
): Promise<PublicServerInfo> {
  const response = await fetch(`${serverUrl}/System/Info/Public`, { signal });
  if (!response.ok) throw new Error(`Server answered ${response.status}`);
  return response.json();
}
