import { usePlayerStore } from "../../stores/playerStore";
import { playbackCommands } from "./playbackCommands";

export type TrayPlayerAction = "playPause" | "previous" | "next";

export function dispatchTrayPlayerAction(action: TrayPlayerAction): void {
  const state = usePlayerStore.getState();
  if (state.connection !== "online") return;
  if (action === "playPause") {
    playbackCommands.send({ command: state.playback?.isPlaying ? "pause" : "play" });
  } else {
    playbackCommands.send({ command: action });
  }
}
