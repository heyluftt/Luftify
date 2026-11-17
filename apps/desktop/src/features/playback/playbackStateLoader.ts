import type { PlaybackState } from "@luft/protocol-types";
import { desktopApi } from "../../services/desktopApi";

let activeStateRequest: Promise<PlaybackState> | undefined;
let requestGeneration = 0;

export function loadPlaybackStateOnce(): Promise<PlaybackState> {
  if (activeStateRequest) return activeStateRequest;
  const generation = requestGeneration;
  const request = desktopApi.playbackState()
    .finally(() => {
      if (requestGeneration === generation && activeStateRequest === request) {
        activeStateRequest = undefined;
      }
    });
  activeStateRequest = request;
  return request;
}

export function invalidatePlaybackStateLoader(): void {
  requestGeneration += 1;
  activeStateRequest = undefined;
}

export function resetPlaybackStateLoaderForTests(): void {
  activeStateRequest = undefined;
  requestGeneration = 0;
}
