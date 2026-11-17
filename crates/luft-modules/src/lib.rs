use std::collections::BTreeMap;

use luft_core::Capability;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub required_capabilities: Vec<Capability>,
    pub optional_capabilities: Vec<Capability>,
    pub default_enabled: bool,
}

#[derive(Debug, Error)]
pub enum ModuleError {
    #[error("module id already exists: {0}")]
    Duplicate(String),
    #[error("module not found: {0}")]
    NotFound(String),
}

#[derive(Debug, Default)]
pub struct ModuleRegistry {
    manifests: BTreeMap<String, ModuleManifest>,
    enabled: BTreeMap<String, bool>,
}

impl ModuleRegistry {
    pub fn register(&mut self, manifest: ModuleManifest) -> Result<(), ModuleError> {
        if self.manifests.contains_key(&manifest.id) {
            return Err(ModuleError::Duplicate(manifest.id));
        }
        self.enabled
            .insert(manifest.id.clone(), manifest.default_enabled);
        self.manifests.insert(manifest.id.clone(), manifest);
        Ok(())
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<(), ModuleError> {
        let value = self
            .enabled
            .get_mut(id)
            .ok_or_else(|| ModuleError::NotFound(id.into()))?;
        *value = enabled;
        Ok(())
    }

    #[must_use]
    pub fn enabled(&self, id: &str) -> bool {
        self.enabled.get(id).copied().unwrap_or(false)
    }

    #[must_use]
    pub fn manifests(&self) -> Vec<ModuleManifest> {
        self.manifests.values().cloned().collect()
    }
}

#[must_use]
pub fn audio_control_manifest() -> ModuleManifest {
    ModuleManifest {
        id: "audio-control".into(),
        name: "Audio Control".into(),
        version: "1.0.0".into(),
        description: "Erweiterte Lautstärke- und Audiosteuerung".into(),
        required_capabilities: vec![Capability::PlayerVolume],
        optional_capabilities: vec![Capability::PlayerMute],
        default_enabled: true,
    }
}

#[must_use]
pub fn lyrics_manifest() -> ModuleManifest {
    ModuleManifest {
        id: "lyrics".into(),
        name: "Songtexte".into(),
        version: "1.0.0".into(),
        description: "Synchronisierte Songtexte direkt in Luftify".into(),
        required_capabilities: vec![Capability::PlayerBasic],
        optional_capabilities: vec![],
        default_enabled: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_control_is_registered_enabled_by_default() {
        let mut registry = ModuleRegistry::default();
        registry
            .register(audio_control_manifest())
            .expect("register");
        assert!(registry.enabled("audio-control"));
        assert_eq!(registry.manifests()[0].version, "1.0.0");
    }

    #[test]
    fn lyrics_are_registered_enabled_by_default() {
        let mut registry = ModuleRegistry::default();
        registry.register(lyrics_manifest()).expect("register");
        assert!(registry.enabled("lyrics"));
    }
}
