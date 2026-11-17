mod account_binding;
mod album;
mod artist;
mod audio_files_extension;
mod audio_output;
mod canvas;
mod catalog;
mod collection;
mod dsp_output;
mod key_budget;
mod lossless_probe;
mod lyrics;
mod metadata;
mod metadata_batch;
mod oauth;
mod output_fade;
mod output_sink;
mod pathfinder;
mod playback;
mod playcount;
mod playlist;
mod playlist_people;
mod playlist_manage;
mod playlist_cover;
mod playlist_mutate;
mod proto_wire;
mod queue;
mod service;
mod session_http;

pub use audio_output::{AudioOutputDevice, list_output_devices};
pub use luft_audio::{DspSettings, PlayerSetup, VisualizerFrame};
pub use lossless_probe::LosslessProbe;
pub use lyrics::{TrackLyricLine, TrackLyrics};
pub use service::{LibrespotPhase, LibrespotService, LibrespotStatus, TrackPreview, volume_to_connect};
/// While a song waits for Spotify's audio key limit: until when it expects
/// its key (vendor/librespot-playback/src/key_pacing.rs).
pub use librespot::playback::observe_key_waits;

pub fn newest_first_catalog(items: Vec<luft_core::MediaItem>) -> Vec<luft_core::MediaItem> {
    crate::queue::sort_media_newest_first(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_volume_maps_the_full_range() {
        assert_eq!(volume_to_connect(0.0), 0);
        assert_eq!(volume_to_connect(1.0), u16::MAX);
        assert_eq!(volume_to_connect(0.5), 32_768);
    }

    #[test]
    fn default_status_asks_for_login() {
        let status = LibrespotStatus::needs_login();
        assert_eq!(status.phase, LibrespotPhase::NeedsLogin);
        assert!(!status.credentials_present);
    }
}
