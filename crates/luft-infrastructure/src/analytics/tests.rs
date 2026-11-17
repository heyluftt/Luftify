use super::*;

#[tokio::test]
async fn recent_history_orders_deduplicates_filters_and_clears() {
    let database = Database::open_memory().await.unwrap();
    for (id, uri, offset, listened) in [
        ("old", "spotify:track:a", 0, 90_000),
        ("middle", "spotify:track:b", 1_000, 5_000),
        ("repeat", "spotify:track:a", 2_000, 8_000),
        ("skip", "spotify:track:c", 3_000, 1_000),
    ] {
        let mut record = session(id, uri, listened);
        record.started_at_ms += offset;
        record.ended_at_ms = Some(record.started_at_ms + listened as i64);
        database.upsert_listening_session(&record).await.unwrap();
    }
    let recent = database.recently_played_tracks().await.unwrap();
    assert_eq!(recent.len(), 2);
    assert_eq!(recent[0].track.uri, "spotify:track:a");
    assert_eq!(recent[0].last_played_at_ms, 1_750_000_002_000);
    assert_eq!(recent[1].track.uri, "spotify:track:b");
    assert_eq!(recent[0].track.creators.len(), 1);
    database.clear_listening_analytics().await.unwrap();
    assert!(database.recently_played_tracks().await.unwrap().is_empty());
}

fn session(id: &str, track_uri: &str, listened_ms: u64) -> ListeningSessionRecord {
    ListeningSessionRecord {
        id: id.into(),
        track: TrackSnapshot {
            uri: track_uri.into(),
            item_type: "track".into(),
            title: format!("Track {track_uri}"),
            creators: vec![Creator {
                name: "Luft Artist".into(),
                uri: Some("spotify:artist:luft".into()),
            }],
            album_uri: Some("spotify:album:luft".into()),
            album_name: Some("Luft Album".into()),
            duration_ms: Some(180_000),
            cover_uri: Some("https://example.invalid/cover.jpg".into()),
        },
        context_uri: Some("spotify:playlist:luft".into()),
        context_name: Some("Luft Playlist".into()),
        context_type: "playlist".into(),
        source: "spotifyInternal".into(),
        started_at_ms: 1_750_000_000_000,
        ended_at_ms: Some(1_750_000_000_000 + i64::try_from(listened_ms).unwrap()),
        start_position_ms: Some(0),
        end_position_ms: Some(listened_ms),
        listened_ms,
        qualified_play: listened_ms >= 30_000,
        completed: listened_ms >= 144_000,
        seek_count: 0,
        pause_count: 0,
        repeat_cycle: 0,
        end_reason: Some("track-changed".into()),
    }
}

#[tokio::test]
async fn overview_aggregates_tracks_artists_playlists_days_and_behavior() {
    let database = Database::open_memory().await.expect("database");
    let first = session("first", "spotify:track:first", 150_000);
    let mut second = session("second", "spotify:track:second", 5_000);
    second.started_at_ms += MILLIS_PER_DAY;
    second.ended_at_ms = Some(second.started_at_ms + 5_000);
    second.seek_count = 2;
    second.pause_count = 1;
    database
        .upsert_listening_session(&first)
        .await
        .expect("first session");
    database
        .upsert_listening_session(&second)
        .await
        .expect("second session");

    let overview = database
        .listening_overview(AnalyticsRangeRequest {
            from_unix_ms: Some(first.started_at_ms - 1),
            to_unix_ms: Some(second.started_at_ms + MILLIS_PER_DAY),
            limit: 10,
            timezone_offset_minutes: 0,
        })
        .await
        .expect("overview");

    assert_eq!(overview.total_listening_ms, 155_000);
    assert_eq!(overview.session_count, 2);
    assert_eq!(overview.qualified_play_count, 1);
    assert_eq!(overview.completed_play_count, 1);
    assert_eq!(overview.unique_track_count, 1);
    assert_eq!(overview.unique_artist_count, 1);
    assert_eq!(overview.unique_playlist_count, 1);
    assert_eq!(overview.top_tracks[0].track.uri, first.track.uri);
    assert_eq!(overview.top_artists[0].creator.name, "Luft Artist");
    assert_eq!(
        overview.top_playlists[0].playlist_uri,
        "spotify:playlist:luft"
    );
    assert_eq!(overview.daily_activity.len(), 2);
    assert_eq!(overview.daily_activity[0].play_count, 1);
    assert_eq!(overview.daily_activity[1].play_count, 0);
    assert_eq!(overview.behavior.skip_count, 1);
    assert_eq!(overview.behavior.seek_count, 2);
    assert_eq!(overview.behavior.pause_count, 1);
    assert_eq!(overview.behavior.completion_rate, 1.0);
}

