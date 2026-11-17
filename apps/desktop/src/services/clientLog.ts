import { invoke } from "@tauri-apps/api/core";

/**
 * Unexpected errors that happen only in the page (codecs, recorder, canvas)
 * go to the app log, so a problem report shows them. Never throws.
 */
export function logClientError(scope: string, error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  void invoke("client_log", { scope, message }).catch(() => undefined);
}
