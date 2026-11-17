use super::{
    http,
    service::{FriendsService, authenticated},
};
use luft_listen_together::chat::{ChatConversation, ChatMessage, ChatPage, ChatRead, ChatSend};
use reqwest::Method;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use zeroize::Zeroizing;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAccount {
    pub server_url: String,
    pub profile_id: String,
}

impl FriendsService {
    async fn chat_request<T: DeserializeOwned>(
        &self,
        account: &ChatAccount,
        method: Method,
        route: &str,
        body: Option<&impl Serialize>,
    ) -> Result<T, String> {
        let (endpoint, token) = {
            let session = self.runtime.session.lock().await;
            let (endpoint, credential) = authenticated(&session)?;
            if session.server_url != account.server_url
                || credential.profile_id.as_deref() != Some(account.profile_id.as_str())
            {
                return Err("friends.error.unauthorized".into());
            }
            (endpoint.clone(), Zeroizing::new(credential.token.clone()))
        };
        let result = http::request(
            &self.runtime.client,
            &endpoint,
            method,
            route,
            Some(token.as_str()),
            body,
            None,
        )
        .await;
        // Switching profile/server while a request is in flight cannot expose the previous chat.
        let session = self.runtime.session.lock().await;
        if session.server_url != account.server_url
            || session
                .credential
                .as_ref()
                .and_then(|c| c.profile_id.as_deref())
                != Some(account.profile_id.as_str())
        {
            return Err("friends.error.unauthorized".into());
        }
        result
    }

    pub async fn chat_inbox(&self, account: &ChatAccount) -> Result<Vec<ChatConversation>, String> {
        self.chat_request(account, Method::GET, "chats", None::<&()>)
            .await
    }
    pub async fn chat_messages(
        &self,
        account: &ChatAccount,
        peer: &str,
        before: Option<i64>,
        after: Option<i64>,
    ) -> Result<ChatPage, String> {
        let mut route = peer_route(peer)?;
        if before.is_some() && after.is_some() || before.into_iter().chain(after).any(|v| v < 0) {
            return Err("friends.error.invalidMessage".into());
        }
        if let Some(id) = before {
            route.push_str(&format!("?before={id}"));
        }
        if let Some(id) = after {
            route.push_str(&format!("?after={id}"));
        }
        self.chat_request(account, Method::GET, &route, None::<&()>)
            .await
    }
    pub async fn chat_send(
        &self,
        account: &ChatAccount,
        peer: &str,
        input: &ChatSend,
    ) -> Result<ChatMessage, String> {
        self.chat_request(account, Method::POST, &peer_route(peer)?, Some(input))
            .await
    }
    pub async fn chat_read(
        &self,
        account: &ChatAccount,
        peer: &str,
        through: i64,
    ) -> Result<ChatRead, String> {
        self.chat_request(
            account,
            Method::POST,
            &format!("{}/read", peer_route(peer)?),
            Some(&ChatRead { through }),
        )
        .await
    }
}

fn peer_route(peer: &str) -> Result<String, String> {
    if peer.len() != 36 || !peer.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err("friends.error.invalidMessage".into());
    }
    Ok(format!("chats/{peer}"))
}
