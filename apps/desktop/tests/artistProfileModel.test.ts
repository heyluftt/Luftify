import type {
  ArtistDetails,
  ArtistRelease,
  ArtistReleaseType,
} from "@luft/protocol-types";
import { describe, expect, it } from "vitest";
import {
  artistDiscographyIssues,
  artistProfilePartialKind,
  artistProfileStats,
  hasArtistContent,
  normalizeArtistDetails,
  sortReleasesNewestFirst,
  uniqueReleases,
} from "../src/features/entities/artist/artistProfileModel";

const release = (
  uri: string,
  name: string,
  releaseType: ArtistReleaseType = "album",
): ArtistRelease => ({
  uri,
  name,
  releaseType,
});

const artist = (
  overrides: Partial<ArtistDetails> = {},
): ArtistDetails => ({
  uri: "spotify:artist:test",
  name: "Test Artist",
  popularTracks: [],
  albums: [],
  singles: [],
  compilations: [],
  ...overrides,
});

describe("artist profile model", () => {
  it("orders singles with a newer full date before older same-year releases", () => {
    const ordered = sortReleasesNewestFirst([
      {
        uri: "spotify:album:dinner",
        name: "dinner party fun",
        releaseType: "single",
        releaseDate: "2026-06-20",
        year: 2026,
      },
      {
        uri: "spotify:album:pier",
        name: "santa monica pier pressure",
        releaseType: "single",
        releaseDate: "2026-08-14",
        year: 2026,
      },
    ]);

    expect(ordered.map((item) => item.name)).toEqual([
      "santa monica pier pressure",
      "dinner party fun",
    ]);
  });

  it("deduplicates releases by their stable URI", () => {
    const releases = [
      release("spotify:album:one", "One"),
      release("spotify:album:one", "One duplicate"),
      release("spotify:album:two", "Two"),
    ];

    expect(uniqueReleases(releases).map((item) => item.name)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("exposes only truthful non-empty profile counts", () => {
    const details = artist({
      popularTracks: [
        {
          uri: "spotify:track:one",
          source: "spotify",
          itemType: "track",
          title: "One",
          creators: [{ name: "Test Artist" }],
          explicit: false,
          playable: true,
        },
      ],
      albums: [release("spotify:album:one", "One")],
      singles: [],
    });

    expect(artistProfileStats(details)).toEqual([
      { label: "beliebte Titel", value: 1 },
      { label: "Alben", value: 1 },
    ]);
  });

  it("normalizes nested compatibility release collections", () => {
    const details = normalizeArtistDetails(
      {
        uri: "spotify:artist:test",
        name: "Test Artist",
        popularTracks: [],
        albums: {
          items: [
            {
              releases: {
                items: [
                  {
                    uri: "spotify:album:one",
                    name: "One",
                    coverUri: "https://example.test/one.jpg",
                  },
                ],
              },
            },
          ],
        },
        singles: { items: [] },
      },
      "spotify:artist:fallback",
    );

    expect(details.albums).toEqual([
      {
        uri: "spotify:album:one",
        name: "One",
        subtitle: "Album",
        coverUri: "https://example.test/one.jpg",
        releaseType: "album",
      },
    ]);
  });

  it("splits a combined legacy release list without hiding it", () => {
    const details = normalizeArtistDetails(
      {
        name: "Test Artist",
        releases: [
          {
            uri: "spotify:album:album",
            name: "Album",
            album_group: "album",
          },
          {
            uri: "spotify:album:single",
            name: "Single",
            album_group: "single",
          },
          {
            uri: "spotify:album:compilation",
            name: "Compilation",
            album_group: "compilation",
          },
        ],
      },
      "spotify:artist:test",
    );

    expect(details.albums.map((item) => item.name)).toEqual(["Album"]);
    expect(details.singles.map((item) => item.name)).toEqual(["Single"]);
    expect(details.compilations.map((item) => item.name)).toEqual([
      "Compilation",
    ]);
  });

  it("keeps rich release metadata and category status", () => {
    const details = normalizeArtistDetails(
      {
        uri: "spotify:artist:test",
        name: "Test Artist",
        albums: [
          {
            uri: "spotify:album:one",
            name: "One",
            release_date: "2026-07-15",
            album_type: "album",
            artists: [
              {
                uri: "spotify:artist:test",
                name: "Test Artist",
              },
            ],
          },
        ],
        discography_status: {
          albums: "success",
          singles: "error",
          compilations: "unsupported",
        },
      },
      "spotify:artist:fallback",
    );

    expect(details.albums[0]).toMatchObject({
      releaseDate: "2026-07-15",
      year: 2026,
      releaseType: "album",
      artists: [
        {
          uri: "spotify:artist:test",
          name: "Test Artist",
        },
      ],
    });
    expect(details.discographyStatus).toEqual({
      albums: "loaded",
      singles: "failed",
      compilations: "unavailable",
    });
  });

  it("keeps old artist payloads compatible", () => {
    const details = normalizeArtistDetails(
      {
        uri: "spotify:artist:test",
        name: "Test Artist",
        albums: [],
        singles: [],
      },
      "spotify:artist:fallback",
    );

    expect(details.compilations).toEqual([]);
    expect(details.discographyStatus).toBeUndefined();
  });

  it("reports only failed or unavailable discography categories", () => {
    expect(
      artistDiscographyIssues(
        artist({
          discographyStatus: {
            albums: "loaded",
            singles: "failed",
            compilations: "unavailable",
          },
        }),
      ),
    ).toEqual([
      { category: "singles", label: "Singles & EPs", status: "failed" },
      {
        category: "compilations",
        label: "Kompilationen",
        status: "unavailable",
      },
    ]);
  });

  it("does not treat a confirmed empty discography as a partial response", () => {
    expect(
      artistProfilePartialKind(
        artist({
          popularTracks: [
            {
              uri: "spotify:track:one",
              source: "spotify",
              itemType: "track",
              title: "One",
              creators: [{ name: "Test Artist" }],
              explicit: false,
              playable: true,
            },
          ],
          discographyStatus: {
            albums: "loaded",
            singles: "loaded",
            compilations: "loaded",
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("marks track-only bridge responses as partial", () => {
    const details = artist({
      popularTracks: [
        {
          uri: "spotify:track:one",
          source: "spotify",
          itemType: "track",
          title: "One",
          creators: [{ name: "Test Artist" }],
          explicit: false,
          playable: true,
        },
      ],
    });

    expect(artistProfilePartialKind(details)).toBe("partial-releases");
    expect(artistProfilePartialKind(artist())).toBeUndefined();
  });

  it("distinguishes a real empty profile from one with releases", () => {
    expect(hasArtistContent(artist())).toBe(false);
    expect(
      hasArtistContent(
        artist({
          singles: [release("spotify:album:single", "Single", "single")],
        }),
      ),
    ).toBe(true);
  });

  it("counts compilations as artist content", () => {
    const details = artist({
      compilations: [
        release("spotify:album:compilation", "Collection", "compilation"),
      ],
    });

    expect(hasArtistContent(details)).toBe(true);
    expect(artistProfileStats(details)).toContainEqual({
      label: "Kompilationen",
      value: 1,
    });
  });
});
