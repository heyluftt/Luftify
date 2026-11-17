export function playlistHeroCover(
  detailsCover: string | undefined,
  summaryCover: string | undefined,
  firstTrackCover?: string | undefined,
): string | undefined {
  return (
    httpsCover(detailsCover) ??
    httpsCover(summaryCover) ??
    httpsCover(firstTrackCover)
  );
}

export function playlistHeroOwner(
  detailsOwner: string | undefined,
  summarySubtitle: string | undefined,
): string | undefined {
  return visibleOwnerName(detailsOwner) ?? visibleOwnerName(summarySubtitle);
}

export function playlistHeroSubtitle(
  ownerName: string | undefined,
  trackCountLabel: string,
): string {
  return [ownerName, trackCountLabel].filter(Boolean).join(" · ");
}

function httpsCover(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed?.startsWith("https://") ? trimmed : undefined;
}

function visibleOwnerName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "Playlist") return undefined;
  if (isInternalUserId(trimmed)) return undefined;
  return trimmed;
}

function isInternalUserId(value: string): boolean {
  return /^[a-z0-9]{20,32}$/.test(value);
}