#[tokio::test]
async fn checkpoint_upsert_is_idempotent_and_clear_removes_all_analytics() {
    let database = Database::open_memory().await.expect("database");
    let mut checkpoint = session("active", "spotify:track:active", 12_000);
    checkpoint.ended_at_ms = None;
    checkpoint.end_position_ms = None;
    checkpoint.end_reason = None;
    database
        .upsert_listening_session(&checkpoint)
        .await
        .expect("checkpoint");

    let mut final_record = checkpoint.clone();
    final_record.listened_ms = 40_000;
    final_record.qualified_play = true;
    final_record.ended_at_ms = Some(final_record.started_at_ms + 40_000);
    final_record.end_position_ms = Some(40_000);
    final_record.end_reason = Some("pause".into());
    database
        .upsert_listening_session(&final_record)
        .await
        .expect("final record");
    database
        .upsert_listening_session(&checkpoint)
        .await
        .expect("stale checkpoint");

    let overview = database
        .listening_overview(AnalyticsRangeRequest::default())
        .await
        .expect("overview");
    assert_eq!(overview.session_count, 1);
    assert_eq!(overview.total_listening_ms, 40_000);
    assert_eq!(overview.qualified_play_count, 1);

    database.clear_listening_analytics().await.expect("clear");
    let overview = database
        .listening_overview(AnalyticsRangeRequest::default())
        .await
        .expect("empty overview");
    assert_eq!(overview.session_count, 0);
    assert!(overview.top_tracks.is_empty());
    assert!(overview.top_artists.is_empty());
    assert!(overview.top_playlists.is_empty());
}

#[tokio::test]
async fn repaired_title_survives_later_placeholder_checkpoints() {
    let database = Database::open_memory().await.expect("database");
    let mut placeholder = session("placeholder", "spotify:track:repair", 40_000);
    placeholder.track.title = "Titel wird geladen…".into();
    database
        .upsert_listening_session(&placeholder)
        .await
        .expect("placeholder session");

    let mut repaired = placeholder.track.clone();
    repaired.title = "Richtiger Titel".into();
    assert!(
        database
            .repair_analytics_track_metadata(&repaired)
            .await
            .expect("metadata repair")
    );

    let mut stale = placeholder.clone();
    stale.id = "stale-placeholder".into();
    stale.started_at_ms += 50_000;
    stale.ended_at_ms = Some(stale.started_at_ms + 40_000);
    database
        .upsert_listening_session(&stale)
        .await
        .expect("stale checkpoint");

    let overview = database
        .listening_overview(AnalyticsRangeRequest::default())
        .await
        .expect("overview");
    assert_eq!(overview.top_tracks[0].track.title, "Richtiger Titel");
}

#[tokio::test]
async fn technical_disconnects_are_not_reported_as_user_skips() {
    let database = Database::open_memory().await.expect("database");
    let mut disconnected = session("disconnect", "spotify:track:disconnect", 5_000);
    disconnected.end_reason = Some("bridge-disconnected".into());
    let skipped = session("skip", "spotify:track:skip", 5_000);

    database
        .upsert_listening_session(&disconnected)
        .await
        .expect("disconnected session");
    database
        .upsert_listening_session(&skipped)
        .await
        .expect("skipped session");

    let overview = database
        .listening_overview(AnalyticsRangeRequest::default())
        .await
        .expect("overview");

    assert_eq!(overview.behavior.skip_count, 1);
    assert_eq!(overview.behavior.repeat_count, 0);
}

