# librespot-playback 0.8.0, modified

Copy of [librespot](https://github.com/librespot-org/librespot) `librespot-playback` 0.8.0 (MIT, see `LICENSE`). Changes are marked `Luftify:` in the code.

- File and audio key are fetched in parallel; short retries for transient errors.
- A missing key stops the load with `AudioKeyFailed` instead of skipping through the queue.
- Audio keys are cached per session and requests follow Spotify's allowance (`src/key_pacing/`).
- A load nobody waits for any more (a skip) is cancelled instead of running to its end.
- `Sink::cut` and `Sink::pause_softly` for click-free skips, seeks and pauses.
- At the end of a track the output keeps running, so the next track follows without a gap.
