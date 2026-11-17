import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { persistQueries, restorePersistedQueries } from "../src/queryPersistence";

const KEY = "luftify.query-cache.v1";

describe("query persistence", () => {
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("restores only the Home sections and only while recent", () => {
    const now = Date.now();
    localStorage.setItem(KEY, JSON.stringify([
      { key: ["home", "new-releases", "librespot"], data: { items: [1] }, updatedAt: now - 60_000 },
      { key: ["home", "release-radar-releases", "old"], data: [2], updatedAt: now - 8 * 24 * 60 * 60_000 },
      { key: ["settings"], data: { theme: "x" }, updatedAt: now },
    ]));
    const client = new QueryClient();
    restorePersistedQueries(client);

    expect(client.getQueryData(["home", "new-releases", "librespot"])).toEqual({ items: [1] });
    expect(client.getQueryState(["home", "new-releases", "librespot"])?.dataUpdatedAt).toBe(now - 60_000);
    expect(client.getQueryData(["home", "release-radar-releases", "old"])).toBeUndefined();
    expect(client.getQueryData(["settings"])).toBeUndefined();
  });

  it("saves the Home sections shortly after new data, nothing else", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const stop = persistQueries(client);
    await client.fetchQuery({ queryKey: ["home", "new-releases", "librespot"], queryFn: () => ({ items: [3] }) });
    await client.fetchQuery({ queryKey: ["settings"], queryFn: () => ({ theme: "y" }) });
    vi.advanceTimersByTime(2_000);
    stop();

    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Array<{ key: unknown[] }>;
    expect(saved.map((entry) => entry.key)).toEqual([["home", "new-releases", "librespot"]]);
  });

  it("ignores broken storage", () => {
    localStorage.setItem(KEY, "{not json");
    expect(() => restorePersistedQueries(new QueryClient())).not.toThrow();
  });
});