#[tokio::test]
async fn legacy_unsplit_repeat_session_infers_cycles_without_inflating_duration_metrics() {
    let database = Database::open_memory().await.expect("database");
    let mut repeated = session("legacy-repeat", "spotify:track:repeat", 405_000);
    repeated.ended_at_ms = None;
    repeated.end_position_ms = Some(45_000);
    repeated.end_reason = Some("legacy-repeat-merged".into());
    database
        .upsert_listening_session(&repeated)
        .await
        .expect("legacy repeat session");

    let overview = database
        .listening_overview(AnalyticsRangeRequest::default())
        .await
        .expect("overview");

    assert_eq!(overview.total_listening_ms, 405_000);
    assert_eq!(overview.session_count, 1);
    assert_eq!(overview.qualified_play_count, 3);
    assert_eq!(overview.completed_play_count, 2);
    assert_eq!(overview.behavior.repeat_count, 2);
    assert_eq!(overview.behavior.longest_session_ms, 180_000);
    assert_eq!(overview.behavior.average_session_ms, 135_000);
    assert_eq!(overview.top_tracks[0].play_count, 3);
    assert_eq!(overview.top_tracks[0].completed_count, 2);
    assert_eq!(overview.top_artists[0].play_count, 3);
    assert_eq!(overview.top_playlists[0].play_count, 3);
    assert_eq!(overview.daily_activity[0].play_count, 3);
}

#[tokio::test]
async fn rewinds_stay_one_play_but_restarts_from_the_top_count_each_time() {
    // A 3-minute song (the helper's duration).
    let database = Database::open_memory().await.expect("database");
    let mut rewound = session("rewound", "spotify:track:rewound", 300_000);
    rewound.seek_count = 3;
    rewound.end_reason = Some("track-changed".into());
    // Before the tracker fix a song on repeat stayed one long session whose
    // restarts were counted as seeks.
    let mut restarted = session("restarted", "spotify:track:restarted", 405_000);
    restarted.seek_count = 4;
    restarted.end_reason = Some("track-changed".into());
    // Long, but only one jump back: at most two plays.
    let mut capped = session("capped", "spotify:track:capped", 900_000);
    capped.seek_count = 1;
    capped.end_reason = Some("track-changed".into());
    for entry in [&rewound, &restarted, &capped] {
        database.upsert_listening_session(entry).await.expect("session");
    }

    let overview = database
        .listening_overview(AnalyticsRangeRequest::default())
        .await
        .expect("overview");
    let plays = |uri: &str| overview.top_tracks.iter().find(|stat| stat.track.uri == uri).map(|stat| stat.play_count);
    assert_eq!(plays("spotify:track:rewound"), Some(1));
    assert_eq!(plays("spotify:track:restarted"), Some(3));
    assert_eq!(plays("spotify:track:capped"), Some(2));
    assert_eq!(overview.qualified_play_count, 6);
    // Each extra play of a restarted session is a repeat: 2 + 1.
    assert_eq!(overview.behavior.repeat_count, 3);
}

