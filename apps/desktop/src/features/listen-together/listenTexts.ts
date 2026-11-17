import { t, type MessageKey } from "../../i18n";

/**
 * The service and relay report errors as `listen.*` keys; anything else
 * (a player message) is shown as it came.
 */
export function listenErrorText(error: string | null | undefined): string | undefined {
  if (!error) return undefined;
  if (error.startsWith("listen.")) {
    const text = t(error as MessageKey) as string | undefined;
    if (text) return text;
    return t("listen.error.generic");
  }
  return error;
}

/** `wss://luft.example.app/ws` → `luft.example.app`. */
export function serverHost(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
