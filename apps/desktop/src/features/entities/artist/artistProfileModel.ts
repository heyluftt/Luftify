import { t } from "../../../i18n";
import type {
  ArtistDiscographyCategoryStatus,
  ArtistDetails,
  ArtistRelease,
  ArtistReleaseType,
  EntitySummary,
  MediaItem,
} from "@luft/protocol-types";

export const ARTIST_PROFILE_QUERY_VERSION = 7;

export interface ArtistProfileStat {
  label: string;
  value: number;
}

export type ArtistProfilePartialKind =
  | "partial-releases"
  | "partial-tracks";

export interface ArtistDiscographyIssue {
  category: "albums" | "singles" | "compilations";
  label: string;
  status: Exclude<ArtistDiscographyCategoryStatus, "loaded">;
}

type UnknownRecord = Record<string, unknown>;

/**
 * Keep the view tolerant of older bridge bundles and partially returned
 * artist payloads. The protocol shape remains the canonical output; the
 * additional aliases only prevent already available releases from being
 * dropped by the UI while an older bridge is still connected.
 */
export function normalizeArtistDetails(
  value: unknown,
  fallbackUri: string,
): ArtistDetails {
  const source = unwrapArtist(value);
  const uri = stringValue(source.uri) || fallbackUri;
  const name =
    stringValue(source.name) ||
    stringValue(recordValue(source.profile).name) ||
    t("artist.fallbackName");
  const imageUri = firstString(
    source.imageUri,
    source.image_url,
    source.imageUrl,
    source.coverUri,
  );
  const popularTracks = mediaItems(
    source.popularTracks ??
      source.topTracks ??
      nestedValue(source, "discography", "topTracks", "items"),
  );
  const albums = releaseItems(
    source.albums ?? nestedValue(source, "discography", "albums", "items"),
    "album",
  );
  const singles = releaseItems(
    source.singles ?? nestedValue(source, "discography", "singles", "items"),
    "single",
  );
  const compilations = releaseItems(
    source.compilations ??
      nestedValue(source, "discography", "compilations", "items"),
    "compilation",
  );
  const discographyStatus = normalizeDiscographyStatus(
    source.discographyStatus ??
      source.discography_status ??
      nestedValue(source, "discography", "status"),
  );

  // Some compatibility adapters return one combined release list. Preserve
  // it and split by the provided release type rather than hiding it.
  if (
    albums.length === 0 &&
    singles.length === 0 &&
    compilations.length === 0
  ) {
    for (const release of releaseItems(source.releases, "unknown")) {
      if (release.releaseType === "compilation") {
        compilations.push(release);
      } else if (
        release.releaseType === "single" ||
        release.releaseType === "ep"
      ) {
        singles.push(release);
      } else {
        albums.push(release);
      }
    }
  }

  return {
    uri,
    name,
    ...(imageUri ? { imageUri } : {}),
    popularTracks,
    albums: sortReleasesNewestFirst(uniqueReleases(albums)),
    singles: sortReleasesNewestFirst(uniqueReleases(singles)),
    compilations: sortReleasesNewestFirst(uniqueReleases(compilations)),
    ...(discographyStatus ? { discographyStatus } : {}),
  };
}

