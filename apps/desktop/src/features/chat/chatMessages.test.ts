import { describe, expect, it } from "vitest";
import { mergeChatMessages } from "./chatMessages";
import { allowsNotice } from "../notices/noticePrefs";
import type { ChatMessage } from "./chatApi";
const message = (id: number): ChatMessage => ({ id, clientId: `id-${id}`, senderId: "sender", body: `message ${id}`, createdAtMs: id });
describe("chat history", () => {
  it("merges older pages, polling and sent replies without duplicate or shuffled messages", () => {
    expect(mergeChatMessages([message(7),message(11)], [message(3),message(7),message(9)]).map((m) => m.id)).toEqual([3,7,9,11]);
  });
  it("respects the separate message notification preference and old settings", () => {
    expect(allowsNotice(undefined,"chat")).toBe(true);
    expect(allowsNotice({ messages:false } as never,"chat")).toBe(false);
    expect(allowsNotice({ friends:false, messages:true } as never,"chat")).toBe(true);
  });
});
