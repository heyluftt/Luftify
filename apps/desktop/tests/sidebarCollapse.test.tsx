import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../src/components/Sidebar";
import { useUiStore } from "../src/stores/uiStore";

const engineState = {
  localReady: false,
  engineReady: false,
  mockMode: false,
  localPhase: undefined as "ready" | "needsLogin" | undefined,
  credentialsPresent: false,
};

// The library list has its own queries; this test is about the frame only.
vi.mock("../src/components/sidebar/SidebarLibrary", () => ({
  SidebarLibrary: () => null,
}));

vi.mock("../src/features/playback/usePlaybackEngine", () => ({
  usePlaybackEngine: () => engineState,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

describe("Sidebar collapse", () => {
  beforeEach(() => {
    localStorage.clear();
    engineState.localReady = false;
    engineState.engineReady = false;
    engineState.localPhase = undefined;
    useUiStore.getState().setSidebarCollapsed(false);
  });

  afterEach(cleanup);

  it("keeps icon navigation available while collapsing the sidebar", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Sidebar />
          <LocationProbe />
          <Routes>
            <Route path="/" element={<div>home</div>} />
            <Route path="/settings" element={<div>settings</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sidebar einklappen" }));

    expect(screen.getByRole("complementary")).toHaveClass("is-collapsed");
    expect(screen.getByRole("link", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sidebar ausklappen" }))
      .toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("luftplayer.layout.v1"))
      .toContain('"sidebarCollapsed":true');
  });

  it("shows the current engine and opens its settings", () => {
    engineState.localReady = true;
    engineState.engineReady = true;
    engineState.localPhase = "ready";

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Sidebar />
          <LocationProbe />
          <Routes>
            <Route path="/" element={<div>home</div>} />
            <Route path="/settings" element={<div>settings</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Librespot · Bereit/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/settings?focus=playback");
  });
});
