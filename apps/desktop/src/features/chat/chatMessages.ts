import type { ChatMessage } from "./chatApi";

export interface ChatThreadData { messages: ChatMessage[]; cursor: number; hasOlder: boolean }
/** Keep the polling cursor separate: a just-sent reply may be ahead of unread incoming messages. */
export function mergeChatMessages(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const entries = new Map(previous.map((message) => [message.id, message]));
  incoming.forEach((message) => entries.set(message.id, message));
  return [...entries.values()].sort((a, b) => a.id - b.id);
}
