import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { hasLibrespotPlaybackCapability } from "./librespotCapabilities";

/** True once the engine can serve the capability: Libre is connected, or the demo provider runs. */
export function useEngineCapability(capability: string): boolean {
  const { localReady, mockMode } = usePlaybackEngine();
  return mockMode || (localReady && hasLibrespotPlaybackCapability(capability));
}

/**
 * Controls for optional capabilities stay visible; they only wait for the
 * session. Libre never lacks one of its capabilities, so nothing is hidden.
 */
export function useOptionalCapability(capability: string): {
  show: boolean;
  enabled: boolean;
} {
  const enabled = useEngineCapability(capability);
  return { show: true, enabled };
}
