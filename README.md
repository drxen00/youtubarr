# youtubarr

Self-hosted YouTube browser for binge-watching a creator's back catalogue. Point it at a channel, and it indexes every
upload, sorts them into **series** (Amnesia, Happy Wheels, Fridays with PewDiePie, …) with rule-based matching, and gives
you a player built for walking a series episode by episode — or scrubbing through a decade of uploads by date.

Built for Unraid + a Cloudflare tunnel, so it's one container, mobile-first, and optionally password-protected.

## What it does

- **Index a whole channel** via the YouTube Data API (≈200 quota units for 5,000 videos; refreshes cost 2–3).
- **Series from title rules.** Regex rules per series, editable in the UI with live match preview; higher priority wins.
  Ships with a starter ruleset for PewDiePie that's applied automatically. Manual per-video overrides stick through re-syncs.
- **Player built around series.** Prev/next episode, older/newer upload, episode `12/87`, resume where you left off,
  autoplay next, speed control, and keyboard shortcuts. YouTube embed by default; downloaded videos play natively.
- **Timeline scrubber.** A per-month upload histogram you drag to land anywhere in the channel's history and browse forward.
- **Opt-in downloads.** Any video or a whole series can be pulled with `yt-dlp` into `/media` and served with range
  requests for seeking. Nothing is downloaded unless you ask.
- **Single password** (`APP_PASSWORD`) for when the tunnel is public; or put Cloudflare Access in front instead.

## Run it (Unraid / Docker)

**Unraid, one click:** Docker tab → **Add Container** → paste the template URL into the *Template* box, or drop
[`unraid/youtubarr.xml`](unraid/youtubarr.xml) into `/boot/config/plugins/dockerMan/templates-user/` and pick it from the
*Template* dropdown:

```
https://raw.githubusercontent.com/drxen00/youtubarr/main/unraid/youtubarr.xml
```

**Docker Compose:**

```yaml
services:
  youtubarr:
    image: ghcr.io/drxen00/youtubarr:latest
    container_name: youtubarr
    restart: unless-stopped
    ports: ["8790:8790"]
    environment:
      YOUTUBE_API_KEY: ""     # or paste it into Settings once running
      APP_PASSWORD: ""        # strongly recommended if exposed
    volumes:
      - /mnt/user/appdata/youtubarr:/data     # SQLite db
      - /mnt/user/media/youtubarr:/media      # downloads (optional, can be big)
```

Then open `http://<unraid-ip>:8790`, add your API key in **Settings**, and add `@PewDiePie` on the home page.

### YouTube API key

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project.
2. **APIs & Services → Library** → enable *YouTube Data API v3*.
3. **Credentials → Create credentials → API key.** Restrict it to the YouTube Data API.

### Cloudflare tunnel

Add a public hostname in Zero Trust pointing at `http://youtubarr:8790` (same Docker network) or `http://<unraid-ip>:8790`.
Set `APP_PASSWORD`, or add a Cloudflare Access policy to the hostname. The server trusts `X-Forwarded-*` headers so
cookies are marked `Secure` behind the tunnel.

## Development

Requires Node 22.13+ (uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env         # add YOUTUBE_API_KEY
npm run dev:server           # API on :8790
npm run dev:web              # Vite on :5173, proxies /api and /media
```

`npm run typecheck`, `npm test`, `npm run build` mirror what CI runs. Pushes to `main` build and publish the image to GHCR.

### Layout

```
server/   Fastify + node:sqlite API, YouTube indexer, rules engine, yt-dlp queue
  seeds/  starter series rulesets, keyed by channel id/handle
web/      React 19 + Vite + Tailwind SPA
```

### Adding a starter ruleset for another creator

Drop a JSON file in `server/seeds/` shaped like `pewdiepie.json`: `channels` (ids or handles) and `series`, each with a
`name`, optional `color`/`priority`, and `patterns` (JS regex strings; case-insensitive unless a `flags` value is given).
It's imported when a matching channel is added, and can be re-imported from the API.

## Notes

- Metadata comes from the YouTube Data API; playback uses YouTube's embedded player unless you've downloaded the file.
  Ads and availability are therefore YouTube's. Videos that go private stay in the index (greyed out) so history survives.
- `yt-dlp` and `ffmpeg` are baked into the image. YouTube periodically breaks yt-dlp; pulling a fresh image fixes it.