#[tokio::test]
async fn migration_repairs_only_open_legacy_repeat_sessions() {
    let database = Database::open_memory().await.expect("database");
    let mut open_repeat = session("open-repeat", "spotify:track:open-repeat", 725_000);
    open_repeat.ended_at_ms = None;
    open_repeat.end_reason = None;
    open_repeat.seek_count = 7;

    let mut closed_seeked = session("closed-seeked", "spotify:track:closed-seeked", 405_000);
    closed_seeked.seek_count = 9;

    database
        .upsert_listening_session(&open_repeat)
        .await
        .expect("open repeat session");
    database
        .upsert_listening_session(&closed_seeked)
        .await
        .expect("closed seeked session");

    sqlx::raw_sql(include_str!(
        "../../migrations/0004_repair_listening_analytics.sql"
    ))
    .execute(database.pool())
    .await
    .expect("repair migration");
    sqlx::raw_sql(include_str!(
        "../../migrations/0005_identify_merged_repeat_sessions.sql"
    ))
    .execute(database.pool())
    .await
    .expect("repeat identification migration");

    let repaired = sqlx::query_as::<_, (Option<i64>, Option<String>, i64)>(
        "SELECT ended_at_ms, end_reason, seek_count
         FROM listening_sessions
         WHERE session_id = ?1",
    )
    .bind(&open_repeat.id)
    .fetch_one(database.pool())
    .await
    .expect("repaired row");
    let untouched = sqlx::query_as::<_, (Option<i64>, Option<String>, i64)>(
        "SELECT ended_at_ms, end_reason, seek_count
         FROM listening_sessions
         WHERE session_id = ?1",
    )
    .bind(&closed_seeked.id)
    .fetch_one(database.pool())
    .await
    .expect("untouched row");

    assert!(repaired.0.is_some());
    assert_eq!(repaired.1.as_deref(), Some("legacy-repeat-merged"));
    assert_eq!(repaired.2, 0);
    assert!(untouched.0.is_some());
    assert_eq!(untouched.1.as_deref(), Some("track-changed"));
    assert_eq!(untouched.2, 0);

    let overview = database
        .listening_overview(AnalyticsRangeRequest::default())
        .await
        .expect("overview");
    assert_eq!(overview.qualified_play_count, 5);
    assert_eq!(overview.behavior.repeat_count, 3);
}

#[tokio::test]
async fn unqualified_fragments_do_not_expand_unique_counts_or_rankings() {
    let database = Database::open_memory().await.expect("database");
    let qualified = session("qualified", "spotify:track:qualified", 45_000);
    let mut fragment = session("fragment", "spotify:track:fragment", 5_000);
    fragment.track.creators = vec![Creator {
        name: "Fragment Artist".into(),
        uri: Some("spotify:artist:fragment".into()),
    }];
    fragment.context_uri = Some("spotify:playlist:fragment".into());
    fragment.context_name = Some("Fragment Playlist".into());
    database
        .upsert_listening_session(&qualified)
        .await
        .expect("qualified session");
    database
        .upsert_listening_session(&fragment)
        .await
        .expect("fragment session");

    let overview = database
        .listening_overview(AnalyticsRangeRequest::default())
        .await
        .expect("overview");

    assert_eq!(overview.unique_track_count, 1);
    assert_eq!(overview.unique_artist_count, 1);
    assert_eq!(overview.unique_playlist_count, 1);
    assert_eq!(overview.top_tracks.len(), 1);
    assert_eq!(overview.top_tracks[0].track.uri, qualified.track.uri);
    assert_eq!(overview.top_artists.len(), 1);
    assert_eq!(overview.top_artists[0].creator.name, "Luft Artist");
    assert_eq!(overview.top_playlists.len(), 1);
    assert_eq!(
        overview.top_playlists[0].playlist_uri,
        qualified.context_uri.expect("playlist")
    );
}

#[tokio::test]
async fn technical_source_failures_and_mismatches_do_not_count_as_skips() {
    let database = Database::open_memory().await.expect("database");
    for reason in [
        "progress-track-mismatch",
        "bridge-events-lagged",
        "bridge-reconnected",
        "bridge-disconnected",
        "app-shutdown",
        "disabled",
        "engine-changed",
    ] {
        let mut record = session(reason, "spotify:track:one", 5_000);
        record.end_reason = Some(reason.into());
        database
            .upsert_listening_session(&record)
            .await
            .expect("session");
    }
    database
        .upsert_listening_session(&session("user-skip", "spotify:track:one", 5_000))
        .await
        .expect("user skip");
    let overview = database
        .listening_overview(AnalyticsRangeRequest::default())
        .await
        .expect("overview");
    assert_eq!(overview.behavior.skip_count, 1);
    assert_eq!(overview.total_listening_ms, 40_000);
}

