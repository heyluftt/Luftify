//! Bind each local data directory to one Spotify identity, surviving logout.
use std::{io::Write, path::Path};

pub(crate) async fn bind(cache_dir: &Path, username: &str) -> Result<(), String> {
    if username.trim().is_empty() {
        return Err("Spotify hat keine Konto-ID geliefert.".into());
    }
    let path = cache_dir
        .parent()
        .ok_or("Ungültiger Profilpfad.")?
        .join("spotify-account");
    match tokio::fs::read_to_string(&path).await {
        Ok(expected) if expected.trim() == username => return Ok(()),
        Ok(_) => return Err("Dieses lokale Profil gehört zu einem anderen Spotify-Account. Bitte „Account wechseln“ verwenden.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("Die Zuordnung des Spotify-Accounts konnte nicht gelesen werden.".into()),
    }
    let username = username.to_owned();
    tokio::task::spawn_blocking(move || {
        let save_error = || "Die Konto-Zuordnung konnte nicht gespeichert werden.".to_string();
        let mut temporary =
            tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(|_| save_error())?;
        temporary
            .write_all(username.as_bytes())
            .map_err(|_| save_error())?;
        temporary.as_file().sync_all().map_err(|_| save_error())?;
        // Publish complete content without replacing a binding created by another process.
        match temporary.persist_noclobber(&path) {
            Ok(_) => Ok(()),
            Err(_)
                if std::fs::read_to_string(&path)
                    .ok()
                    .is_some_and(|value| value.trim() == username) =>
            {
                Ok(())
            }
            Err(_) => Err(save_error()),
        }
    })
    .await
    .map_err(|_| "Die Konto-Zuordnung konnte nicht gespeichert werden.")?
}

pub(crate) async fn clear_credentials(cache_dir: &Path) -> Result<(), String> {
    for path in [
        cache_dir.join("credentials.json"),
        cache_dir.join("PendingLogin/credentials.json"),
    ] {
        match tokio::fs::remove_file(path).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Die lokalen Zugangsdaten konnten nicht entfernt werden. Bitte die Abmeldung erneut versuchen.".into()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn account_logout_removes_both_credential_locations_and_reports_failure() {
        let root = tempfile::tempdir().unwrap();
        let cache = root.path().join("Librespot");
        tokio::fs::create_dir_all(cache.join("PendingLogin"))
            .await
            .unwrap();
        tokio::fs::write(cache.join("credentials.json"), "old")
            .await
            .unwrap();
        tokio::fs::write(cache.join("PendingLogin/credentials.json"), "pending")
            .await
            .unwrap();
        clear_credentials(&cache).await.unwrap();
        assert!(!cache.join("credentials.json").exists());
        assert!(!cache.join("PendingLogin/credentials.json").exists());
        clear_credentials(&cache).await.unwrap();
        tokio::fs::create_dir(cache.join("credentials.json"))
            .await
            .unwrap();
        assert!(clear_credentials(&cache).await.is_err());
    }

    #[tokio::test]
    async fn account_binding_keeps_profiles_separate_and_survives_logout() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let first_cache = first.path().join("Librespot");
        tokio::fs::create_dir(&first_cache).await.unwrap();
        bind(&first_cache, "alice").await.unwrap();
        assert!(bind(&first_cache, "bob").await.is_err());
        bind(&second.path().join("Librespot"), "bob").await.unwrap();
        tokio::fs::remove_dir(&first_cache).await.unwrap();
        assert!(bind(&first_cache, "bob").await.is_err());
        bind(&first_cache, "alice").await.unwrap();
        assert_eq!(
            tokio::fs::read_to_string(first.path().join("spotify-account"))
                .await
                .unwrap(),
            "alice"
        );
    }
}
