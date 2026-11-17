//! A copy of the social database once a day, next to it on the volume
//! (`backups/social-YYYY-MM-DD.sqlite`); the newest seven are kept. Luft's
//! manual backup to the PC stays as it is.
use std::{path::{Path, PathBuf}, time::Duration};

use super::{SharedState, Store};

const KEPT: usize = 7;
/// Checked hourly; the first look a little after start, not during it.
const CHECK_EVERY: Duration = Duration::from_secs(60 * 60);
const FIRST_AFTER: Duration = Duration::from_secs(2 * 60);
const PREFIX: &str = "social-";
const SUFFIX: &str = ".sqlite";

pub(super) fn keep_backing_up(state: SharedState) {
    tokio::spawn(async move {
        tokio::time::sleep(FIRST_AFTER).await;
        let mut timer = tokio::time::interval(CHECK_EVERY);
        loop {
            timer.tick().await;
            match state.store.daily_backup().await {
                Ok(Some(path)) => tracing::info!(path = %path.display(), "daily database backup written"),
                Ok(None) => {}
                Err(error) => tracing::warn!(error = %error, "daily database backup unavailable"),
            }
        }
    });
}

impl Store {
    fn backup_dir(&self) -> Option<PathBuf> {
        Some(self.database_path.as_ref()?.parent()?.join("backups"))
    }

    /// Writes today's copy if there is none yet; returns its path when written.
    pub(super) async fn daily_backup(&self) -> std::io::Result<Option<PathBuf>> {
        let Some(dir) = self.backup_dir() else { return Ok(None) };
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let target = dir.join(format!("{PREFIX}{today}{SUFFIX}"));
        if tokio::fs::try_exists(&target).await? {
            return Ok(None);
        }
        tokio::fs::create_dir_all(&dir).await?;
        // Written under another name first, so a half copy never looks complete.
        let partial = dir.join(format!("{PREFIX}{today}.partial"));
        let _ = tokio::fs::remove_file(&partial).await;
        let quoted = partial.to_string_lossy().replace('\'', "''");
        sqlx::query(&format!("VACUUM INTO '{quoted}'")).execute(&self.pool).await.map_err(std::io::Error::other)?;
        tokio::fs::rename(&partial, &target).await?;
        prune(&dir, KEPT).await;
        Ok(Some(target))
    }

    /// How many daily copies there are and when the newest was written.
    pub(super) async fn backup_status(&self) -> (u32, Option<i64>) {
        let Some(dir) = self.backup_dir() else { return (0, None) };
        let copies = dated_copies(&dir).await;
        let newest = match copies.last() {
            Some((_, path)) => tokio::fs::metadata(path).await.ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|since| since.as_millis() as i64),
            None => None,
        };
        (copies.len() as u32, newest)
    }
}

/// The daily copies, oldest first (the dates in the names sort by age).
async fn dated_copies(dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else { return Vec::new() };
    let mut copies = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Ok(name) = entry.file_name().into_string() else { continue };
        let Some(date) = name.strip_prefix(PREFIX).and_then(|rest| rest.strip_suffix(SUFFIX)) else { continue };
        if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok() {
            copies.push((date.to_owned(), entry.path()));
        }
    }
    copies.sort();
    copies
}

async fn prune(dir: &Path, keep: usize) {
    let copies = dated_copies(dir).await;
    if copies.len() <= keep {
        return;
    }
    for (_, path) in &copies[..copies.len() - keep] {
        let _ = tokio::fs::remove_file(path).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn writes_one_copy_a_day_and_keeps_seven() {
        let directory = std::env::temp_dir().join(format!("luft-auto-backup-{}", uuid::Uuid::new_v4().simple()));
        let store = Store::open(&directory.join("social.sqlite")).await.unwrap();
        let backups = directory.join("backups");
        tokio::fs::create_dir_all(&backups).await.unwrap();
        for day in 1..=8 {
            tokio::fs::write(backups.join(format!("social-2026-01-0{day}.sqlite")), b"old").await.unwrap();
        }
        tokio::fs::write(backups.join("notes.txt"), b"keep").await.unwrap();
        assert!(store.daily_backup().await.unwrap().is_some());
        assert!(store.daily_backup().await.unwrap().is_none(), "only once a day");
        let (count, newest) = store.backup_status().await;
        assert_eq!(count, 7);
        assert!(newest.is_some());
        assert!(tokio::fs::try_exists(backups.join("notes.txt")).await.unwrap());
        let today = backups.join(format!("social-{}.sqlite", chrono::Utc::now().format("%Y-%m-%d")));
        assert!(tokio::fs::read(&today).await.unwrap().starts_with(b"SQLite format 3"));
        drop(store);
        let _ = std::fs::remove_dir_all(directory);
    }
}