#[tokio::test]
async fn ranked_tracks_keep_their_own_ordered_creators() {
    let database = Database::open_memory().await.expect("database");
    let mut first = session("one", "spotify:track:one", 90_000);
    first.track.creators = vec![
        Creator {
            name: "Z first".into(),
            uri: Some("spotify:artist:z".into()),
        },
        Creator {
            name: "A guest".into(),
            uri: None,
        },
    ];
    let mut second = session("two", "spotify:track:two", 60_000);
    second.track.creators = vec![Creator {
        name: "Other".into(),
        uri: None,
    }];
    database
        .upsert_listening_session(&first)
        .await
        .expect("first");
    database
        .upsert_listening_session(&second)
        .await
        .expect("second");
    let overview = database
        .listening_overview(AnalyticsRangeRequest::default())
        .await
        .expect("overview");
    assert_eq!(overview.top_tracks[0].track.creators, first.track.creators);
    assert_eq!(overview.top_tracks[1].track.creators, second.track.creators);
    let empty = database
        .listening_overview(AnalyticsRangeRequest {
            from_unix_ms: Some(first.started_at_ms + 1_000_000),
            ..Default::default()
        })
        .await
        .expect("empty overview");
    assert!(empty.top_tracks.is_empty());
}

#[tokio::test]
async fn daily_activity_keeps_a_midnight_crossing_session_on_the_start_day() {
    let database = Database::open_memory().await.expect("database");
    let day_start = (1_750_000_000_000 / MILLIS_PER_DAY) * MILLIS_PER_DAY;
    let mut overnight = session("overnight", "spotify:track:overnight", 7_200_000);
    overnight.started_at_ms = day_start + MILLIS_PER_DAY - 3_600_000;
    overnight.ended_at_ms = Some(overnight.started_at_ms + 7_200_000);
    overnight.qualified_play = true;
    overnight.completed = true;
    database
        .upsert_listening_session(&overnight)
        .await
        .expect("overnight session");

    let overview = database
        .listening_overview(AnalyticsRangeRequest {
            from_unix_ms: Some(day_start),
            to_unix_ms: Some(day_start + MILLIS_PER_DAY * 2),
            limit: 10,
            timezone_offset_minutes: 0,
        })
        .await
        .expect("overview");

    assert_eq!(overview.daily_activity.len(), 1);
    assert_eq!(overview.daily_activity[0].day_start_ms, day_start);
    assert_eq!(overview.daily_activity[0].listening_ms, 7_200_000);
    assert_eq!(overview.total_listening_ms, 7_200_000);
}

#[tokio::test]
async fn track_feedback_separates_completed_plays_from_skips() {
    let database = Database::open_memory().await.expect("database");
    let completed = session("completed", "spotify:track:known", 150_000);
    let mut skipped = session("skipped", "spotify:track:skipped", 5_000);
    let mut passed = session("passed", "spotify:track:passed", 1_500);
    passed.started_at_ms += 120_000;
    passed.ended_at_ms = Some(passed.started_at_ms + 1_500);
    skipped.started_at_ms += 60_000;
    skipped.ended_at_ms = Some(skipped.started_at_ms + 5_000);
    for record in [&completed, &skipped, &passed] {
        database
            .upsert_listening_session(record)
            .await
            .expect("session");
    }

    let mut feedback = database
        .track_listening_feedback(&[
            "spotify:track:known".into(),
            "spotify:track:skipped".into(),
            "spotify:track:passed".into(),
            "spotify:track:unheard".into(),
        ])
        .await
        .expect("feedback");
    feedback.sort_by(|a, b| a.uri.cmp(&b.uri));

    assert_eq!(feedback.len(), 3, "unheard titles are omitted");
    assert_eq!(feedback[0].uri, "spotify:track:known");
    assert_eq!(feedback[0].completed_count, 1);
    assert_eq!(feedback[0].skip_count, 0);
    assert_eq!(feedback[0].max_listened_ms, 150_000);
    assert_eq!(feedback[0].duration_ms, Some(180_000));
    assert_eq!(feedback[1].uri, "spotify:track:passed");
    assert_eq!(
        feedback[1].skip_count, 0,
        "pass-through clicks are no judgment"
    );
    assert_eq!(feedback[2].skip_count, 1);
    assert_eq!(feedback[2].qualified_play_count, 0);
    assert_eq!(feedback[2].last_skipped_at_ms, Some(skipped.started_at_ms));
}

