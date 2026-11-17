//! Achievements, decided here and nowhere else: the snapshot checks the goals
//! it can see (friends, look, profile song, other achievements); listening
//! along and rooms unlock theirs where they happen. Each is stored once with
//! its time in `profiles.achievements`.
use luft_listen_together::{
    achievements::{ACHIEVEMENTS, AchievementState, CIRCLE_GOAL, COLLECTOR_GOAL, parse_unlocked, store_unlocked},
    server_now_ms,
};
use sqlx::{Row, sqlite::SqliteRow};

use super::{ApiResult, Store};

pub(super) fn unlocked(row: &SqliteRow) -> Vec<(String, i64)> {
    parse_unlocked(&row.try_get::<String, _>("achievements").unwrap_or_default())
}

impl Store {
    /// Records one reached achievement, once; true when it is new.
    pub(super) async fn unlock(&self, me: &str, id: &str) -> ApiResult<bool> {
        let stored: Option<String> = sqlx::query_scalar("SELECT achievements FROM profiles WHERE id = ?")
            .bind(me).fetch_optional(&self.pool).await?;
        let Some(stored) = stored else { return Ok(false) };
        let mut list = parse_unlocked(&stored);
        if list.iter().any(|(known, _)| known == id) {
            return Ok(false);
        }
        list.push((id.to_owned(), server_now_ms()));
        sqlx::query("UPDATE profiles SET achievements = ? WHERE id = ?")
            .bind(store_unlocked(&list)).bind(me).execute(&self.pool).await?;
        Ok(true)
    }

    /// Unlocks what the snapshot can tell, then the owner's view with progress.
    pub(super) async fn review_achievements(&self, me: &str, own: &SqliteRow, friends: usize) -> ApiResult<(Vec<String>, Vec<AchievementState>)> {
        let friends = friends as u32;
        let reached = |id: &str| match id {
            "first_friend" => friends >= 1,
            "circle" => friends >= CIRCLE_GOAL,
            "styled" => own.get::<Option<String>, _>("look").is_some() || own.get::<Option<String>, _>("accent").is_some(),
            "song" => own.get::<Option<String>, _>("favorite").is_some(),
            _ => false,
        };
        let mut list = unlocked(own);
        for id in ACHIEVEMENTS {
            if reached(id) && !list.iter().any(|(known, _)| known == id) && self.unlock(me, id).await? {
                list.push((id.to_owned(), server_now_ms()));
            }
        }
        let others = list.iter().filter(|(id, _)| id != "collector").count() as u32;
        if others >= COLLECTOR_GOAL && !list.iter().any(|(id, _)| id == "collector") && self.unlock(me, "collector").await? {
            list.push(("collector".into(), server_now_ms()));
        }
        let progress = ACHIEVEMENTS
            .iter()
            .map(|id| {
                let unlocked_at_ms = list.iter().find(|(known, _)| known == id).map(|(_, at)| *at);
                let (progress, goal) = match *id {
                    "circle" => (friends.min(CIRCLE_GOAL), CIRCLE_GOAL),
                    "collector" => (others.min(COLLECTOR_GOAL), COLLECTOR_GOAL),
                    _ => (u32::from(unlocked_at_ms.is_some()), 1),
                };
                AchievementState { id: (*id).into(), unlocked_at_ms, progress: if unlocked_at_ms.is_some() { goal } else { progress }, goal }
            })
            .collect();
        Ok((list.into_iter().map(|(id, _)| id).collect(), progress))
    }
}
