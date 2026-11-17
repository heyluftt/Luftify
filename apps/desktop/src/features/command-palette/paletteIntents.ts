import type { PlaybackState } from "@luft/protocol-types";
import { t } from "../../i18n";
import { formatTime } from "../playback/formatTime";
import { matchKey } from "../textMatch";
import type { PaletteItem } from "./paletteTypes";

const VOLUME = /^(?:vol(?:ume)?|lautstarke|laut|lautstaerke)?\s*(\d{1,3})\s*%?$/;
const PERCENT = /^(\d{1,3})\s*%$/;
const SEEK = /^(?:(?:gehe zu|springe(?: zu)?|spring|seek|go to|jump(?: to)?)\s*)?(\d{1,2}):([0-5]\d)$/;
const RELATIVE = /^([+-])\s*(\d{1,3})\s*s?$/;

/**
 * Typed values that are an action on their own: "laut 40" or "40%" sets the
 * volume, "1:30" jumps there, "+30" / "-10" seeks by seconds.
 */
export function paletteIntents(query: string, playback: PlaybackState | undefined, connected: boolean): PaletteItem[] {
  const text = matchKey(query);
  if (!text) return [];
  const intents: PaletteItem[] = [];

  const volume = text.match(PERCENT) ?? (/^[a-z]/.test(text) ? text.match(VOLUME) : null);
  if (volume) {
    const percent = Math.min(100, Number(volume[1]));
    intents.push({
      id: "intent:volume",
      group: "intent",
      label: t("command.intent.volume", { percent }),
      keywords: [],
      icon: "volume",
      disabled: !connected,
      action: { kind: "volume", percent },
    });
  }

  const duration = playback?.durationMs ?? playback?.currentItem?.durationMs ?? 0;
  const canSeek = connected && Boolean(playback?.currentItem) && duration > 0;
  const seek = text.match(SEEK);
  if (seek && canSeek) {
    const ms = Math.min(duration - 1_000, (Number(seek[1]) * 60 + Number(seek[2])) * 1_000);
    intents.push({
      id: "intent:seek",
      group: "intent",
      label: t("command.intent.seek", { time: formatTime(Math.max(0, ms)) }),
      ...(playback?.currentItem ? { subtitle: playback.currentItem.title } : {}),
      keywords: [],
      icon: "seek",
      action: { kind: "seek", ms: Math.max(0, ms) },
    });
  }

  const relative = text.match(RELATIVE);
  if (relative && canSeek) {
    const seconds = Number(relative[2]) * (relative[1] === "-" ? -1 : 1);
    const target = Math.min(duration - 1_000, Math.max(0, (playback?.positionMs ?? 0) + seconds * 1_000));
    intents.push({
      id: "intent:seek-relative",
      group: "intent",
      label: seconds < 0
        ? t("command.intent.back", { seconds: -seconds })
        : t("command.intent.forward", { seconds }),
      subtitle: formatTime(target),
      keywords: [],
      icon: "seek",
      action: { kind: "seek", ms: target },
    });
  }
  return intents;
}
