use super::{LrcLibResponse, LyricsRequest, parser::has_usable_synced_lyrics};

const MINIMUM_MATCH_SCORE: i32 = 120;

pub(super) fn select_best_response(
    request: &LyricsRequest,
    candidates: Vec<LrcLibResponse>,
) -> Option<LrcLibResponse> {
    candidates
        .into_iter()
        .filter_map(|candidate| match_score(request, &candidate).map(|score| (score, candidate)))
        .max_by_key(|(score, _)| *score)
        .filter(|(score, _)| *score >= MINIMUM_MATCH_SCORE)
        .map(|(_, candidate)| candidate)
}

fn match_score(request: &LyricsRequest, candidate: &LrcLibResponse) -> Option<i32> {
    let has_synced_lyrics = candidate
        .synced_lyrics
        .as_deref()
        .is_some_and(has_usable_synced_lyrics);
    let has_plain_lyrics = candidate
        .plain_lyrics
        .as_deref()
        .is_some_and(|value| value.lines().any(|line| !line.trim().is_empty()));

    if !candidate.instrumental && !has_synced_lyrics && !has_plain_lyrics {
        return None;
    }

    let title = text_similarity(&request.track_name, candidate.track_name.as_deref()?);
    let artist = text_similarity(&request.artist_name, candidate.artist_name.as_deref()?);
    if title == 0 || artist == 0 {
        return None;
    }

    let album = candidate
        .album_name
        .as_deref()
        .map(|value| text_similarity(&request.album_name, value))
        .unwrap_or_default();
    let duration_score = duration_score(request.duration_ms, candidate.duration)?;
    let synced_bonus = i32::from(has_synced_lyrics) * 8;
    Some(title * 2 + artist + album / 2 + duration_score + synced_bonus)
}

fn text_similarity(expected: &str, actual: &str) -> i32 {
    let expected = normalize_text(expected);
    let actual = normalize_text(actual);
    if expected.is_empty() || actual.is_empty() {
        return 0;
    }
    if expected == actual {
        return 60;
    }
    if expected.contains(&actual) || actual.contains(&expected) {
        return 35;
    }
    0
}

fn duration_score(expected_ms: u64, actual_seconds: Option<f64>) -> Option<i32> {
    let Some(seconds) = actual_seconds else {
        return Some(0);
    };
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    let difference = (expected_ms as f64 / 1_000.0 - seconds).abs();
    if difference <= 2.5 {
        Some(45)
    } else if difference <= 6.0 {
        Some(25)
    } else if difference <= 15.0 {
        Some(5)
    } else {
        None
    }
}

fn normalize_text(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> LyricsRequest {
        LyricsRequest {
            track_uri: Some("spotify:track:test".into()),
            track_name: "If I Wanted To".into(),
            artist_name: "Eem Triplin".into(),
            artist_names: Some(vec!["Eem Triplin".into()]),
            album_name: "If I Wanted To".into(),
            duration_ms: 179_000,
            cover_uri: None,
        }
    }

    fn candidate(title: &str, artist: &str, duration: f64) -> LrcLibResponse {
        LrcLibResponse {
            instrumental: false,
            track_name: Some(title.into()),
            artist_name: Some(artist.into()),
            album_name: Some("If I Wanted To".into()),
            duration: Some(duration),
            plain_lyrics: Some("line".into()),
            synced_lyrics: None,
        }
    }

    #[test]
    fn selects_matching_title_artist_and_duration() {
        let selected = select_best_response(
            &request(),
            vec![
                candidate("If I Wanted To", "Different Artist", 179.0),
                candidate("If I Wanted To", "Eem Triplin", 179.4),
            ],
        )
        .expect("matching lyrics");
        assert_eq!(selected.artist_name.as_deref(), Some("Eem Triplin"));
    }

    #[test]
    fn rejects_a_large_duration_mismatch() {
        assert!(
            select_best_response(
                &request(),
                vec![candidate("If I Wanted To", "Eem Triplin", 240.0)],
            )
            .is_none()
        );
    }

    #[test]
    fn unusable_synced_candidate_does_not_displace_plain_lyrics() {
        let mut unusable_synced = candidate("If I Wanted To", "Eem Triplin", 179.0);
        unusable_synced.plain_lyrics = None;
        unusable_synced.synced_lyrics =
            Some("[ar:Eem Triplin]\n[00:01.00]   \nnot an lrc line".into());

        let selected = select_best_response(
            &request(),
            vec![
                candidate("If I Wanted To", "Eem Triplin", 179.0),
                unusable_synced,
            ],
        )
        .expect("plain lyrics candidate");

        assert_eq!(selected.plain_lyrics.as_deref(), Some("line"));
        assert!(selected.synced_lyrics.is_none());
    }

    #[test]
    fn whitespace_only_lyrics_are_rejected() {
        let mut whitespace_only = candidate("If I Wanted To", "Eem Triplin", 179.0);
        whitespace_only.plain_lyrics = Some(" \n\t ".into());

        assert!(select_best_response(&request(), vec![whitespace_only]).is_none());
    }
}
