use luft_listen_together::{server_now_ms, social::MAX_FRIENDS};
use sqlx::{Row, SqliteConnection};
use uuid::Uuid;

use super::{ApiError, ApiResult};

pub(super) fn pair<'a>(one: &'a str, other: &'a str) -> (&'a str, &'a str) {
    if one < other {
        (one, other)
    } else {
        (other, one)
    }
}

pub(super) async fn exists(conn: &mut SqliteConnection, id: &str) -> ApiResult<()> {
    if sqlx::query_scalar::<_, i64>("SELECT 1 FROM profiles WHERE id = ?")
        .bind(id)
        .fetch_optional(conn)
        .await?
        .is_none()
    {
        return Err(ApiError::missing("notFound"));
    }
    Ok(())
}

pub(super) async fn blocked(conn: &mut SqliteConnection, me: &str, other: &str) -> ApiResult<bool> {
    Ok(sqlx::query_scalar::<_, i64>("SELECT 1 FROM blocks WHERE (blocker = ? AND blocked = ?) OR (blocker = ? AND blocked = ?) LIMIT 1")
        .bind(me).bind(other).bind(other).bind(me).fetch_optional(conn).await?.is_some())
}

pub(super) async fn friends(conn: &mut SqliteConnection, me: &str, other: &str) -> ApiResult<bool> {
    let (a, b) = pair(me, other);
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT 1 FROM friendships WHERE a = ? AND b = ?")
            .bind(a)
            .bind(b)
            .fetch_optional(conn)
            .await?
            .is_some(),
    )
}

async fn capacity(conn: &mut SqliteConnection, id: &str) -> ApiResult<()> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM friendships WHERE a = ? OR b = ?")
        .bind(id)
        .bind(id)
        .fetch_one(conn)
        .await?;
    if count as usize >= MAX_FRIENDS {
        return Err(ApiError::limited());
    }
    Ok(())
}

pub(super) async fn request(conn: &mut SqliteConnection, me: &str, code: &str) -> ApiResult<()> {
    // Generated codes and Luft's custom codes share one format.
    let code = code.trim().to_ascii_uppercase();
    if !luft_listen_together::social::valid_friend_code(&code) {
        return Err(ApiError::bad("notFound"));
    }
    let other: String = sqlx::query_scalar("SELECT id FROM profiles WHERE friend_code = ?")
        .bind(code)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| ApiError::missing("notFound"))?;
    if me == other {
        return Err(ApiError::bad("selfRequest"));
    }
    if blocked(conn, me, &other).await? {
        return Err(ApiError::denied("blocked"));
    }
    if friends(conn, me, &other).await? {
        return Err(ApiError::bad("alreadyFriends"));
    }
    let pending = sqlx::query_scalar::<_, i64>("SELECT 1 FROM requests WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?) LIMIT 1")
        .bind(me).bind(&other).bind(&other).bind(me).fetch_optional(&mut *conn).await?.is_some();
    if pending {
        return Err(ApiError::bad("requestExists"));
    }
    capacity(conn, me).await?;
    capacity(conn, &other).await?;
    for id in [me, &other] {
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM requests WHERE sender = ? OR recipient = ?")
                .bind(id)
                .bind(id)
                .fetch_one(&mut *conn)
                .await?;
        if count >= 100 {
            return Err(ApiError::limited());
        }
    }
    sqlx::query("INSERT INTO requests (id,sender,recipient,created_at) VALUES(?,?,?,?)")
        .bind(Uuid::new_v4().to_string())
        .bind(me)
        .bind(other)
        .bind(server_now_ms())
        .execute(conn)
        .await?;
    Ok(())
}

pub(super) async fn respond(
    conn: &mut SqliteConnection,
    me: &str,
    request_id: &str,
    accept: bool,
) -> ApiResult<()> {
    let row = sqlx::query("SELECT sender FROM requests WHERE id = ? AND recipient = ?")
        .bind(request_id)
        .bind(me)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| ApiError::missing("invalidRequest"))?;
    let sender: String = row.get("sender");
    if accept {
        if blocked(conn, me, &sender).await? {
            return Err(ApiError::denied("blocked"));
        }
        capacity(conn, me).await?;
        capacity(conn, &sender).await?;
        let (a, b) = pair(me, &sender);
        sqlx::query("INSERT OR IGNORE INTO friendships (a,b,since) VALUES(?,?,?)")
            .bind(a)
            .bind(b)
            .bind(server_now_ms())
            .execute(&mut *conn)
            .await?;
    }
    sqlx::query("DELETE FROM requests WHERE id = ?")
        .bind(request_id)
        .execute(conn)
        .await?;
    Ok(())
}

pub(super) async fn remove(conn: &mut SqliteConnection, me: &str, other: &str) -> ApiResult<()> {
    let (a, b) = pair(me, other);
    sqlx::query("DELETE FROM friendships WHERE a = ? AND b = ?")
        .bind(a)
        .bind(b)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM invitations WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)")
        .bind(me).bind(other).bind(other).bind(me).execute(&mut *conn).await?;
    super::playlist_shares::forget_between(&mut *conn, me, other).await?;
    // A new friendship starts with everything shared again.
    sqlx::query("DELETE FROM listening_hidden WHERE (owner = ? AND viewer = ?) OR (owner = ? AND viewer = ?)")
        .bind(me).bind(other).bind(other).bind(me).execute(conn).await?;
    Ok(())
}

/// Whether `owner` hides their listening from `viewer`.
pub(super) async fn listening_hidden(conn: &mut SqliteConnection, owner: &str, viewer: &str) -> ApiResult<bool> {
    Ok(sqlx::query_scalar::<_, i64>("SELECT 1 FROM listening_hidden WHERE owner = ? AND viewer = ?")
        .bind(owner).bind(viewer).fetch_optional(conn).await?.is_some())
}

pub(super) async fn block(conn: &mut SqliteConnection, me: &str, other: &str) -> ApiResult<()> {
    if me == other {
        return Err(ApiError::bad("selfRequest"));
    }
    exists(conn, other).await?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM blocks WHERE blocker = ?")
        .bind(me)
        .fetch_one(&mut *conn)
        .await?;
    if count >= 200 {
        return Err(ApiError::limited());
    }
    sqlx::query("INSERT OR IGNORE INTO blocks (blocker,blocked) VALUES(?,?)")
        .bind(me)
        .bind(other)
        .execute(&mut *conn)
        .await?;
    remove(conn, me, other).await?;
    sqlx::query("DELETE FROM requests WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)")
        .bind(me).bind(other).bind(other).bind(me).execute(conn).await?;
    Ok(())
}
