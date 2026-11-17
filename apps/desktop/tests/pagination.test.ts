import { describe, expect, it } from "vitest";
import { nextPageOffset, shouldPrefetchNextPage } from "../src/features/pagination";

describe("page cursors", () => {
  it("advances by the requested page window even when normalization removed items", () => {
    expect(nextPageOffset({ offset: 50, limit: 50, hasMore: true })).toBe(100);
  });

  it("stops when the provider marks the page complete", () => {
    expect(nextPageOffset({ offset: 50, limit: 50, hasMore: false })).toBeUndefined();
  });

  it("prefetches from the provider cursor instead of the visible item count", () => {
    expect(shouldPrefetchNextPage({ offset: 0, limit: 50, hasMore: true }, 150)).toBe(true);
  });

  it("stops prefetching at the configured cursor limit", () => {
    expect(shouldPrefetchNextPage({ offset: 0, limit: 150, hasMore: true }, 150)).toBe(false);
    expect(shouldPrefetchNextPage({ offset: 0, limit: 50, hasMore: false }, 150)).toBe(false);
  });
});
