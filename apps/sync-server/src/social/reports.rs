//! Problem reports: only Luft's friends (and Luft) may send, a few a day each,
//! with a cap on what is stored; only Luft reads and clears them.
use luft_listen_together::{
    ProblemReport, ProblemReportInput, ProblemReportSummary, server_now_ms,
    reports::{MAX_STORED_REPORTS, REPORT_TTL_MS, REPORTS_PER_DAY},
    social::SocialRole,
};
use sqlx::{Row, SqliteConnection, sqlite::SqliteRow};
use uuid::Uuid;

use super::{ApiError, ApiResult, Store, roles};

const DAY_MS: i64 = 24 * 60 * 60_000;

impl Store {
    pub async fn submit_report(&self, me: &str, mut input: ProblemReportInput) -> ApiResult<ProblemReportSummary> {
        if !input.validate() {
            return Err(ApiError::bad("invalidReport"));
        }
        let _lock = self.mutations.lock().await;
        let mut conn = self.pool.acquire().await?;
        if !may_report(&mut conn, me).await? {
            return Err(ApiError::denied("notAllowed"));
        }
        let now = server_now_ms();
        let today: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM reports WHERE reporter = ? AND created_at > ?")
            .bind(me).bind(now - DAY_MS).fetch_one(&mut *conn).await?;
        if today >= REPORTS_PER_DAY {
            return Err(ApiError::limited());
        }
        let stored: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM reports").fetch_one(&mut *conn).await?;
        if stored >= MAX_STORED_REPORTS {
            return Err(ApiError::limited());
        }
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO reports (id,reporter,message,app_version,diagnostics,created_at) VALUES(?,?,?,?,?,?)")
            .bind(&id).bind(me).bind(&input.message).bind(&input.app_version).bind(&input.diagnostics).bind(now)
            .execute(&mut *conn).await?;
        let row = sqlx::query(&format!("{SUMMARY} WHERE r.id = ?")).bind(&id).fetch_one(&mut *conn).await?;
        Ok(summary(&row))
    }

    pub async fn reports(&self, me: &str) -> ApiResult<Vec<ProblemReportSummary>> {
        let mut conn = self.pool.acquire().await?;
        roles::require_luft(&mut conn, me).await?;
        let rows = sqlx::query(&format!("{SUMMARY} ORDER BY r.created_at DESC LIMIT ?"))
            .bind(MAX_STORED_REPORTS).fetch_all(&mut *conn).await?;
        Ok(rows.iter().map(summary).collect())
    }

    pub async fn report(&self, me: &str, id: &str) -> ApiResult<ProblemReport> {
        let mut conn = self.pool.acquire().await?;
        roles::require_luft(&mut conn, me).await?;
        let row = sqlx::query(&format!("{SUMMARY} WHERE r.id = ?"))
            .bind(id).fetch_optional(&mut *conn).await?
            .ok_or_else(|| ApiError::missing("notFound"))?;
        Ok(ProblemReport { summary: summary(&row), diagnostics: row.get("diagnostics") })
    }

    pub async fn delete_report(&self, me: &str, id: &str) -> ApiResult<()> {
        let mut conn = self.pool.acquire().await?;
        roles::require_luft(&mut conn, me).await?;
        sqlx::query("DELETE FROM reports WHERE id = ?").bind(id).execute(&mut *conn).await?;
        Ok(())
    }

    pub(super) async fn forget_old_reports(&self) -> ApiResult<()> {
        sqlx::query("DELETE FROM reports WHERE created_at < ?")
            .bind(server_now_ms() - REPORT_TTL_MS)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

const SUMMARY: &str = "SELECT r.id, r.reporter, p.display_name, r.message, r.app_version, r.diagnostics, r.created_at FROM reports r JOIN profiles p ON p.id = r.reporter";

fn summary(row: &SqliteRow) -> ProblemReportSummary {
    let diagnostics: String = row.get("diagnostics");
    ProblemReportSummary {
        id: row.get("id"),
        reporter_id: row.get("reporter"),
        reporter_name: row.get("display_name"),
        message: row.get("message"),
        app_version: row.get("app_version"),
        created_at_ms: row.get("created_at"),
        has_diagnostics: !diagnostics.is_empty(),
    }
}

/// Luft, or a confirmed friend of a Luft profile.
async fn may_report(conn: &mut SqliteConnection, me: &str) -> ApiResult<bool> {
    if roles::roles_of(conn, me).await?.contains(&SocialRole::Luft) {
        return Ok(true);
    }
    let friends: Vec<String> = sqlx::query_scalar(
        "SELECT p.roles FROM friendships f JOIN profiles p ON p.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END WHERE f.a = ? OR f.b = ?",
    )
    .bind(me).bind(me).bind(me).fetch_all(conn).await?;
    Ok(friends.iter().any(|roles| luft_listen_together::social::parse_roles(roles).contains(&SocialRole::Luft)))
}
