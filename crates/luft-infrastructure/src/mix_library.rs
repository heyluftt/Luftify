use crate::database::{Database, DatabaseError};

impl Database {
    pub async fn mix_library(&self) -> Result<Option<String>, DatabaseError> {
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'discovery.library.v1'")
            .fetch_optional(self.pool())
            .await
            .map_err(Into::into)
    }

    /// Compare-and-swap: a second app instance must not overwrite newer mixes.
    pub async fn save_mix_library(
        &self,
        value: &str,
        expected: Option<&str>,
    ) -> Result<bool, DatabaseError> {
        let result = if let Some(expected) = expected {
            sqlx::query("UPDATE settings SET value = ?, updated_at = unixepoch() WHERE key = 'discovery.library.v1' AND value = ?")
                .bind(value).bind(expected).execute(self.pool()).await?
        } else {
            sqlx::query("INSERT INTO settings(key, value, updated_at) VALUES('discovery.library.v1', ?, unixepoch()) ON CONFLICT(key) DO NOTHING")
                .bind(value).execute(self.pool()).await?
        };
        Ok(result.rows_affected() == 1)
    }
}