export function uniqueReleases(
  releases: ArtistRelease[],
): ArtistRelease[] {
  const seen = new Set<string>();

  return releases.filter((release) => {
    const key = release.uri.trim().toLocaleLowerCase();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function sortReleasesNewestFirst(
  releases: ArtistRelease[],
): ArtistRelease[] {
  return releases
    .map((release, index) => ({ release, index }))
    .sort((left, right) => {
      const byDate = compareReleaseRecency(right.release, left.release);
      return byDate !== 0 ? byDate : left.index - right.index;
    })
    .map(({ release }) => release);
}

function compareReleaseRecency(
  left: ArtistRelease,
  right: ArtistRelease,
): number {
  const leftKey = releaseRecencyKey(left);
  const rightKey = releaseRecencyKey(right);
  if (leftKey[0] !== rightKey[0]) return leftKey[0] - rightKey[0];
  if (leftKey[1] !== rightKey[1]) return leftKey[1] - rightKey[1];
  return leftKey[2] - rightKey[2];
}

function releaseRecencyKey(
  release: ArtistRelease,
): [number, number, number] {
  if (release.releaseDate) {
    const [year, month, day] = release.releaseDate.split("-");
    return [
      Number.parseInt(year ?? "", 10) || 0,
      Number.parseInt(month ?? "", 10) || 0,
      Number.parseInt(day ?? "", 10) || 0,
    ];
  }
  return [release.year ?? 0, 0, 0];
}

export function artistProfileStats(
  details: ArtistDetails,
): ArtistProfileStat[] {
  return [
    { label: t("artist.shownTracks"), value: details.popularTracks.length },
    { label: t("artist.albums"), value: uniqueReleases(details.albums).length },
    { label: t("artist.singles"), value: uniqueReleases(details.singles).length },
    {
      label: t("artist.compilations"),
      value: uniqueReleases(details.compilations).length,
    },
  ].filter((stat) => stat.value > 0);
}

export function artistDiscographyIssues(
  details: ArtistDetails,
): ArtistDiscographyIssue[] {
  const status = details.discographyStatus;
  if (!status) return [];

  const categories = [
    ["albums", t("artist.albums"), status.albums],
    ["singles", t("artist.singles"), status.singles],
    ["compilations", t("artist.compilations"), status.compilations],
  ] as const;

  return categories.flatMap(([category, label, categoryStatus]) =>
    categoryStatus === "loaded"
      ? []
      : [{ category, label, status: categoryStatus }],
  );
}

export function artistProfilePartialKind(
  details: ArtistDetails,
): ArtistProfilePartialKind | undefined {
  const hasTracks = details.popularTracks.length > 0;
  const hasReleases =
    details.albums.length +
      details.singles.length +
      details.compilations.length >
    0;

  // A category-aware status can distinguish a genuinely empty discography
  // from a failed request. Older bridge bundles have no status, so retain the
  // conservative legacy warning for those payloads.
  if (hasTracks && !hasReleases && !details.discographyStatus) {
    return "partial-releases";
  }
  if (!hasTracks && hasReleases) return "partial-tracks";
  return undefined;
}

export function hasArtistContent(details: ArtistDetails): boolean {
  return (
    details.popularTracks.length > 0 ||
    details.albums.length > 0 ||
    details.singles.length > 0 ||
    details.compilations.length > 0
  );
}

function unwrapArtist(value: unknown): UnknownRecord {
  const source = recordValue(value);
  const data = recordValue(source.data);
  return recordValue(
    source.artist ?? data.artist ?? data.artistUnion ?? source,
  );
}

function releaseItems(
  value: unknown,
  fallbackType: ArtistReleaseType,
): ArtistRelease[] {
  const output: ArtistRelease[] = [];

  for (const item of flattenedItems(value)) {
    const source = recordValue(item);
    const uri = stringValue(source.uri);
    const name = stringValue(source.name);
    if (!uri || !name) continue;

    const rawReleaseType = firstString(
      source.releaseType,
      source.release_type,
      source.album_group,
      source.album_type,
      source.type,
    );
    const releaseType = normalizeReleaseType(rawReleaseType, fallbackType);
    const subtitle = firstString(
      source.subtitle,
      releaseTypeLabel(releaseType),
    );
    const coverUri = firstString(
      source.coverUri,
      source.imageUri,
      source.image_url,
      source.imageUrl,
    );
    const releaseDate = firstString(
      source.releaseDate,
      source.release_date,
      source.date,
      nestedValue(source, "releaseDate", "isoString"),
    );
    const year =
      integerValue(source.year) ??
      integerValue(source.releaseYear) ??
      yearFromDate(releaseDate);
    const artists = entityItems(
      source.artists ?? source.artist ?? source.creators,
    );

    output.push({
      uri,
      name,
      ...(subtitle ? { subtitle } : {}),
      ...(coverUri ? { coverUri } : {}),
      ...(releaseDate ? { releaseDate } : {}),
      ...(year !== undefined ? { year } : {}),
      releaseType,
      ...(artists.length > 0 ? { artists } : {}),
    });
  }

  return output;
}

function entityItems(value: unknown): EntitySummary[] {
  const output: EntitySummary[] = [];

  for (const item of flattenedItems(value)) {
    const source = recordValue(item);
    const uri = stringValue(source.uri);
    const name =
      stringValue(source.name) ||
      stringValue(recordValue(source.profile).name);
    if (!name) continue;

    const subtitle = stringValue(source.subtitle);
    const coverUri = firstString(
      source.coverUri,
      source.imageUri,
      source.image_url,
      source.imageUrl,
    );

    output.push({
      uri,
      name,
      ...(subtitle ? { subtitle } : {}),
      ...(coverUri ? { coverUri } : {}),
    });
  }

  return output;
}

function flattenedItems(value: unknown, depth = 0): unknown[] {
  if (depth > 5) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenedItems(item, depth + 1));
  }

  const source = recordValue(value);
  if (stringValue(source.uri) && stringValue(source.name)) return [source];

  for (const key of ["items", "releases", "album", "data"] as const) {
    if (source[key] !== undefined) {
      const items = flattenedItems(source[key], depth + 1);
      if (items.length > 0) return items;
    }
  }
  return [];
}

function mediaItems(value: unknown): MediaItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MediaItem => {
    const source = recordValue(item);
    return Boolean(stringValue(source.uri) && stringValue(source.title));
  });
}

