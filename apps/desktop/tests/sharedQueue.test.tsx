import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SharedQueuePanel } from "../src/features/listen-together/SharedQueuePanel";
import type { ListenTogetherStatus } from "../src/features/listen-together/listenTogetherTypes";
import { desktopApi } from "../src/services/desktopApi";
import { t } from "../src/i18n";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const status: ListenTogetherStatus = {
  connection: "online", serverUrl: "", role: "guest", roomId: "room", hostConnected: true,
  participants: [], control: "hostOnly", revision: 2, driftMs: 0, reconnectAttempts: 0,
  queue: { revision: 4, current: null, items: ["one", "two", "three"].map(id => ({ id, track: { provider: "spotify", uri: "spotify:track:same", title: id } })) },
};
function show(value = status) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SharedQueuePanel status={value} /></QueryClientProvider>);
}
it("moves duplicate tracks by occurrence ID and waits for acknowledgement", async () => {
  let finish!: () => void;
  const send = vi.spyOn(desktopApi, "listenTogetherQueueEdit").mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  show();
  fireEvent.click(screen.getAllByRole("button", { name: t("listen.queueToNext") })[2]!);
  await waitFor(() => expect(send).toHaveBeenCalledWith("room", { type: "move", id: "three", beforeId: "one" }));
  expect(screen.getAllByRole("button", { name: t("listen.queueRemove") })[0]).toBeDisabled();
  expect(screen.queryByText(t("listen.queueSaved"))).not.toBeInTheDocument();
  finish();
  await screen.findByText(t("listen.queueSaved"));
});
it("does not allow edits while reconnecting", () => {
  const send = vi.spyOn(desktopApi, "listenTogetherQueueEdit").mockResolvedValue();
  show({ ...status, connection: "reconnecting" });
  fireEvent.click(screen.getAllByRole("button", { name: t("listen.queueRemove") })[0]!);
  expect(send).not.toHaveBeenCalled();
});

it("shows cached covers, artists and the contributor even after leaving", async () => {
  const data = "data:image/png;base64,AAAA";
  const loadCover = vi.spyOn(desktopApi, "coverData").mockResolvedValue(data);
  const track = { provider: "spotify", uri: "spotify:track:same", title: "Night Drive", artists: ["Artist One"], coverUri: "https://i.scdn.co/image/test", durationMs: 185000 };
  show({ ...status, queue: { revision: 5, current: { id: "current", track, addedById: "left", addedByName: "Sam" },
    items: [{ id: "next", track: { ...track, title: "Morning" }, addedByName: "Sam" }] } });
  const current = screen.getByRole("region", { name: t("listen.queuePlaying") });
  const next = screen.getByRole("region", { name: t("listen.queueNext") });
  expect(within(current).getByText("Night Drive")).toBeInTheDocument();
  expect(within(current).getByText("Artist One")).toBeInTheDocument();
  expect(within(current).getByText(t("listen.addedBy", { name: "Sam" }))).toBeInTheDocument();
  expect(within(next).getByText("Morning")).toBeInTheDocument();
  expect(within(next).getByText(t("listen.addedBy", { name: "Sam" }))).toBeInTheDocument();
  await waitFor(() => expect(current.querySelector(".album-art")).toHaveStyle({ backgroundImage: 'url("' + data + '")' }));
  expect(loadCover).toHaveBeenCalledWith(track.coverUri);
  expect(loadCover).toHaveBeenCalledTimes(1);
  expect(within(current).getByText("Night Drive")).toBeInTheDocument();
});
