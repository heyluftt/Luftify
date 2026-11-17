use luft_listen_together::admin::Moderation;

use super::*;

#[tokio::test]
async fn a_recovery_code_moves_the_profile_and_signs_out_the_old_device() {
    let store = Store::memory().await;
    let old = user(&store, "Sam").await;
    let id = &old.snapshot.me.id;
    let new_key = "c".repeat(64);
    assert_eq!(store.restore("ABCD-EFGH-JKLM-NPQR-STUV", Some(&new_key)).await.err().unwrap().code, "invalidRecoveryCode");

    let first = store.new_recovery_code(id).await.unwrap();
    let code = store.new_recovery_code(id).await.unwrap();
    assert_eq!(store.restore(&first, Some(&new_key)).await.err().unwrap().code, "invalidRecoveryCode");
    assert_eq!(store.restore(&code, None).await.err().unwrap().code, "invalidProfile");

    let typed = code.to_lowercase().replace('-', " ");
    let restored = store.restore(&typed, Some(&new_key)).await.unwrap();
    assert_eq!((&restored.snapshot.me.id, restored.token.as_str()), (id, new_key.as_str()));
    assert_eq!(store.authenticate(&headers(&new_key)).await.unwrap(), *id);
    assert_eq!(store.authenticate(&headers(&old.token)).await.unwrap_err().code, "unauthorized");
    let stored: Option<String> = sqlx::query_scalar("SELECT recovery_hash FROM profiles").fetch_one(&store.pool).await.unwrap();
    assert!(stored.is_some_and(|hash| !hash.contains(&code) && hash.len() == 64));

    // Suspended profiles stay suspended on a new device too.
    let luft = user(&store, "Luft").await;
    store.grant_owner(&luft.snapshot.me.friend_code).await.unwrap();
    store.action(&luft.snapshot.me.id, SocialAction::Moderate { profile_id: id.clone(), moderation: Moderation::Suspend }).await.unwrap();
    assert_eq!(store.restore(&code, Some(&"d".repeat(64))).await.err().unwrap().code, "suspended");
}