function normalizeReleaseType(
  value: string,
  fallback: ArtistReleaseType,
): ArtistReleaseType {
  const type = value.toLocaleLowerCase().replaceAll("-", "_");
  if (type.includes("compilation")) return "compilation";
  if (type === "ep" || type.includes("extended_play")) return "ep";
  if (type.includes("single")) return "single";
  if (type.includes("album")) return "album";
  return fallback;
}

function releaseTypeLabel(type: ArtistReleaseType): string {
  switch (type) {
    case "album":
      return t("artist.type.album");
    case "single":
      return t("artist.type.single");
    case "ep":
      return t("artist.type.ep");
    case "compilation":
      return t("artist.type.compilation");
    default:
      return t("artist.type.release");
  }
}

function normalizeDiscographyStatus(
  value: unknown,
): ArtistDetails["discographyStatus"] {
  const source = recordValue(value);
  const albums = categoryStatus(source.albums);
  const singles = categoryStatus(source.singles);
  const compilations = categoryStatus(source.compilations);

  if (!albums && !singles && !compilations) return undefined;

  return {
    albums: albums ?? "unavailable",
    singles: singles ?? "unavailable",
    compilations: compilations ?? "unavailable",
  };
}

function categoryStatus(
  value: unknown,
): ArtistDiscographyCategoryStatus | undefined {
  const status = stringValue(value).toLocaleLowerCase();
  if (["loaded", "success", "available"].includes(status)) return "loaded";
  if (["failed", "error"].includes(status)) return "failed";
  if (["unavailable", "unsupported"].includes(status)) return "unavailable";
  return undefined;
}

function recordValue(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function integerValue(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : Number.parseInt(stringValue(value), 10);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function yearFromDate(value: string): number | undefined {
  const match = /^(\d{4})/.exec(value);
  const year = match?.[1];
  return year ? Number.parseInt(year, 10) : undefined;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const result = stringValue(value);
    if (result) return result;
  }
  return "";
}

function nestedValue(source: UnknownRecord, ...path: string[]): unknown {
  let current: unknown = source;
  for (const part of path) current = recordValue(current)[part];
  return current;
}
