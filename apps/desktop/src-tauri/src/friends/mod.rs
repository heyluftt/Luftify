mod actions;
pub mod chat;
mod credentials;
mod devices;
mod endpoint;
mod heartbeat;
mod http;
mod idle;
mod listen_along;
mod media;
mod presence;
mod recovery;
mod remote;
mod reports;
mod service;

pub use service::{FriendsService, FriendsStatus};
