import { appLanguage } from "./locale";
import { de, en, type MessageKey } from "./messages";

export type { AppLanguage } from "./locale";
export type { MessageKey } from "./messages";
export { appLanguage } from "./locale";

const catalogs = { de, en } as const;

export function t(key: MessageKey, values?: Record<string, string | number>): string {
  const raw = catalogs[appLanguage()][key] ?? de[key];
  if (!values) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
}
