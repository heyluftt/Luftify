use luft_listen_together::ProfileStyle;

use super::*;

#[tokio::test]
async fn achievements_unlock_once_and_unlock_their_rewards() {
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let two = user(&store, "Two").await;
    let id = &one.snapshot.me.id;
    let progress = |snapshot: &luft_listen_together::SocialSnapshot, key: &str| {
        snapshot.achievement_progress.iter().find(|state| state.id == key).map(|state| (state.progress, state.goal, state.unlocked_at_ms.is_some())).unwrap()
    };

    let fresh = store.snapshot(id).await.unwrap();
    assert!(fresh.me.achievements.is_empty());
    assert_eq!(progress(&fresh, "circle"), (0, 5, false));

    befriend(&store, &one, &two).await;
    let befriended = store.snapshot(id).await.unwrap();
    assert_eq!(befriended.me.achievements, ["first_friend"]);
    assert_eq!(progress(&befriended, "circle"), (1, 5, false));
    // Friends see the reached achievements on the profile, too.
    assert_eq!(store.snapshot(&two.snapshot.me.id).await.unwrap().friends[0].profile.achievements, ["first_friend"]);

    // The reward frame and achievement badges need the achievement.
    let look = |frame: &str, shown: &[&str]| ProfileStyle {
        accent: "rose".into(), banner: "".into(), frame: frame.into(),
        shown_badges: Some(shown.iter().map(|key| key.to_string()).collect()), ..Default::default()
    };
    assert_eq!(store.action(id, SocialAction::SetStyle { style: Some(look("aurum", &[])) }).await.unwrap_err().code, "invalidStyle");
    assert_eq!(store.action(id, SocialAction::SetStyle { style: Some(look("", &["quest:along"])) }).await.unwrap_err().code, "invalidStyle");
    let styled = store.action(id, SocialAction::SetStyle { style: Some(look("", &["quest:first_friend"])) }).await.unwrap();
    assert!(styled.me.achievements.contains(&"styled".to_string()));

    // Reached once: the time stays the first one.
    let at = progress(&store.snapshot(id).await.unwrap(), "first_friend");
    assert!(store.unlock(id, "first_friend").await.unwrap() == false && at.2);

    // Five others make the collector, which unlocks the frame.
    for key in ["song", "together", "along"] { store.unlock(id, key).await.unwrap(); }
    let collected = store.snapshot(id).await.unwrap();
    assert!(collected.me.achievements.contains(&"collector".to_string()));
    store.action(id, SocialAction::SetStyle { style: Some(look("aurum", &[])) }).await.unwrap();
}
