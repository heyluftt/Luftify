# Luftify

Desktop music player for Spotify Premium with its own interface and audio path. Tauri 2, Rust, React. The interface is in German and English.

- Playback through librespot inside the app, no Spotify desktop app needed
- Own audio output: 10-band EQ, room and stage processor, limiter, high-quality resampling
- Gapless, click-free track changes
- Synced lyrics and a music room with canvas videos
- Listening statistics and recaps
- Friends, chat and listen-together rooms via a small sync server (`apps/sync-server`)
- Themes, some lit by the colors of the current cover

## Development

```bash
corepack enable
pnpm install
pnpm dev
```

Without a Spotify account, with mock data: `pnpm dev:mock`

Build with installer:

```bash
pnpm build:app
```

Requires Windows 10/11, Node.js 22, Rust stable (MSVC) and WebView2. Playback needs Spotify Premium.

## Disclaimer

Luftify is an unofficial client. It is not affiliated with or endorsed by Spotify.

## Third-party licenses

- librespot (MIT): modified copies in `vendor/`, changes listed in each `LUFTIFY.md`
- KEMAR HRTF measurements by Bill Gardner and Keith Martin, MIT Media Lab: `crates/luft-audio/src/spatial/hrir`
