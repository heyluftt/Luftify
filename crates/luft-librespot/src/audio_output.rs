use cpal::traits::{DeviceTrait, HostTrait};
use serde::{Deserialize, Serialize};
use tracing::warn;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDevice {
    pub name: String,
    pub is_default: bool,
}

#[must_use]
pub fn list_output_devices() -> Vec<AudioOutputDevice> {
    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|device| device.name().ok());
    let Ok(devices) = host.output_devices() else {
        warn!(
            adapter = "librespot",
            "audio output devices could not be listed"
        );
        return Vec::new();
    };
    let mut listed = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for device in devices {
        let Ok(name) = device.name() else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() || !seen.insert(name.to_string()) {
            continue;
        }
        listed.push(AudioOutputDevice {
            is_default: default_name.as_deref() == Some(name),
            name: name.to_string(),
        });
    }
    listed.sort_by(|left, right| {
        right
            .is_default
            .cmp(&left.is_default)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    listed
}

#[must_use]
pub fn resolve_output_device(requested: Option<&str>) -> Option<String> {
    let name = requested?.trim();
    if name.is_empty() {
        return None;
    }
    list_output_devices()
        .into_iter()
        .find(|device| device.name == name)
        .map(|device| device.name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listing_output_devices_does_not_panic() {
        let devices = list_output_devices();
        let defaults = devices.iter().filter(|device| device.is_default).count();
        assert!(defaults <= 1);
        assert!(resolve_output_device(Some("")).is_none());
        assert!(resolve_output_device(None).is_none());
    }
}
