import type {
  MediaItem,
  QueueItem,
} from "@luft/protocol-types";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { QueueTrackList } from "../src/features/queue/QueueTrackList";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TRACK: MediaItem = {
  uri: "spotify:track:one",
  source: "spotify",
  itemType: "track",
  title: "Titel Eins",
  creators: [{ name: "Künstler Eins" }],
  albumName: "Album darf nicht erscheinen",
  explicit: false,
  playable: true,
};

function renderList(items: MediaItem[]) {
  const queueItems: QueueItem[] = items.map(
    (item, index) => ({
      item,
      uid: `queue-${index}`,
    }),
  );
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <QueueTrackList
        items={queueItems}
        canRemove
        onPlay={vi.fn()}
        onRemove={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("QueueTrackList", () => {
  it("zeigt ausschließlich Titel und Artist als Textmetadaten", () => {
    renderList([TRACK]);

    expect(screen.getByText("Titel Eins")).toBeVisible();
    expect(screen.getByText("Künstler Eins")).toBeVisible();
    expect(
      screen.queryByText("Album darf nicht erscheinen"),
    ).not.toBeInTheDocument();
  });

  it("entfernt bei doppelter URI genau die angeklickte Zeile über ihre uid", () => {
    const onRemove = vi.fn();
    const items: QueueItem[] = [
      { item: TRACK, uid: "q1" },
      { item: { ...TRACK, title: "Titel Eins (erneut)" }, uid: "c4" },
    ];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <QueueTrackList items={items} canRemove onPlay={vi.fn()} onRemove={onRemove} />
      </QueryClientProvider>,
    );

    const buttons = screen.getAllByRole("button", { name: /aus der Warteschlange entfernen/i });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    expect(onRemove).toHaveBeenCalledWith(items[1]);
  });

  it("bietet ohne uid bei doppelter URI kein mehrdeutiges Entfernen an", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <QueueTrackList
          items={[{ item: TRACK }, { item: { ...TRACK, title: "Titel Eins (erneut)" } }]}
          canRemove
          onPlay={vi.fn()}
          onRemove={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(
      screen.queryByRole("button", {
        name: /aus der Warteschlange entfernen/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("verschiebt per Pointer statt per nativem Browser-Drag", () => {
    const onReorder = vi.fn();
    const items = [TRACK, {
      ...TRACK,
      uri: "spotify:track:two",
      title: "Titel Zwei",
    }, {
      ...TRACK,
      uri: "spotify:track:three",
      title: "Titel Drei",
    }];
    const queueItems: QueueItem[] = items.map(
      (item, index) => ({
        item,
        uid: `queue-${index}`,
      }),
    );

    render(
      <QueryClientProvider client={new QueryClient()}>
        <QueueTrackList
          items={queueItems}
          canRemove
          canReorder
          onPlay={vi.fn()}
          onRemove={vi.fn()}
          onReorder={onReorder}
        />
      </QueryClientProvider>,
    );

    const handles = screen.getAllByRole("button", {
      name: / verschieben$/i,
    });
    const rows = screen.getAllByRole("listitem");
    const handle = handles[0]!;

    expect(handle).not.toHaveAttribute("draggable", "true");
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => false },
    });
    // Rows 60 px apart: the drag measures that distance to find the gap.
    rows.slice(0, 2).forEach((row, index) => {
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
        top: index * 60,
        bottom: index * 60 + 56,
        left: 0,
        right: 500,
        width: 500,
        height: 56,
        x: 0,
        y: index * 60,
        toJSON: () => ({}),
      });
    });

    fireEvent(handle, pointer("pointerdown", 20));
    fireEvent(handle, pointer("pointermove", 150));
    fireEvent(handle, pointer("pointerup", 150));

    expect(onReorder).toHaveBeenCalledOnce();
    expect(onReorder).toHaveBeenCalledWith(0, 2, "after");
  });
});

/** A pointer event with coordinates; jsdom's own pointer events have none. */
function pointer(type: string, clientY: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 480, clientY, button: 0 });
  Object.defineProperties(event, {
    pointerId: { value: 7 },
    isPrimary: { value: true },
  });
  return event;
}
