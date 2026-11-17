export type SpotifyLinkKind = "track" | "album" | "artist" | "playlist";
export type SpotifyLink = { kind: SpotifyLinkKind; uri: string };

// open.spotify.com/track/…, with a language prefix (intl-de), the old user
// path for playlists or the embed player in front; tracking parameters after.
const WEB = /(?:https?:\/\/)?(?:open|play)\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?(?:user\/[^/?#\s]+\/)?(track|album|artist|playlist)\/([A-Za-z0-9]{22})(?![A-Za-z0-9])/i;
const URI = /spotify:(?:user:[^:\s]+:)?(track|album|artist|playlist):([A-Za-z0-9]{22})(?![A-Za-z0-9])/;

/** The first Spotify link in a pasted text, as a `spotify:` URI. */
export function parseSpotifyLink(text: string): SpotifyLink | undefined {
  const value = text.trim();
  if (!value || value.length > 2_000) return undefined;
  const match = WEB.exec(value) ?? URI.exec(value);
  if (!match) return undefined;
  const kind = match[1]!.toLowerCase() as SpotifyLinkKind;
  return { kind, uri: `spotify:${kind}:${match[2]}` };
}
