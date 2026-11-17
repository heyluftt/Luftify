import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DiagnosticsPage } from "../src/pages/DiagnosticsPage";
import { diagnosticState } from "../src/features/diagnostics/diagnosticState";
import { LIBRESPOT_PLAYBACK_CAPABILITIES } from "../src/features/spotify/librespotCapabilities";
import { desktopApi } from "../src/services/desktopApi";
import type { ConnectionInfo, LibrespotStatus } from "../src/types/tauri";

vi.mock("../src/services/desktopApi", () => ({ desktopApi: {
  settings: vi.fn(), connectionInfo: vi.fn(), librespotStatus: vi.fn(), listenTogetherStatus: vi.fn(),
  startLibrespotLogin: vi.fn(), exportDiagnostics: vi.fn(), revealDiagnosticsReport: vi.fn(),
} }));

const libre: LibrespotStatus = { phase: "ready", credentialsPresent: true, username: null, message: null };
const input = { libre, mockMode: false, pending: false, error: false };

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("diagnostic status", () => {
  it("does not report cached healthy data after a failed refresh, including demo mode", () => {
    for (const mockMode of [false, true]) {
      const state = diagnosticState({ ...input, mockMode, error: true });
      expect(state).toMatchObject({ status: "unknown", connected: false, capabilities: [], needsLogin: false, canReconnect: false });
    }
  });

  it("treats demo mode as a connected session with every capability", () => {
    const state = diagnosticState({ ...input, libre: undefined, mockMode: true });
    expect(state.status).toBe("demo");
    expect(state.connected).toBe(true);
    expect(state.capabilities).toEqual([...LIBRESPOT_PLAYBACK_CAPABILITIES]);
  });

  it("reports a ready Libre session as ok with its capabilities", () => {
    const state = diagnosticState(input);
    expect(state).toMatchObject({ status: "ok", connected: true, needsLogin: false, canReconnect: false });
    expect(state.capabilities).toContain("player.basic");
  });

  it("keeps checking while the session connects or the status is still loading", () => {
    expect(diagnosticState({ ...input, libre: { ...libre, phase: "connecting" } })).toMatchObject({ status: "checking", connected: false, capabilities: [] });
    expect(diagnosticState({ ...input, libre: { ...libre, phase: "authenticating" } }).status).toBe("checking");
    expect(diagnosticState({ ...input, pending: true }).status).toBe("checking");
    expect(diagnosticState({ ...input, libre: undefined }).status).toBe("checking");
  });

  it("asks for a sign-in instead of a reconnect without credentials", () => {
    const state = diagnosticState({ ...input, libre: { ...libre, phase: "needsLogin", credentialsPresent: false } });
    expect(state).toMatchObject({ status: "offline", connected: false, capabilities: [], needsLogin: true, canReconnect: false });
    expect(diagnosticState({ ...input, libre: { ...libre, phase: "disconnected", credentialsPresent: false } }).needsLogin).toBe(true);
  });

  it("offers a reconnect for a disconnected session with stored credentials", () => {
    const state = diagnosticState({ ...input, libre: { ...libre, phase: "disconnected" } });
    expect(state).toMatchObject({ status: "offline", needsLogin: false, canReconnect: true });
    expect(diagnosticState({ ...input, libre: { ...libre, phase: "error" } }).canReconnect).toBe(true);
  });
});

describe("diagnostics page", () => {
  it("renders English labels, the session state and the export flow", async () => {
    Object.defineProperty(navigator, "language", { configurable: true, value: "en-US" });
    const connection: ConnectionInfo = { mockMode: false, startup: { phase: "ready", elapsedMs: 10, sequence: 1 } };
    vi.mocked(desktopApi.settings).mockResolvedValue({ librespotAudioDevice: null } as Awaited<ReturnType<typeof desktopApi.settings>>);
    vi.mocked(desktopApi.connectionInfo).mockResolvedValue(connection);
    vi.mocked(desktopApi.librespotStatus).mockResolvedValue(libre);
    vi.mocked(desktopApi.listenTogetherStatus).mockResolvedValue({ connection: "idle" } as Awaited<ReturnType<typeof desktopApi.listenTogetherStatus>>);
    vi.mocked(desktopApi.exportDiagnostics).mockResolvedValue({ path: "C:\\Diagnostics\\report.json", warnings: 2, errors: 0 });
    vi.mocked(desktopApi.revealDiagnosticsReport).mockResolvedValue();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      render(<QueryClientProvider client={client}><MemoryRouter><DiagnosticsPage /></MemoryRouter></QueryClientProvider>);
      expect(screen.getByRole("heading", { name: "Diagnostics" })).toBeInTheDocument();
      expect((await screen.findAllByText("Connected")).length).toBeGreaterThan(0);
      expect(screen.getByText("The local playback session is ready.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Connect Libre" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Sign in to Libre" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Library & search" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Export report" }));
      expect(await screen.findByText("C:\\Diagnostics\\report.json")).toBeInTheDocument();
      expect(screen.getByText("Since the app started: 2 warnings, 0 errors")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
      // TanStack Query also passes a mutation context as the second argument.
      await waitFor(() => expect(vi.mocked(desktopApi.revealDiagnosticsReport).mock.calls[0]?.[0]).toBe("C:\\Diagnostics\\report.json"));
    } finally {
      cleanup();
      client.clear();
      Object.defineProperty(navigator, "language", { configurable: true, value: "de-DE" });
    }
  });
});
