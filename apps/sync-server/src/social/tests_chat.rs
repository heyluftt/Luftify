use super::super::chat::Cursor;
use super::*;
use luft_listen_together::chat::ChatSend;
use uuid::Uuid;

fn send(body: &str) -> ChatSend {
    ChatSend {
        client_id: Uuid::new_v4().to_string(),
        body: body.into(),
    }
}

#[tokio::test]
async fn chats_are_private_idempotent_and_keep_monotonic_read_cursors() {
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let two = user(&store, "Two").await;
    let outsider = user(&store, "Outsider").await;
    let a = &one.snapshot.me.id;
    let b = &two.snapshot.me.id;
    let c = &outsider.snapshot.me.id;
    assert_eq!(
        store.chat_send(a, b, send("Hello")).await.unwrap_err().code,
        "notFriends"
    );
    befriend(&store, &one, &two).await;
    befriend(&store, &one, &outsider).await;
    let input = send(" Hi\nthere 👋 ");
    let first = store.chat_send(a, b, input.clone()).await.unwrap();
    assert_eq!(first.body, "Hi\nthere 👋");
    let (retry_one, retry_two) = tokio::join!(
        store.chat_send(a, b, input.clone()),
        store.chat_send(a, b, input.clone())
    );
    assert_eq!(retry_one.unwrap().id, first.id);
    assert_eq!(retry_two.unwrap().id, first.id);
    assert!(
        store.chat_send(a, c, input).await.is_err(),
        "same client ID cannot move a message to someone else"
    );
    let reply = store.chat_send(b, a, send("Reply")).await.unwrap();
    let inbox = store.chat_inbox(a).await.unwrap();
    assert_eq!(inbox.iter().find(|v| v.profile.id == *b).unwrap().unread, 1);
    let own_reply = store.chat_send(a, b, send("Follow-up")).await.unwrap();
    let chat = store
        .chat_inbox(a)
        .await
        .unwrap()
        .into_iter()
        .find(|v| v.profile.id == *b)
        .unwrap();
    assert_eq!(chat.last_message.unwrap().id, own_reply.id);
    assert_eq!(
        chat.last_incoming.unwrap().id,
        reply.id,
        "notifications must not lose an incoming message behind one's own reply"
    );
    assert_eq!(
        store.chat_read(a, b, reply.id).await.unwrap().through,
        reply.id
    );
    assert_eq!(
        store.chat_read(a, b, first.id).await.unwrap().through,
        reply.id
    );
    assert_eq!(
        store
            .chat_inbox(a)
            .await
            .unwrap()
            .into_iter()
            .find(|v| v.profile.id == *b)
            .unwrap()
            .unread,
        0
    );
    let other = store.chat_send(c, a, send("Different chat")).await.unwrap();
    assert!(store.chat_read(a, b, other.id).await.is_err());
    assert_eq!(
        store
            .chat_page(c, b, Cursor::default())
            .await
            .unwrap_err()
            .code,
        "notFriends"
    );
    store
        .action(
            a,
            SocialAction::Block {
                profile_id: b.clone(),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        store
            .chat_send(b, a, send("Blocked"))
            .await
            .unwrap_err()
            .code,
        "blocked"
    );
    assert_eq!(
        store
            .chat_page(b, a, Cursor::default())
            .await
            .unwrap_err()
            .code,
        "blocked"
    );
    assert!(store.chat_read(a, b, reply.id).await.is_err());
    assert!(
        !store
            .chat_inbox(a)
            .await
            .unwrap()
            .iter()
            .any(|v| v.profile.id == *b)
    );
}

#[tokio::test]
async fn pagination_returns_contiguous_ordered_pages_in_both_directions() {
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let two = user(&store, "Two").await;
    befriend(&store, &one, &two).await;
    let a = &one.snapshot.me.id;
    let b = &two.snapshot.me.id;
    let (low, high) = relations::pair(a, b);
    for n in 0..65 {
        sqlx::query("INSERT INTO chat_messages(sender,recipient,a,b,client_id,body,created_at) VALUES(?,?,?,?,?,?,?)")
            .bind(a).bind(b).bind(low).bind(high).bind(Uuid::new_v4().to_string()).bind(format!("{n}")).bind(server_now_ms()).execute(&store.pool).await.unwrap();
    }
    let newest = store.chat_page(b, a, Cursor::default()).await.unwrap();
    assert_eq!(newest.messages.len(), 50);
    assert!(newest.has_more);
    assert_eq!(newest.messages[0].body, "15");
    assert_eq!(newest.messages[49].body, "64");
    let older = store
        .chat_page(
            b,
            a,
            Cursor {
                before: Some(newest.messages[0].id),
                after: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(older.messages.len(), 15);
    assert!(!older.has_more);
    let catchup = store
        .chat_page(
            b,
            a,
            Cursor {
                before: None,
                after: Some(0),
            },
        )
        .await
        .unwrap();
    assert_eq!(catchup.messages.len(), 50);
    assert!(catchup.has_more);
    assert_eq!(catchup.messages[0].body, "0");
    let rest = store
        .chat_page(
            b,
            a,
            Cursor {
                before: None,
                after: Some(catchup.messages[49].id),
            },
        )
        .await
        .unwrap();
    assert_eq!(rest.messages.len(), 15);
    assert!(!rest.has_more);
    assert_eq!(rest.messages[14].body, "64");
    assert!(
        store
            .chat_page(
                b,
                a,
                Cursor {
                    before: Some(1),
                    after: Some(1)
                }
            )
            .await
            .is_err()
    );
}

#[tokio::test]
async fn invalid_text_and_spam_are_rejected_but_retries_are_free() {
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let two = user(&store, "Two").await;
    befriend(&store, &one, &two).await;
    let a = &one.snapshot.me.id;
    let b = &two.snapshot.me.id;
    for body in [" ", "\u{0000}", &"x".repeat(2001)] {
        assert!(store.chat_send(a, b, send(body)).await.is_err());
    }
    let input = send("First");
    let original = store.chat_send(a, b, input.clone()).await.unwrap();
    for _ in 1..30 {
        store.chat_send(a, b, send("More")).await.unwrap();
    }
    assert_eq!(
        store
            .chat_send(a, b, send("Too many"))
            .await
            .unwrap_err()
            .code,
        "limitReached"
    );
    assert_eq!(store.chat_send(a, b, input).await.unwrap().id, original.id);
}
