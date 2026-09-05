# pla-np

A Plex/Plexamp Now Playing page made in Svelte 5.

This project was built with Codex.

## Features

- Responsive layout from 480p to 4K, in portrait and landscape
- Multi-session slideshow for active players
- Configurable display options, including low-power mode
- Optional filtering by player, user, and library

## Installation

### Docker

Create `plex.config.json` from `plex.config.json.example` and mount it at `/app/config`.

Run with Docker:

```bash
docker run -d \
  --name pla-np \
  -p 3000:3000 \
  -v /path/to/config:/app/config:ro \
  --restart unless-stopped \
  ghcr.io/tomvw/pla-np:latest
```

or docker compose:

```yaml
services:
  pla-np:
    image: ghcr.io/tomvw/pla-np:latest
    container_name: pla-np
    ports:
      - "3000:3000"
    volumes:
      - /path/to/config:/app/config:ro
    restart: unless-stopped
```

### From Source

Requirements:

- Node `26.8.1`
- npm `11.19.0`

If you use `nvm`:

```bash
nvm use
```

Then create `config/plex.config.json` and run:

```bash
npm ci
npm run build
npm start
```

You can create `config/plex.config.json` by copying `config/plex.config.json.example` and updating the values for your Plex setup.

The app will be available at `http://localhost:3000`.

### Network exposure warning

This app is designed for a trusted local network or VPN. The main API endpoints are intentionally unauthenticated and expose Plex now-playing metadata to anyone who can reach the app. Exposing the app directly to the public internet is at your own risk; use HTTPS and put it behind an authenticated reverse proxy or private access network if it must be reachable beyond your LAN. Do not expose the Node port directly without understanding this risk.

## Configuration

Example `plex.config.json`:

```json
{
  "PLEX_URL": "http://your.plex.url",
  "PLEX_TOKEN": "your-plex-token",
  "LOG_LEVEL": "info",
  "PLAYERS": ["raspberrypi", "android"],
  "USERS": ["bob", "jane"],
  "LIBRARIES": ["music", "chiptunes"],
  "ARTIST_DISPLAY": "both",
  "SHOW_USERNAME": true,
  "SHOW_MEDIAINFO": true,
  "SHOW_CLIENTINFO": true,
  "SHOW_PROGRESS": false,
  "LOW_POWER_MODE": false,
  "IMAGE_CACHE_ENABLED": true
}
```

| Option | Values | Description |
| :-- | :-- | :-- |
| `PLEX_URL` | `"http://your.plex.url"` | URL of your Plex instance. If Plex uses HTTPS with a self-signed certificate, you may need to add that certificate to the container or runtime trust store. |
| `PLEX_TOKEN` | `"your-plex-token"` | Plex token. See [Plex's token guide](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/). |
| `LOG_LEVEL` | `"silent"`, `"error"`, `"warn"`, `"info"`, or `"debug"` | Controls server and browser logging. Defaults to `"info"`; use `"debug"` for Plex request and filtering details. |
| `PLAYERS` | `["raspberrypi", "android"]` or `[]` | List of players to include, or empty for no filtering |
| `USERS` | `["bob", "jane"]` or `[]` | List of users to include, or empty for no filtering |
| `LIBRARIES` | `["music", "chiptunes"]` or `[]` | List of libraries to include, or empty for no filtering |
| `ARTIST_DISPLAY` | `"track"`, `"album"` or `"both"` | Show track artist, album artist, or both |
| `SHOW_USERNAME` | `true` or `false` | Show usernames |
| `SHOW_MEDIAINFO` | `true` or `false` | Show codec, sampling rate, bit depth, and bitrate |
| `SHOW_CLIENTINFO` | `true` or `false` | Show player, device, and user info |
| `SHOW_PROGRESS` | `true` or `false` | Show the song progress bar. Progress timing may not match exactly. |
| `LOW_POWER_MODE` | `true` or `false` | Reduce effects, lower refresh work, and replace marquee text with ellipsis |
| `IMAGE_CACHE_ENABLED` | `true` or `false` | Enable or disable the server-side artwork cache |

## Image Cache

Artwork requested through `/api/art` is cached on the server by default.

Disable the cache in `plex.config.json`:

```json
"IMAGE_CACHE_ENABLED": false
```

When disabled, artwork is fetched directly from Plex for each request and the server responds with `Cache-Control: no-store`.

Check cache stats:

```text
http://localhost:3000/api/cache-stats
```

The response includes cache status, counters, hit rate, file count, total size, and the largest cached items.

Cache administration is disabled unless `CACHE_ADMIN_TOKEN` is set on the server. When enabled, send it as `Authorization: Bearer <token>` (or `X-Cache-Admin-Token`).

Clear the cache:

```text
http://localhost:3000/api/cache-clear
```

Example:

```bash
curl -X POST -H "Authorization: Bearer your-cache-admin-token" http://localhost:3000/api/cache-clear
```

Clear the cache and reset the counters:

```bash
curl -X POST -H "Authorization: Bearer your-cache-admin-token" "http://localhost:3000/api/cache-clear?reset=true"
```

## Optional server environment variables

These variables are read when the Node server starts. Restart the server after changing them. Values must be positive integers where noted; invalid values fall back to the defaults.

| Variable | Default | Description |
| :-- | --: | :-- |
| `PORT` | `3000` | TCP port on which the application listens. |
| `PLEX_REQUEST_TIMEOUT_MS` | `10000` | Maximum time, in milliseconds, to wait for a Plex sessions or artwork request. |
| `ART_MAX_BYTES` | `10485760` (10 MiB) | Maximum size of one artwork response. Larger responses are rejected before being cached. |
| `ART_CACHE_TTL_SECONDS` | `86400` (24 hours) | How long a cached artwork item remains valid. Expired items are removed during cache reads or hourly cleanup. |
| `ART_CACHE_MAX_BYTES` | `209715200` (200 MiB) | Maximum total size of the artwork cache. The oldest items are removed during cleanup when this limit is exceeded. |
| `CACHE_ADMIN_TOKEN` | unset | Enables and protects the cache administration endpoints. |

### `CACHE_ADMIN_TOKEN`

Cache administration is disabled when `CACHE_ADMIN_TOKEN` is unset. In that state, `/api/cache-stats` and `/api/cache-clear` return `404`.

When it is configured, use a long, randomly generated secret and send it with every cache administration request as either a Bearer token or the `X-Cache-Admin-Token` header:

```bash
export CACHE_ADMIN_TOKEN="replace-with-a-long-random-secret"
npm start

curl -H "Authorization: Bearer $CACHE_ADMIN_TOKEN" http://localhost:3000/api/cache-stats
curl -X POST -H "Authorization: Bearer $CACHE_ADMIN_TOKEN" http://localhost:3000/api/cache-clear
```

`/api/cache-clear` permanently removes cached artwork, so protect this token like a password. Do not put it in the Plex JSON configuration, frontend code, URLs, or publicly accessible Docker images. If the app is accessed over a network, use HTTPS or keep it behind a trusted reverse proxy; otherwise the header can be intercepted.

For Docker Compose, pass it through the environment rather than storing it in the image:

```yaml
services:
  pla-np:
    environment:
      CACHE_ADMIN_TOKEN: ${CACHE_ADMIN_TOKEN}
```

## Screenshots

Landscape:
![Landscape](/src/assets/images/landscape.png "Landscape")

Portrait:
![Portrait](/src/assets/images/portrait.png "Portrait")

Minimal:
![Minimal](/src/assets/images/minimal.png "Minimal")

Low-power:
![Low-power](/src/assets/images/lowpower.png "Low-power")