#[tokio::test]
async fn average_play_ignores_early_skips_and_hours_follow_the_local_clock() {
    let database = Database::open_memory().await.expect("database");
    // 1_750_000_000_000 ms is 15:06:40 UTC; at UTC+2 that is 17:06 local.
    for (id, uri, listened) in [
        ("play", "spotify:track:a", 180_000),
        ("skip-1", "spotify:track:b", 2_000),
        ("skip-2", "spotify:track:c", 3_000),
    ] {
        database
            .upsert_listening_session(&session(id, uri, listened))
            .await
            .expect("session");
    }
    let overview = database
        .listening_overview(AnalyticsRangeRequest {
            from_unix_ms: Some(0),
            to_unix_ms: Some(1_760_000_000_000),
            limit: 10,
            timezone_offset_minutes: 120,
        })
        .await
        .expect("overview");

    assert_eq!(overview.behavior.average_play_ms, 180_000);
    assert!(overview.behavior.average_session_ms < 70_000);
    assert_eq!(overview.hourly_activity.len(), 1);
    assert_eq!(overview.hourly_activity[0].hour, 17);
    assert_eq!(overview.hourly_activity[0].listening_ms, 185_000);
    assert_eq!(overview.hourly_activity[0].play_count, 1);
}

#[tokio::test]
async fn recap_finds_discoveries_the_song_on_repeat_and_the_period_before() {
    let database = Database::open_memory().await.expect("database");
    let week = 7 * MILLIS_PER_DAY;
    let start = 1_750_000_000_000;
    // Last week: one play of an old favourite.
    let old = session("old", "spotify:track:old", 170_000);
    database.upsert_listening_session(&old).await.expect("old");
    // This week: the favourite again, and a new artist played four times on one day.
    let mut again = session("again", "spotify:track:old", 170_000);
    again.started_at_ms = start + week;
    again.ended_at_ms = Some(again.started_at_ms + 170_000);
    database.upsert_listening_session(&again).await.expect("again");
    for index in 0..4 {
        let mut fresh = session(&format!("fresh-{index}"), "spotify:track:fresh", 160_000);
        fresh.track.creators = vec![Creator { name: "New Voice".into(), uri: Some("spotify:artist:new".into()) }];
        fresh.track.album_name = Some("Fresh Album".into());
        fresh.track.album_uri = Some("spotify:album:fresh".into());
        fresh.started_at_ms = start + week + 3_600_000 * (index + 1);
        fresh.ended_at_ms = Some(fresh.started_at_ms + 160_000);
        database.upsert_listening_session(&fresh).await.expect("fresh");
    }

    let recap = database
        .listening_recap(RecapRequest {
            from_unix_ms: start + week - 1,
            to_unix_ms: start + 2 * week,
            previous_from_unix_ms: Some(start - 1),
            timezone_offset_minutes: 0,
        })
        .await
        .expect("recap");

    assert_eq!(recap.overview.qualified_play_count, 5);
    assert_eq!(recap.previous_play_count, Some(1));
    assert_eq!(recap.previous_listening_ms, Some(170_000));
    assert_eq!(recap.new_artist_count, 1);
    assert_eq!(recap.new_track_count, 1);
    assert_eq!(recap.top_new_artist.as_ref().map(|a| a.creator.name.as_str()), Some("New Voice"));
    let on_repeat = recap.on_repeat.expect("on repeat");
    assert_eq!(on_repeat.track.uri, "spotify:track:fresh");
    assert_eq!(on_repeat.play_count, 4);
    // One song from "Fresh Album" makes it a single, not the top album.
    assert!(recap.top_album.is_none());
    let discovery = recap.top_discovery.expect("discovery");
    assert_eq!(discovery.track.uri, "spotify:track:fresh");
    assert_eq!(discovery.play_count, 4);
    assert_eq!(recap.top_track_first_heard_ms, Some(start + week + 3_600_000));
    assert_eq!(recap.history_started_at_ms, Some(start));

    let days = database.listening_days(0).await.expect("days");
    assert_eq!(days.len(), 2);
}

