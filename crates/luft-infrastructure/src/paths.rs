use std::{env, path::PathBuf, sync::OnceLock};

use thiserror::Error;

use crate::product_config;

const LEGACY_DATA_DIRECTORY: &str = "LuftPlayer";

#[derive(Debug, Error)]
pub enum PathError {
    #[error("LOCALAPPDATA is not available")]
    LocalAppDataUnavailable,
    #[error("account profile could not be read: {0}")]
    ProfileIo(#[from] std::io::Error),
    #[error("invalid account profile selection")]
    InvalidProfile,
}

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub data: PathBuf,
    pub logs: PathBuf,
    pub cache: PathBuf,
    pub database: PathBuf,
}

impl AppPaths {
    pub fn discover() -> Result<Self, PathError> {
        // Pin paths for this process: a pending switch must never redirect in-flight writes.
        static ACTIVE: OnceLock<PathBuf> = OnceLock::new();
        if let Some(data) = ACTIVE.get() {
            return Ok(Self::from_data_dir(data.clone()));
        }
        let base = Self::discover_base()?.data;
        let id = match std::fs::read_to_string(base.join("active-account")) {
            Ok(id) => id,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => "default".into(),
            Err(error) => return Err(error.into()),
        };
        let data = Self::account_data_dir(&base, id.trim())?;
        if id.trim() != "default" && !data.join("luft-player.db").is_file() {
            return Err(PathError::InvalidProfile);
        }
        let data = ACTIVE.get_or_init(|| data).clone();
        Ok(Self::from_data_dir(data))
    }

    pub fn account_data_dir(base: &std::path::Path, id: &str) -> Result<PathBuf, PathError> {
        if id == "default" {
            return Ok(base.to_path_buf());
        }
        if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(PathError::InvalidProfile);
        }
        Ok(base.join("Accounts").join(id))
    }

    pub fn discover_base() -> Result<Self, PathError> {
        let local = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .ok_or(PathError::LocalAppDataUnavailable)?;
        let base = local.join(&product_config().data_directory);
        let legacy = local.join(LEGACY_DATA_DIRECTORY);
        if !base.exists() && legacy.exists() {
            let _ = std::fs::rename(&legacy, &base);
        }
        Ok(Self::from_data_dir(base))
    }

    #[must_use]
    pub fn from_data_dir(data: PathBuf) -> Self {
        Self {
            logs: data.join("Logs"),
            cache: data.join("Cache"),
            database: data.join("luft-player.db"),
            data,
        }
    }

    #[must_use]
    pub fn librespot_dir(&self) -> PathBuf {
        self.data.join("Librespot")
    }

    pub async fn ensure(&self) -> Result<(), std::io::Error> {
        tokio::fs::create_dir_all(&self.logs).await?;
        tokio::fs::create_dir_all(&self.cache).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_profile_paths_are_separate_and_reject_path_input() {
        let base = PathBuf::from("C:/safe/local/Luftify");
        assert_eq!(AppPaths::account_data_dir(&base, "default").unwrap(), base);
        let first = AppPaths::account_data_dir(&base, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
        let second = AppPaths::account_data_dir(&base, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").unwrap();
        assert_ne!(first, second);
        assert!(first.starts_with(base.join("Accounts")));
        for invalid in ["", "..", "../outside", "C:/outside", "default/other"] {
            assert!(AppPaths::account_data_dir(&base, invalid).is_err());
        }
    }

    #[test]
    fn builds_all_paths_under_the_selected_root() {
        let root = PathBuf::from("C:/safe/local/Luftify");
        let paths = AppPaths::from_data_dir(root.clone());
        assert!(paths.database.starts_with(&root));
        assert!(paths.logs.starts_with(&root));
        assert!(paths.cache.starts_with(&root));
        assert_eq!(paths.librespot_dir(), root.join("Librespot"));
    }
}
