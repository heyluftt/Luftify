use super::{ApiError, ApiResult, SharedState, Store, profiles, relations};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use axum::{
    extract::Request,
    http::{HeaderValue, header},
    middleware::Next,
    response::Response,
};
use luft_listen_together::{
    chat::{
        CHAT_PAGE_SIZE, ChatConversation, ChatMessage, ChatPage, ChatRead, ChatSend, MAX_CHAT_CHARS,
    },
    server_now_ms,
};
use serde::Deserialize;
use sqlx::{Row, SqliteConnection, sqlite::SqliteRow};
use uuid::Uuid;

pub(super) async fn private_response(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[derive(Default, Deserialize)]
pub(super) struct Cursor {
    pub before: Option<i64>,
    pub after: Option<i64>,
}

pub(super) async fn inbox(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<ChatConversation>>> {
    let me = state.store.authenticate(&headers).await?;
    Ok(Json(state.store.chat_inbox(&me).await?))
}

pub(super) async fn messages(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(peer): Path<String>,
    Query(cursor): Query<Cursor>,
) -> ApiResult<Json<ChatPage>> {
    let me = state.store.authenticate(&headers).await?;
    Ok(Json(state.store.chat_page(&me, &peer, cursor).await?))
}

pub(super) async fn send(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(peer): Path<String>,
    Json(input): Json<ChatSend>,
) -> ApiResult<Json<ChatMessage>> {
    let me = state.store.authenticate(&headers).await?;
    let sent = state.store.chat_send(&me, &peer, input).await?;
    // The friend's devices and this profile's other devices show it at once.
    state.remote.chat_changed(&peer, &me).await;
    state.remote.chat_changed(&me, &peer).await;
    Ok(Json(sent))
}

pub(super) async fn read(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(peer): Path<String>,
    Json(input): Json<ChatRead>,
) -> ApiResult<Json<ChatRead>> {
    let me = state.store.authenticate(&headers).await?;
    let read = state.store.chat_read(&me, &peer, input.through).await?;
    // The friend sees "seen", this profile's other devices drop the unread mark.
    state.remote.chat_changed(&peer, &me).await;
    state.remote.chat_changed(&me, &peer).await;
    Ok(Json(read))
}

async fn access(conn: &mut SqliteConnection, me: &str, peer: &str) -> ApiResult<()> {
    if me == peer || Uuid::parse_str(peer).is_err() {
        return Err(ApiError::bad("invalidMessage"));
    }
    if relations::blocked(conn, me, peer).await? {
        return Err(ApiError::denied("blocked"));
    }
    if !relations::friends(conn, me, peer).await? {
        return Err(ApiError::denied("notFriends"));
    }
    let suspended: i64 = sqlx::query_scalar("SELECT suspended FROM profiles WHERE id=?")
        .bind(peer)
        .fetch_one(conn)
        .await?;
    if suspended != 0 {
        return Err(ApiError::denied("suspended"));
    }
    Ok(())
}

fn message(row: &SqliteRow) -> ChatMessage {
    ChatMessage {
        id: row.get("id"),
        client_id: row.get("client_id"),
        sender_id: row.get("sender"),
        body: row.get("body"),
        created_at_ms: row.get("created_at"),
    }
}

impl Store {
    pub(super) async fn chat_inbox(&self, me: &str) -> ApiResult<Vec<ChatConversation>> {
        let _guard = self.mutations.lock().await;
        let rows = sqlx::query("SELECT p.*, m.id AS message_id,m.client_id AS message_client,m.sender AS message_sender,m.body AS message_body,m.created_at AS message_time,i.id AS incoming_id,i.client_id AS incoming_client,i.sender AS incoming_sender,i.body AS incoming_body,i.created_at AS incoming_time,(SELECT COUNT(*) FROM chat_messages c WHERE c.a=f.a AND c.b=f.b AND c.recipient=? AND c.id>COALESCE(r.last_id,0)) AS unread,COALESCE(pr.last_id,0) AS peer_read FROM friendships f JOIN profiles p ON p.id=CASE WHEN f.a=? THEN f.b ELSE f.a END LEFT JOIN chat_messages m ON m.id=(SELECT id FROM chat_messages WHERE a=f.a AND b=f.b ORDER BY id DESC LIMIT 1) LEFT JOIN chat_messages i ON i.id=(SELECT id FROM chat_messages WHERE a=f.a AND b=f.b AND recipient=? ORDER BY id DESC LIMIT 1) LEFT JOIN chat_reads r ON r.profile_id=? AND r.peer_id=p.id LEFT JOIN chat_reads pr ON pr.profile_id=p.id AND pr.peer_id=? WHERE (f.a=? OR f.b=?) AND p.suspended=0 AND NOT EXISTS(SELECT 1 FROM blocks WHERE (blocker=? AND blocked=p.id) OR (blocker=p.id AND blocked=?)) ORDER BY COALESCE(m.id,0) DESC,p.display_name COLLATE NOCASE")
            .bind(me).bind(me).bind(me).bind(me).bind(me).bind(me).bind(me).bind(me).bind(me).fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|row| ChatConversation {
                profile: profiles::profile(row),
                last_message: row
                    .get::<Option<i64>, _>("message_id")
                    .map(|id| ChatMessage {
                        id,
                        client_id: row.get("message_client"),
                        sender_id: row.get("message_sender"),
                        body: row.get("message_body"),
                        created_at_ms: row.get("message_time"),
                    }),
                last_incoming: row
                    .get::<Option<i64>, _>("incoming_id")
                    .map(|id| ChatMessage {
                        id,
                        client_id: row.get("incoming_client"),
                        sender_id: row.get("incoming_sender"),
                        body: row.get("incoming_body"),
                        created_at_ms: row.get("incoming_time"),
                    }),
                unread: row.get::<i64, _>("unread").clamp(0, u32::MAX as i64) as u32,
                peer_read: row.get("peer_read"),
            })
            .collect())
    }

    pub(super) async fn chat_page(
        &self,
        me: &str,
        peer: &str,
        cursor: Cursor,
    ) -> ApiResult<ChatPage> {
        if (cursor.before.is_some() && cursor.after.is_some())
            || cursor.before.into_iter().chain(cursor.after).any(|n| n < 0)
        {
            return Err(ApiError::bad("invalidMessage"));
        }
        let _guard = self.mutations.lock().await;
        let mut conn = self.pool.acquire().await?;
        access(&mut conn, me, peer).await?;
        let (a, b) = relations::pair(me, peer);
        let query = if cursor.after.is_some() {
            "SELECT * FROM chat_messages WHERE a=? AND b=? AND id>? ORDER BY id ASC LIMIT ?"
        } else {
            "SELECT * FROM chat_messages WHERE a=? AND b=? AND id<? ORDER BY id DESC LIMIT ?"
        };
        let mut rows = sqlx::query(query)
            .bind(a)
            .bind(b)
            .bind(cursor.after.or(cursor.before).unwrap_or(i64::MAX))
            .bind((CHAT_PAGE_SIZE + 1) as i64)
            .fetch_all(&mut *conn)
            .await?;
        let has_more = rows.len() > CHAT_PAGE_SIZE;
        rows.truncate(CHAT_PAGE_SIZE);
        if cursor.after.is_none() {
            rows.reverse();
        }
        Ok(ChatPage {
            messages: rows.iter().map(message).collect(),
            has_more,
        })
    }

    pub(super) async fn chat_send(
        &self,
        me: &str,
        peer: &str,
        mut input: ChatSend,
    ) -> ApiResult<ChatMessage> {
        input.client_id = Uuid::parse_str(&input.client_id)
            .map_err(|_| ApiError::bad("invalidMessage"))?
            .to_string();
        let body = input.body.replace("\r\n", "\n").trim().to_owned();
        if body.is_empty()
            || body.chars().count() > MAX_CHAT_CHARS
            || body
                .chars()
                .any(|c| c.is_control() && c != '\n' && c != '\t')
        {
            return Err(ApiError::bad("invalidMessage"));
        }
        let _guard = self.mutations.lock().await;
        let mut conn = self.pool.acquire().await?;
        access(&mut conn, me, peer).await?;
        // Retry before the budget check: an acknowledged message costs nothing twice.
        if let Some(row) = sqlx::query("SELECT * FROM chat_messages WHERE sender=? AND client_id=?")
            .bind(me)
            .bind(&input.client_id)
            .fetch_optional(&mut *conn)
            .await?
        {
            if row.get::<String, _>("recipient") != peer || row.get::<String, _>("body") != body {
                return Err(ApiError::bad("invalidMessage"));
            }
            return Ok(message(&row));
        }
        let now = server_now_ms();
        let recent: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM chat_messages WHERE sender=? AND created_at>?",
        )
        .bind(me)
        .bind(now - 60_000)
        .fetch_one(&mut *conn)
        .await?;
        let daily: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM chat_messages WHERE sender=? AND created_at>?",
        )
        .bind(me)
        .bind(now - 86_400_000)
        .fetch_one(&mut *conn)
        .await?;
        if recent >= 30 || daily >= 2000 {
            return Err(ApiError::limited());
        }
        let (a, b) = relations::pair(me, peer);
        let row = sqlx::query("INSERT INTO chat_messages(sender,recipient,a,b,client_id,body,created_at) VALUES(?,?,?,?,?,?,?) RETURNING *")
            .bind(me).bind(peer).bind(a).bind(b).bind(&input.client_id).bind(body).bind(now).fetch_one(&mut *conn).await?;
        Ok(message(&row))
    }

    pub(super) async fn chat_read(
        &self,
        me: &str,
        peer: &str,
        through: i64,
    ) -> ApiResult<ChatRead> {
        if through <= 0 {
            return Err(ApiError::bad("invalidMessage"));
        }
        let _guard = self.mutations.lock().await;
        let mut conn = self.pool.acquire().await?;
        access(&mut conn, me, peer).await?;
        let (a, b) = relations::pair(me, peer);
        // A cursor from another conversation must never acknowledge unseen messages here.
        let valid: Option<i64> =
            sqlx::query_scalar("SELECT id FROM chat_messages WHERE id=? AND a=? AND b=?")
                .bind(through)
                .bind(a)
                .bind(b)
                .fetch_optional(&mut *conn)
                .await?;
        if valid.is_none() {
            return Err(ApiError::bad("invalidMessage"));
        }
        sqlx::query("INSERT INTO chat_reads(profile_id,peer_id,last_id) VALUES(?,?,?) ON CONFLICT(profile_id,peer_id) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)").bind(me).bind(peer).bind(through).execute(&mut *conn).await?;
        let through =
            sqlx::query_scalar("SELECT last_id FROM chat_reads WHERE profile_id=? AND peer_id=?")
                .bind(me)
                .bind(peer)
                .fetch_one(&mut *conn)
                .await?;
        Ok(ChatRead { through })
    }
}
