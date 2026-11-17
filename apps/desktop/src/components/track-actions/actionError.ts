import { t } from "../../i18n";

export function trackActionErrorMessage(error: unknown): string {
  const direct = messageFromRecord(error);
  if (direct) {
    return direct;
  }

  if (typeof error === "string") {
    try {
      return messageFromRecord(JSON.parse(error)) ?? t("trackActions.error");
    } catch {
      return t("trackActions.error");
    }
  }

  return t("trackActions.error");
}

function messageFromRecord(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const message = Reflect.get(value, "message");
  if (typeof message !== "string") {
    return undefined;
  }

  const normalized = message.trim();
  return normalized.length > 0 && normalized.length <= 240
    ? normalized
    : undefined;
}
