mod hub;
mod limits;
mod rooms;
mod social;
mod socket;
mod updates;

use std::{net::SocketAddr, sync::Arc};

use axum::{Json, Router, extract::State, routing::get};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tracing::info;

use hub::AppHub;

const DEFAULT_BIND: &str = "127.0.0.1:7421";

fn bind_addr() -> String {
    if let Ok(port) = std::env::var("PORT") {
        let port = port.trim();
        if !port.is_empty() {
            return format!("0.0.0.0:{port}");
        }
    }
    std::env::var("LUFTIFY_SYNC_BIND").unwrap_or_else(|_| DEFAULT_BIND.into())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "luft_sync_server=info".into()),
        )
        .init();

    let bind = bind_addr();
    let hub = Arc::new(AppHub::new());
    rooms::restore(&hub).await;
    rooms::keep_saved(hub.clone());
    let social = social::router(hub.clone())
        .await
        .expect("social database initialization failed");
    let cleanup_hub = hub.clone();
    tokio::spawn(async move {
        // Often enough that a lost host is replaced close to HOST_HANDOFF_AFTER.
        let mut timer = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            timer.tick().await;
            cleanup_hub.expire_disconnected().await;
        }
    });
    let app = Router::new()
        .route("/health", get(health))
        .route("/ws", get(socket::upgrade))
        .with_state(hub)
        .merge(social)
        .merge(updates::router());

    let listener = TcpListener::bind(&bind)
        .await
        .unwrap_or_else(|error| panic!("listen-together bind failed on {bind}: {error}"));
    info!(%bind, "listen-together sync server");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .expect("listen-together server stopped");
}

/// The app checks reachability and protocol here before opening a room.
async fn health(State(hub): State<Arc<AppHub>>) -> Json<Value> {
    Json(json!({
        "status": "ok",
        "protocol": luft_listen_together::PROTOCOL_VERSION,
        "socialProtocol": luft_listen_together::social::SOCIAL_PROTOCOL_VERSION,
        "rooms": hub.room_count().await,
    }))
}
