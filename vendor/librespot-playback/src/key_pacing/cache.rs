//! Keys received in this session: a song heard again asks nobody.
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};

use librespot_core::{FileId, audio_key::AudioKey};

/// A key is 16 bytes, so this stays small.
const MAX_KEYS: usize = 8192;

static KEYS: LazyLock<Mutex<HashMap<FileId, AudioKey>>> = LazyLock::new(Mutex::default);

fn keys() -> std::sync::MutexGuard<'static, HashMap<FileId, AudioKey>> {
    KEYS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn known(file: FileId) -> Option<AudioKey> {
    keys().get(&file).copied()
}

pub(crate) fn remember(file: FileId, key: AudioKey) {
    let mut keys = keys();
    if keys.len() < MAX_KEYS || keys.contains_key(&file) {
        keys.insert(file, key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_remembered_per_file() {
        let file = FileId([7; 20]);
        assert!(known(file).is_none());
        remember(file, AudioKey([1; 16]));
        assert_eq!(known(file), Some(AudioKey([1; 16])));
    }
}
