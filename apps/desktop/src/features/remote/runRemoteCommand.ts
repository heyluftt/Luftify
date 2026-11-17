import { desktopApi } from "../../services/desktopApi";
import { usePlayerStore } from "../../stores/playerStore";
import { playbackCommands } from "../playback/playbackCommands";
import type { RemoteCommand } from "./remoteTypes";

/** Like a click in the app: the same commands, so the player stays consistent. */
export function runRemoteCommand(command: RemoteCommand): void {
  switch (command.type) {
    case "play":
    case "pause":
    case "next":
    case "previous":
    case "toggleLike":
      playbackCommands.send({ command: command.type });
      return;
    case "seek":
      seek(command.positionMs);
      return;
    case "setVolume":
      playbackCommands.send({ command: "setVolume", value: command.volume });
      return;
    case "queue":
      for (const uri of command.uris) void desktopApi.addToQueue(uri).catch(() => undefined);
      return;
    case "playTracks": {
      const uri = command.uris[command.index];
      if (!uri) return;
      if (command.contextUri) playbackCommands.playContext(command.contextUri, uri);
      else playbackCommands.playUri(uri);
      // Coming over from the phone: continue where it was.
      if (command.positionMs && command.positionMs > 2_000) void seekOnceLoaded(uri, command.positionMs);
    }
  }
}

function seek(positionMs: number) {
  playbackCommands.beginSeek();
  playbackCommands.previewSeek(positionMs);
  playbackCommands.commitSeek();
}

async function seekOnceLoaded(uri: string, positionMs: number) {
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const playback = usePlayerStore.getState().playback;
    if (playback?.currentItem?.uri === uri && playback.durationMs > 0) {
      seek(Math.min(positionMs, playback.durationMs - 1_000));
      return;
    }
  }
}
