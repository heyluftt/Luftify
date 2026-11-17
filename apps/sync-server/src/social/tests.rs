use axum::{
    Json,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode},
};
use luft_listen_together::{
    HubEvent, TrackRef, generate_join_code, server_now_ms,
    social::{PresenceUpdate, SocialAction, SocialOptions, SocialProfileInput, SocialRegistration},
};

use super::*;

fn headers(token: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
    );
    headers
}

async fn user(store: &Store, name: &str) -> SocialRegistration {
    store
        .register(SocialProfileInput {
            display_name: name.into(),
            avatar_uri: None,
        })
        .await
        .unwrap()
}

async fn befriend(store: &Store, one: &SocialRegistration, other: &SocialRegistration) {
    store
        .action(
            &one.snapshot.me.id,
            SocialAction::Request {
                friend_code: other.snapshot.me.friend_code.clone(),
            },
        )
        .await
        .unwrap();
    let incoming = store
        .snapshot(&other.snapshot.me.id)
        .await
        .unwrap()
        .incoming_requests;
    store
        .action(
            &other.snapshot.me.id,
            SocialAction::RespondRequest {
                request_id: incoming[0].id.clone(),
                accept: true,
            },
        )
        .await
        .unwrap();
}

#[path = "tests_identity.rs"]
mod identity;
#[path = "tests_invitations.rs"]
mod invitations;
#[path = "tests_presence.rs"]
mod presence;
#[path = "tests_roles.rs"]
mod roles;
#[path = "tests_reports.rs"]
mod reports;
#[path = "tests_media.rs"]
mod media;
#[path = "tests_listen_along.rs"]
mod listen_along;
#[path = "tests_achievements.rs"]
mod achievements;
#[path = "tests_admin.rs"]
mod admin;
#[path = "tests_devices.rs"]
mod devices;
#[path = "tests_recovery.rs"]
mod recovery;
#[path = "tests_playlist_shares.rs"]
mod playlist_shares;
#[path = "tests_playlist_accounts.rs"]
mod playlist_accounts;
#[path = "tests_chat.rs"]
mod chat;
