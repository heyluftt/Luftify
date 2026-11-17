import { expect, it, vi } from "vitest";
import { desktopApi } from "../src/services/desktopApi";
import type { SavedMix } from "../src/features/discovery/mixLibrary";
vi.mock("../src/services/desktopApi", () => ({ desktopApi: { getMixLibrary: vi.fn(), saveMixLibrary: vi.fn() } }));

it("imports once, preserves existing names and backups, and serializes saves", async () => {
  const { loadMixes, persistMixes } = await import("../src/features/discovery/mixPersistence");
  const old = { id: "one", name: "Old" } as SavedMix;
  const current = { ...old, name: "Saved" };
  const initial = JSON.stringify({ version: 1, mixes: [current], importedOrigins: [], legacyBackups: {} });
  vi.mocked(desktopApi.getMixLibrary).mockResolvedValue(initial);
  vi.mocked(desktopApi.saveMixLibrary).mockResolvedValue(true);
  const parse = (value: unknown) => value as SavedMix[];
  expect(await loadMixes([old], parse, (mixes) => mixes)).toEqual([current]);
  const migrated = vi.mocked(desktopApi.saveMixLibrary).mock.calls[0]![0];
  expect(JSON.parse(migrated).legacyBackups[window.location.origin]).toEqual([old]);
  await Promise.all([persistMixes([{ ...current, name: "Renamed" }]), persistMixes([])]);
  const calls = vi.mocked(desktopApi.saveMixLibrary).mock.calls;
  expect(calls[1]![1]).toBe(migrated);
  expect(calls[2]![1]).toBe(calls[1]![0]);
  vi.mocked(desktopApi.getMixLibrary).mockResolvedValue(calls[2]![0]);
  expect(await loadMixes([old], parse, (mixes) => mixes)).toEqual([]);
  expect(desktopApi.saveMixLibrary).toHaveBeenCalledTimes(3);
  vi.mocked(desktopApi.saveMixLibrary).mockResolvedValue(false);
  await expect(persistMixes([old])).rejects.toThrow("another instance");
});
