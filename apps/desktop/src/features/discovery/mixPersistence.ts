import { desktopApi } from "../../services/desktopApi";
import type { SavedMix } from "./mixLibrary";

interface Document { version: 1; mixes: SavedMix[]; importedOrigins: string[]; legacyBackups: Record<string, SavedMix[]> }
let expected: string | null = null;
let document: Document | undefined;
let writes = Promise.resolve();
let failed = false;

export async function loadMixes(legacy: SavedMix[], parse: (data: unknown) => SavedMix[], retain: (mixes: SavedMix[]) => SavedMix[]) {
  const raw = await desktopApi.getMixLibrary();
  let loaded: Document = { version: 1, mixes: [], importedOrigins: [], legacyBackups: {} };
  if (raw !== null) {
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.importedOrigins) || !data.importedOrigins.every((item: unknown) => typeof item === "string")) {
      throw new Error("Invalid mix document");
    }
    loaded = { ...data, mixes: parse(data.mixes), legacyBackups: data.legacyBackups ?? {} };
  }
  const origin = window.location.origin;
  if (!loaded.importedOrigins.includes(origin)) {
    const merged = new Map(loaded.mixes.map((mix) => [mix.id, mix]));
    for (const mix of legacy) if (!merged.has(mix.id)) merged.set(mix.id, mix);
    loaded = { ...loaded,
      mixes: retain([...merged.values()].sort((a, b) => b.createdAt - a.createdAt)),
      importedOrigins: [...loaded.importedOrigins, origin],
      // Preserve the full legacy collection even if the visible five slots fill.
      legacyBackups: { ...loaded.legacyBackups, [origin]: legacy },
    };
    const value = JSON.stringify(loaded);
    if (!await desktopApi.saveMixLibrary(value, raw)) throw new Error("Mix library changed in another instance");
    expected = value;
  } else expected = raw;
  document = loaded;
  failed = false;
  return loaded.mixes;
}

export function persistMixes(mixes: SavedMix[]): Promise<void> {
  const snapshot = JSON.parse(JSON.stringify(mixes)) as SavedMix[];
  const write = writes.then(async () => {
    if (!document || failed) throw new Error("Mix storage not ready");
    const next = { ...document, mixes: snapshot };
    const value = JSON.stringify(next);
    if (!await desktopApi.saveMixLibrary(value, expected)) throw new Error("Mix library changed in another instance");
    expected = value;
    document = next;
  });
  writes = write.catch(() => { failed = true; });
  return write;
}
