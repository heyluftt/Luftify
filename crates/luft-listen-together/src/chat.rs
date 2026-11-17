//! Private text chats. Message IDs are ordered server-side; client IDs make retries idempotent.
use crate::SocialProfile;
use serde::{Deserialize, Serialize};

pub const MAX_CHAT_CHARS: usize = 2000;
pub const CHAT_PAGE_SIZE: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: i64,
    pub client_id: String,
    pub sender_id: String,
    pub body: String,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatConversation {
    pub profile: SocialProfile,
    pub last_message: Option<ChatMessage>,
    #[serde(default)]
    pub last_incoming: Option<ChatMessage>,
    pub unread: u32,
    /// Up to which message id the friend has read this chat; older servers send nothing.
    #[serde(default)]
    pub peer_read: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatPage {
    pub messages: Vec<ChatMessage>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSend {
    pub client_id: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRead {
    pub through: i64,
}
