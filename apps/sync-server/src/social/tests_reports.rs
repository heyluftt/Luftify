use luft_listen_together::{ProblemReportInput, reports::REPORTS_PER_DAY};

use super::*;

fn report(message: &str) -> ProblemReportInput {
    ProblemReportInput { message: message.into(), app_version: "0.1.5".into(), diagnostics: r#"{"log":{}}"#.into() }
}

#[tokio::test]
async fn only_friends_of_luft_report_and_only_luft_reads() {
    let store = Store::memory().await;
    let luft = user(&store, "Luft").await;
    let friend = user(&store, "Friend").await;
    let stranger = user(&store, "Stranger").await;
    befriend(&store, &luft, &friend).await;
    let (luft_id, friend_id, stranger_id) = (&luft.snapshot.me.id, &friend.snapshot.me.id, &stranger.snapshot.me.id);

    // Before the owner code is confirmed nobody may send.
    assert_eq!(store.submit_report(friend_id, report("vorher")).await.unwrap_err().code, "notAllowed");
    assert!(store.grant_owner(&luft.snapshot.me.friend_code).await.unwrap());

    let sent = store.submit_report(friend_id, report("  Ton bricht ab  ")).await.unwrap();
    assert_eq!((sent.reporter_name.as_str(), sent.message.as_str(), sent.has_diagnostics), ("Friend", "Ton bricht ab", true));
    assert_eq!(store.submit_report(stranger_id, report("spam")).await.unwrap_err().code, "notAllowed");
    assert_eq!(store.submit_report(friend_id, report("   ")).await.unwrap_err().code, "invalidReport");
    store.submit_report(luft_id, report("selbst getestet")).await.unwrap();

    assert_eq!(store.reports(friend_id).await.unwrap_err().code, "notAllowed");
    assert_eq!(store.report(friend_id, &sent.id).await.unwrap_err().code, "notAllowed");
    assert_eq!(store.delete_report(friend_id, &sent.id).await.unwrap_err().code, "notAllowed");

    let listed = store.reports(luft_id).await.unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(store.report(luft_id, &sent.id).await.unwrap().diagnostics, r#"{"log":{}}"#);
    store.delete_report(luft_id, &sent.id).await.unwrap();
    assert_eq!(store.report(luft_id, &sent.id).await.unwrap_err().code, "notFound");
}

#[tokio::test]
async fn reports_per_day_are_limited() {
    let store = Store::memory().await;
    let luft = user(&store, "Luft").await;
    let friend = user(&store, "Friend").await;
    befriend(&store, &luft, &friend).await;
    assert!(store.grant_owner(&luft.snapshot.me.friend_code).await.unwrap());
    for n in 0..REPORTS_PER_DAY {
        store.submit_report(&friend.snapshot.me.id, report(&format!("Nummer {n}"))).await.unwrap();
    }
    let limited = store.submit_report(&friend.snapshot.me.id, report("noch eine")).await.unwrap_err();
    assert_eq!(limited.code, "limitReached");
    // Another friend still has their own budget.
    let other = user(&store, "Other").await;
    befriend(&store, &luft, &other).await;
    store.submit_report(&other.snapshot.me.id, report("eigene")).await.unwrap();
}
