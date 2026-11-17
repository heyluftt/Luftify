import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueuePanel } from "../src/features/queue/QueuePanel";
import { SharedQueuePanel } from "../src/features/listen-together/SharedQueuePanel";
import { cacheRoomStatus, LISTEN_TOGETHER_QUERY_KEY } from "../src/features/listen-together/roomStatusCache";
import { setListenTogetherStatus, useListenRoomState } from "../src/features/listen-together/guestLock";
import type { ListenTogetherStatus } from "../src/features/listen-together/listenTogetherTypes";
import { useUiStore } from "../src/stores/uiStore";
import { desktopApi } from "../src/services/desktopApi";
import { t } from "../src/i18n";

const localQueue = vi.hoisted(() => vi.fn(() => ({
  connected: true, canRead: true, canClear: true, canRemove: true, canReorder: true,
  queue: { data: { items: [] }, isPending: false }, clear: {}, remove: {}, reorder: {},
})));
vi.mock("../src/features/queue/useQueueController", () => ({ useQueueController: localQueue }));

const room: ListenTogetherStatus = {
  connection: "online", serverUrl: "", role: "guest", roomId: "room", hostConnected: true,
  participants: [], control: "hostOnly", revision: 2, driftMs: 0, reconnectAttempts: 0,
  queue: { revision: 4, current: null, items: [{ id: "guest-added", track: { provider: "spotify", uri: "spotify:track:test", title: "Shared title" } }] },
};
afterEach(() => {
  cleanup();
  useUiStore.setState({ queueOpen: false });
  useListenRoomState.setState({ status: undefined, locked: false });
  vi.restoreAllMocks();
});

it("the playerbar drawer displays and removes shared entries instead of local entries", async () => {
  setListenTogetherStatus(room);
  useUiStore.setState({ queueOpen: true });
  const send = vi.spyOn(desktopApi, "listenTogetherQueueEdit").mockResolvedValue();
  render(<QueryClientProvider client={new QueryClient()}><QueuePanel /></QueryClientProvider>);
  const drawer = screen.getByRole("dialog");
  expect(within(drawer).getAllByText("Shared title")).toHaveLength(2);
  // A host-only guest sees neither the local clear nor room steering controls.
  expect(within(drawer).queryByRole("button", { name: t("listen.queueClear") })).not.toBeInTheDocument();
  expect(localQueue).toHaveBeenLastCalledWith(false, 2500);
  fireEvent.click(within(drawer).getByRole("button", { name: t("listen.queueRemove") }));
  await waitFor(() => expect(send).toHaveBeenCalledWith("room", { type: "remove", id: "guest-added" }));
});

it("blocks a second queue edit before React renders the pending state", async () => {
  let finish!: () => void;
  const send = vi.spyOn(desktopApi, "listenTogetherQueueEdit").mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<QueryClientProvider client={new QueryClient()}><SharedQueuePanel status={room} /></QueryClientProvider>);
  const remove = screen.getByRole("button", { name: t("listen.queueRemove") });
  act(() => { remove.click(); remove.click(); });
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  await act(async () => finish());
});

it("a delayed poll cannot undo a live queue removal", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = [LISTEN_TOGETHER_QUERY_KEY];
  client.setQueryData(queryKey, room);
  let finish!: (status: ListenTogetherStatus) => void;
  const polling = client.fetchQuery({ queryKey, queryFn: () => new Promise<ListenTogetherStatus>(resolve => { finish = resolve; }) }).catch(() => undefined);
  const updated = { ...room, queue: { ...room.queue!, revision: 5, items: [] } };
  cacheRoomStatus(client, updated);
  finish(room);
  await polling;
  expect(client.getQueryData<ListenTogetherStatus>(queryKey)?.queue?.items).toEqual([]);
  // A delayed Create/Join result must not roll back newer events either.
  cacheRoomStatus(client, room);
  expect(client.getQueryData<ListenTogetherStatus>(queryKey)?.queue?.revision).toBe(5);
  client.clear();
});
