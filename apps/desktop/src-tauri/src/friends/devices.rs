//! Further devices for this profile (a phone): a short link code to type
//! there, the list of linked devices and removing one.
use luft_listen_together::devices::{DeviceLink, LinkedDevice};
use reqwest::Method;

use super::{
    http,
    service::{FriendsService, authenticated},
};

impl FriendsService {
    /// A new link code; an older one stops working.
    pub async fn link_code(&self) -> Result<DeviceLink, String> {
        let session = self.runtime.session.lock().await;
        let (endpoint, credential) = authenticated(&session)?;
        if credential.profile_id.is_none() {
            return Err("friends.error.inactive".into());
        }
        http::request(&self.runtime.client, endpoint, Method::POST, "devices/link", Some(&credential.token), None::<&()>, None).await
    }

    pub async fn devices(&self) -> Result<Vec<LinkedDevice>, String> {
        let session = self.runtime.session.lock().await;
        let (endpoint, credential) = authenticated(&session)?;
        http::request(&self.runtime.client, endpoint, Method::GET, "devices", Some(&credential.token), None::<&()>, None).await
    }

    pub async fn remove_device(&self, id: String) -> Result<Vec<LinkedDevice>, String> {
        if id.len() != 12 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("friends.error.invalidDevice".into());
        }
        let session = self.runtime.session.lock().await;
        let (endpoint, credential) = authenticated(&session)?;
        let route = format!("devices/{id}");
        http::request(&self.runtime.client, endpoint, Method::DELETE, &route, Some(&credential.token), None::<&()>, None).await
    }
}
