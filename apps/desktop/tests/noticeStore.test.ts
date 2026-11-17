import { describe, expect, it } from "vitest";
import { acknowledgeNotice, pushNotice, unreadCount, useNotices } from "../src/features/notices/noticeStore";

describe("notice bell", () => {
  it("stops counting a chat once it was read in the conversation, and counts the next message again", () => {
    useNotices.setState({ notices: [], history: [], readAtMs: 0 });
    pushNotice({ id: "chat:a", kind: "chat", title: "Jess: hi" });
    expect(unreadCount(useNotices.getState())).toBe(1);
    acknowledgeNotice("chat:a");
    expect(unreadCount(useNotices.getState())).toBe(0);
    expect(useNotices.getState().history).toHaveLength(1);
    expect(useNotices.getState().notices).toHaveLength(0);
    pushNotice({ id: "chat:a", kind: "chat", title: "Jess: noch da?" });
    expect(unreadCount(useNotices.getState())).toBe(1);
  });
});
