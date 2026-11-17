import type { ListenTogetherStatus } from "../listen-together/listenTogetherTypes";
import type { LibrespotStatus } from "../../types/tauri";
import { LIBRESPOT_PLAYBACK_CAPABILITIES } from "../spotify/librespotCapabilities";

export type DiagnosticStatus = "ok" | "checking" | "offline" | "unknown" | "demo";

export interface DiagnosticState {
  status: DiagnosticStatus;
  /** The Libre session is live and commands reach it. */
  connected: boolean;
  capabilities: string[];
  /** Whether the session needs a sign-in before it can connect. */
  needsLogin: boolean;
  /** Whether a reconnect attempt makes sense right now. */
  canReconnect: boolean;
}

export interface DiagnosticInput {
  libre: LibrespotStatus | undefined;
  mockMode: boolean;
  pending: boolean;
  error: boolean;
}

/**
 * Pure status evaluation for the diagnostics page. A failed refresh never
 * reports cached health: the page says "unknown" until a check succeeds.
 */
export function diagnosticState(input: DiagnosticInput): DiagnosticState {
  if (input.error) {
    return { status: "unknown", connected: false, capabilities: [], needsLogin: false, canReconnect: false };
  }
  if (input.mockMode) {
    return { status: "demo", connected: true, capabilities: [...LIBRESPOT_PLAYBACK_CAPABILITIES], needsLogin: false, canReconnect: false };
  }
  if (input.pending || !input.libre) {
    return { status: "checking", connected: false, capabilities: [], needsLogin: false, canReconnect: false };
  }
  const phase = input.libre.phase;
  if (phase === "ready") {
    return { status: "ok", connected: true, capabilities: [...LIBRESPOT_PLAYBACK_CAPABILITIES], needsLogin: false, canReconnect: false };
  }
  if (phase === "connecting" || phase === "authenticating") {
    return { status: "checking", connected: false, capabilities: [], needsLogin: false, canReconnect: false };
  }
  const needsLogin = phase === "needsLogin" || !input.libre.credentialsPresent;
  return {
    status: "offline",
    connected: false,
    capabilities: [],
    needsLogin,
    canReconnect: !needsLogin,
  };
}

export function listenConnectionLabelKey(status: ListenTogetherStatus | undefined): "diagnostics.listenOnline" | "diagnostics.listenReconnecting" | "diagnostics.listenConnecting" | "diagnostics.listenIdle" {
  switch (status?.connection) {
    case "online":
      return "diagnostics.listenOnline";
    case "reconnecting":
      return "diagnostics.listenReconnecting";
    case "connecting":
      return "diagnostics.listenConnecting";
    default:
      return "diagnostics.listenIdle";
  }
}
