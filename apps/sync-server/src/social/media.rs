//! Profile media: moving pictures and own banners, stored as files next to
//! the social database. Only the owner uploads; any signed-in profile loads
//! them by id. Bounded by size per kind, uploads per profile and day, and a
//! total budget for the volume. Files no look refers to are removed a few
//! hours after their upload.
use axum::http::StatusCode;
use luft_listen_together::{
    ProfileStyle, server_now_ms,
    media::{MAX_MEDIA_TOTAL_BYTES, MEDIA_UPLOADS_PER_DAY, MediaKind, MediaUpload, content_type, media_extension, sniff_extension},
};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqliteConnection};

use super::{ApiError, ApiResult, Store};

const HOUR_MS: i64 = 60 * 60_000;
const DAY_MS: i64 = 24 * HOUR_MS;
/// Long enough to finish editing a profile after picking a file.
const UNUSED_FOR_MS: i64 = 6 * HOUR_MS;

impl Store {
    pub async fn upload_media(&self, me: &str, kind: MediaKind, bytes: &[u8]) -> ApiResult<MediaUpload> {
        if bytes.len() > kind.max_bytes() {
            return Err(ApiError::bad("mediaTooLarge"));
        }
        let extension = sniff_extension(bytes)
            .filter(|extension| kind.allows(extension))
            .ok_or_else(|| ApiError::bad("invalidMedia"))?;
        // Per owner and kind, so one profile's files never depend on another's.
        let hash = Sha256::new().chain_update(me.as_bytes()).chain_update([0]).chain_update(kind.key()).chain_update([0]).chain_update(bytes).finalize();
        let id = format!("{}.{extension}", &format!("{hash:x}")[..32]);
        let _lock = self.mutations.lock().await;
        let mut conn = self.pool.acquire().await?;
        let now = server_now_ms();
        let today: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media_uploads WHERE owner = ? AND created_at > ?")
            .bind(me).bind(now - DAY_MS).fetch_one(&mut *conn).await?;
        if today >= MEDIA_UPLOADS_PER_DAY {
            return Err(ApiError::limited());
        }
        let known: Option<String> = sqlx::query_scalar("SELECT id FROM media WHERE id = ?").bind(&id).fetch_optional(&mut *conn).await?;
        if known.is_some() {
            sqlx::query("UPDATE media SET created_at = ? WHERE id = ?").bind(now).bind(&id).execute(&mut *conn).await?;
        } else {
            let total: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(bytes), 0) FROM media").fetch_one(&mut *conn).await?;
            if total + bytes.len() as i64 > MAX_MEDIA_TOTAL_BYTES {
                return Err(ApiError { status: StatusCode::INSUFFICIENT_STORAGE, code: "storageFull" });
            }
            self.write_media(&id, bytes).await?;
            sqlx::query("INSERT INTO media (id, owner, kind, bytes, created_at) VALUES (?, ?, ?, ?, ?)")
                .bind(&id).bind(me).bind(kind.key()).bind(bytes.len() as i64).bind(now)
                .execute(&mut *conn).await?;
        }
        sqlx::query("INSERT INTO media_uploads (owner, created_at) VALUES (?, ?)").bind(me).bind(now).execute(&mut *conn).await?;
        Ok(MediaUpload { id })
    }

    pub async fn media(&self, id: &str) -> ApiResult<(Vec<u8>, &'static str)> {
        let extension = media_extension(id).ok_or_else(|| ApiError::missing("notFound"))?;
        let bytes = tokio::fs::read(self.media_dir.join(id)).await.map_err(|_| ApiError::missing("notFound"))?;
        Ok((bytes, content_type(extension)))
    }

    async fn write_media(&self, id: &str, bytes: &[u8]) -> ApiResult<()> {
        let failed = |_| ApiError { status: StatusCode::SERVICE_UNAVAILABLE, code: "unavailable" };
        tokio::fs::create_dir_all(&self.media_dir).await.map_err(failed)?;
        let temp = self.media_dir.join(format!(".{id}.upload"));
        tokio::fs::write(&temp, bytes).await.map_err(failed)?;
        tokio::fs::rename(&temp, self.media_dir.join(id)).await.map_err(failed)
    }

    /// Files that no current look names, once they had time to be used.
    pub(super) async fn forget_unused_media(&self) -> ApiResult<()> {
        let now = server_now_ms();
        let rows = sqlx::query("SELECT m.id, p.look FROM media m LEFT JOIN profiles p ON p.id = m.owner WHERE m.created_at < ?")
            .bind(now - UNUSED_FOR_MS).fetch_all(&self.pool).await?;
        for row in rows {
            let id: String = row.get("id");
            let used = row.get::<Option<String>, _>("look")
                .and_then(|look| serde_json::from_str::<ProfileStyle>(&look).ok())
                .is_some_and(|look| look.media().any(|(used, _)| used == id));
            if !used {
                let _ = tokio::fs::remove_file(self.media_dir.join(&id)).await;
                sqlx::query("DELETE FROM media WHERE id = ?").bind(&id).execute(&self.pool).await?;
            }
        }
        sqlx::query("DELETE FROM media_uploads WHERE created_at < ?").bind(now - DAY_MS).execute(&self.pool).await?;
        Ok(())
    }
}

/// A look may only name files its owner uploaded, each in its own role.
pub(super) async fn check_owned(conn: &mut SqliteConnection, me: &str, style: &ProfileStyle) -> ApiResult<()> {
    for (id, kind) in style.media() {
        let stored: Option<String> = sqlx::query_scalar("SELECT kind FROM media WHERE id = ? AND owner = ?")
            .bind(id).bind(me).fetch_optional(&mut *conn).await?;
        if stored.as_deref() != Some(kind.key()) {
            return Err(ApiError::bad("invalidMedia"));
        }
    }
    Ok(())
}