#[tokio::test]
async fn recap_previews_show_the_most_played_covers_song_and_artist() {
    let database = Database::open_memory().await.expect("database");
    let start = 1_750_000_000_000;
    for (index, (album, plays)) in [("a", 3), ("b", 1)].into_iter().enumerate() {
        for play in 0..plays {
            let mut entry = session(&format!("{album}-{play}"), &format!("spotify:track:{album}"), 170_000);
            entry.track.album_uri = Some(format!("spotify:album:{album}"));
            entry.track.cover_uri = Some(format!("https://example.invalid/{album}.jpg"));
            entry.started_at_ms = start + (index as i64 * 10 + play) * 600_000;
            entry.ended_at_ms = Some(entry.started_at_ms + 170_000);
            database.upsert_listening_session(&entry).await.expect("session");
        }
    }
    let previews = database
        .recap_previews(vec![
            RecapPreviewRange { id: "week".into(), from_unix_ms: start - 1, to_unix_ms: start + MILLIS_PER_DAY },
            RecapPreviewRange { id: "empty".into(), from_unix_ms: start + MILLIS_PER_DAY, to_unix_ms: start + 2 * MILLIS_PER_DAY },
            RecapPreviewRange { id: "invalid".into(), from_unix_ms: start, to_unix_ms: start },
        ])
        .await
        .expect("previews");
    assert_eq!(previews.len(), 2);
    assert_eq!(previews[0].cover_uris, ["https://example.invalid/a.jpg", "https://example.invalid/b.jpg"]);
    assert_eq!(previews[0].top_track_title.as_deref(), Some("Track spotify:track:a"));
    assert!(previews[0].top_artist_name.is_some());
    assert!(previews[1].cover_uris.is_empty());
    assert_eq!(previews[1].top_track_title, None);
}

#[tokio::test]
async fn recap_top_album_skips_singles() {
    let database = Database::open_memory().await.expect("database");
    let start = 1_750_000_000_000;
    let mut minute = 0;
    let mut play = |id: String, track: &str, title: &str, album: &str| {
        let mut entry = session(&id, track, 170_000);
        entry.track.title = title.into();
        entry.track.album_name = Some(album.into());
        entry.track.album_uri = Some(format!("spotify:album:{}", album.to_lowercase().replace(' ', "-")));
        minute += 5;
        entry.started_at_ms = start + minute * 60_000;
        entry.ended_at_ms = Some(entry.started_at_ms + 170_000);
        entry
    };
    let mut sessions = Vec::new();
    // A single played a lot, with its instrumental: still a single.
    for index in 0..6 {
        sessions.push(play(format!("single-{index}"), "spotify:track:parasit", "Parasit", "Parasit"));
    }
    sessions.push(play("single-inst".into(), "spotify:track:parasit-inst", "Parasit (Instrumental)", "Parasit"));
    // A real album: three different songs.
    for (index, title) in ["Intro", "Nacht", "Outro"].into_iter().enumerate() {
        sessions.push(play(format!("album-{index}"), &format!("spotify:track:album-{index}"), title, "Late Tapes"));
    }
    for entry in &sessions {
        database.upsert_listening_session(entry).await.expect("session");
    }
    let recap = database
        .listening_recap(RecapRequest {
            from_unix_ms: start,
            to_unix_ms: start + MILLIS_PER_DAY,
            previous_from_unix_ms: None,
            timezone_offset_minutes: 0,
        })
        .await
        .expect("recap");
    assert_eq!(recap.top_album.map(|album| album.album_name).as_deref(), Some("Late Tapes"));
}
