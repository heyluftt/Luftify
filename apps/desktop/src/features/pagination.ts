export interface PageCursor {
  hasMore: boolean;
  limit: number;
  offset: number;
}

export function nextPageOffset(page: PageCursor): number | undefined {
  return page.hasMore ? page.offset + page.limit : undefined;
}

export function shouldPrefetchNextPage(page: PageCursor | undefined, maxOffset: number): boolean {
  if (!page?.hasMore) return false;
  const nextOffset = nextPageOffset(page);
  return nextOffset !== undefined && nextOffset > page.offset && nextOffset < maxOffset;
}
