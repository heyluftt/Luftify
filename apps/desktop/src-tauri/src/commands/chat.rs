use crate::{error::CommandError, friends::chat::ChatAccount, state::AppState};
use luft_listen_together::chat::{ChatConversation, ChatMessage, ChatPage, ChatRead, ChatSend};
use tauri::State;

#[tauri::command]
pub async fn chat_inbox(
    account: ChatAccount,
    state: State<'_, AppState>,
) -> Result<Vec<ChatConversation>, CommandError> {
    state
        .friends
        .chat_inbox(&account)
        .await
        .map_err(CommandError::internal)
}
#[tauri::command]
pub async fn chat_messages(
    account: ChatAccount,
    peer: String,
    before: Option<i64>,
    after: Option<i64>,
    state: State<'_, AppState>,
) -> Result<ChatPage, CommandError> {
    state
        .friends
        .chat_messages(&account, &peer, before, after)
        .await
        .map_err(CommandError::internal)
}
#[tauri::command]
pub async fn chat_send(
    account: ChatAccount,
    peer: String,
    input: ChatSend,
    state: State<'_, AppState>,
) -> Result<ChatMessage, CommandError> {
    state
        .friends
        .chat_send(&account, &peer, &input)
        .await
        .map_err(CommandError::internal)
}
#[tauri::command]
pub async fn chat_read(
    account: ChatAccount,
    peer: String,
    through: i64,
    state: State<'_, AppState>,
) -> Result<ChatRead, CommandError> {
    state
        .friends
        .chat_read(&account, &peer, through)
        .await
        .map_err(CommandError::internal)
}
