# librespot-core 0.8.0, modified

Copy of [librespot](https://github.com/librespot-org/librespot) `librespot-core` 0.8.0 (MIT, see `LICENSE`). Changes are marked `Luftify:` in the code.

- `src/socket.rs` connects to every resolved address (Happy Eyeballs) instead of only the first, so a broken IPv6 route no longer blocks the connection.
- A used-up audio key allowance is reported as its own error (`AudioKeyError::Limit`).
- Online login test removed from the manifest.
