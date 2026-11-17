import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MediaItem } from "@luft/protocol-types";
import { SharedQueueTrackResult } from "../src/features/listen-together/SharedQueueTrackResult";
import { SharedQueueLibrary } from "../src/features/listen-together/SharedQueueLibrary";
import { SharedQueuePanel } from "../src/features/listen-together/SharedQueuePanel";
import { roomSelectionIntent } from "../src/features/listen-together/roomSelectionIntent";
import type { ListenTogetherStatus } from "../src/features/listen-together/listenTogetherTypes";
import { desktopApi } from "../src/services/desktopApi";
import { t } from "../src/i18n";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const item: MediaItem = { uri: "spotify:track:0000000000000000000001", source: "spotify", itemType: "track", title: "Found song", creators: [], explicit: false, playable: true };
const room: ListenTogetherStatus = {
  connection: "online", serverUrl: "", role: "host", roomId: "room", hostConnected: true,
  participants: [], control: "hostOnly", revision: 2, driftMs: 0, reconnectAttempts: 0,
  queue: { revision: 4, current: null, items: [{ id: "occurrence", track: { provider: "spotify", uri: item.uri, title: item.title } }] },
};
function show(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(element, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

it("keeps immediate, next and end distinct, and allows immediate play at capacity", () => {
  const onPlay = vi.fn(), onAdd = vi.fn(), onAddMany = vi.fn();
  const props = { item, disabled: false, canAdd: true, canPlay: true, onPlay, onAdd, onAddMany };
  const view = show(<ul><SharedQueueTrackResult {...props} /></ul>);
  fireEvent.click(screen.getByRole("button", { name: t("listen.selection.now") }));
  expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ uri: item.uri }));
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: t("listen.queueNextOne") }));
  expect(onAddMany).toHaveBeenCalledWith({ tracks: [item] }, true);
  fireEvent.click(screen.getByRole("button", { name: t("listen.selection.end") }));
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ uri: item.uri }));
  view.rerender(<ul><SharedQueueTrackResult {...props} canAdd={false} /></ul>);
  expect(screen.getByRole("button", { name: t("listen.selection.now") })).toBeEnabled();
  expect(screen.getByRole("button", { name: t("listen.queueNextOne") })).toBeDisabled();
  expect(screen.getByRole("button", { name: t("listen.selection.end") })).toBeDisabled();
});

it("plays a queued occurrence by ID and exposes steering only with permission", async () => {
  const send = vi.spyOn(desktopApi, "listenTogetherQueueEdit").mockResolvedValue();
  show(<SharedQueuePanel status={room} />);
  fireEvent.click(screen.getByRole("button", { name: t("listen.selection.nowName", { name: item.title }) }));
  await waitFor(() => expect(send).toHaveBeenCalledWith("room", { type: "playQueued", id: "occurrence" }));
  cleanup();
  show(<SharedQueuePanel status={{ ...room, role: "guest" }} />);
  expect(screen.queryByRole("button", { name: t("listen.selection.nowName", { name: item.title }) })).not.toBeInTheDocument();
  expect(roomSelectionIntent(undefined)).toBe("none");
  expect(roomSelectionIntent(room)).toBe("now");
  expect(roomSelectionIntent({ ...room, role: "guest" })).toBe("queue");
  expect(roomSelectionIntent({ ...room, role: "guest", canControl: true })).toBe("now");
  expect(roomSelectionIntent({ ...room, connection: "reconnecting" })).toBe("offline");
});

it("pages the library without hiding playlists and resets the page when filtering", async () => {
  vi.spyOn(desktopApi, "cachedPlaylists").mockResolvedValue({ items: Array.from({ length: 17 }, (_, index) => ({ uri: `spotify:playlist:${index}`, kind: "playlist", name: `Playlist ${String(index + 1).padStart(2, "0")}`, creators: [] })), total: 17, offset: 0, limit: 200 } as never);
  show(<SharedQueueLibrary disabled={false} onAddMany={vi.fn()} />);
  await screen.findByText("Playlist 01");
  expect(screen.queryByText("Playlist 09")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: t("listen.sources.next") }));
  expect(screen.getByText("Playlist 09")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: t("listen.sources.next") }));
  expect(screen.getByText("Playlist 17")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: t("listen.sources.next") })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: t("listen.sources.filter") }), { target: { value: "01" } });
  await screen.findByText("Playlist 01");
  expect(screen.queryByText("Playlist 17")).not.toBeInTheDocument();
});
