# pla-np

A lightweight Plex “Now Playing” display for music built with Svelte.

The project was vibe-coded with AI assistance. It is shared transparently as an experimental personal project; review and adapt the configuration and deployment setup for your own environment.

## Features

- Responsive layouts from 480p to 4K
- Portrait and landscape modes
- Multi-session slideshow for active players
- Filtering by player, user, and library
- Optional progress, media, and client information
- Low-power mode
- Server-side artwork caching

## Security and network exposure

pla-np is intended for a trusted local network or VPN. Its main API endpoints are intentionally unauthenticated and expose Plex now-playing metadata to anyone who can reach the service.

Exposing the app directly to the public internet is at your own risk. If it must be reachable beyond your private network, use HTTPS and put it behind an authenticated reverse proxy or private access network. Do not expose the Node port directly without understanding this risk.

## Quick start with Docker

Create `config/plex.config.json` from [`config/plex.config.json.example`](config/plex.config.json.example), then set your Plex URL and token.

Run the published image:

```bash
docker run -d \
  --name pla-np \
  -p 3000:3000 \
  -v /path/to/config:/app/config:ro \
  --restart unless-stopped \
  ghcr.io/tomvw/pla-np:latest
```

Or use Docker Compose:

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

The app will be available at `http://localhost:3000`.

## Configuration

Copy the example file to `config/plex.config.json` and update it:

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
| `PLEX_URL` | URL | URL of the Plex server. HTTPS is recommended. |
| `PLEX_TOKEN` | string | Plex authentication token. See [Plex’s token guide](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/). |
| `LOG_LEVEL` | `silent`, `error`, `warn`, `info`, `debug` | Server and browser logging level. |
| `PLAYERS` | string array | Players to include; an empty array disables this filter. |
| `USERS` | string array | Users to include; an empty array disables this filter. |
| `LIBRARIES` | string array | Libraries to include; an empty array disables this filter. |
| `ARTIST_DISPLAY` | `track`, `album`, `both` | Artist information to display. |
| `SHOW_USERNAME` | boolean | Show usernames in client information. |
| `SHOW_MEDIAINFO` | boolean | Show codec, sampling rate, bit depth, and bitrate. |
| `SHOW_CLIENTINFO` | boolean | Show player, device, and user information. |
| `SHOW_PROGRESS` | boolean | Show track progress and elapsed time. |
| `LOW_POWER_MODE` | boolean | Reduce animation and refresh work. |
| `IMAGE_CACHE_ENABLED` | boolean | Enable the server-side artwork cache. |

Configuration is kept server-side. The Plex token is not sent to the browser. Changes are detected automatically while the server is running.

## Artwork cache

Artwork is cached on the server by default. Cached files expire after the configured TTL and are removed during cache reads or periodic cleanup.

Set `IMAGE_CACHE_ENABLED` to `false` to disable caching. With caching disabled, artwork responses use `Cache-Control: no-store`.

### Cache administration

Cache administration is disabled unless `CACHE_ADMIN_TOKEN` is set. When it is configured, use a long random secret and send it as a Bearer token:

```bash
export CACHE_ADMIN_TOKEN="replace-with-a-long-random-secret"

curl -H "Authorization: Bearer $CACHE_ADMIN_TOKEN" \
  http://localhost:3000/api/cache-stats

curl -X POST -H "Authorization: Bearer $CACHE_ADMIN_TOKEN" \
  http://localhost:3000/api/cache-clear
```

Add `?reset=true` to `/api/cache-clear` to reset cache counters as well.

Treat `CACHE_ADMIN_TOKEN` like a password. Do not put it in the Plex JSON configuration, frontend code, URLs, or publicly accessible images. Use HTTPS or a trusted private network when sending it over a network.

### Server environment variables

| Variable | Default | Description |
| :-- | --: | :-- |
| `PORT` | `3000` | TCP port used by the application. |
| `PLEX_REQUEST_TIMEOUT_MS` | `10000` | Timeout for Plex sessions and artwork requests. |
| `ART_MAX_BYTES` | `10485760` | Maximum size of one artwork response, in bytes. |
| `ART_CACHE_TTL_SECONDS` | `86400` | Artwork cache lifetime, in seconds. |
| `ART_CACHE_MAX_BYTES` | `209715200` | Maximum total artwork cache size, in bytes. |
| `CACHE_ADMIN_TOKEN` | unset | Enables cache administration endpoints. |

For Docker Compose, pass the admin token through the environment rather than storing it in the image:

```yaml
services:
  pla-np:
    environment:
      CACHE_ADMIN_TOKEN: ${CACHE_ADMIN_TOKEN}
```

## Running from source

Requirements:

- Node `26.8.1`
- npm `11.19.0`

Install dependencies, build the frontend, and start the server:

```bash
npm ci
npm run build
npm start
```

For development with Vite:

```bash
npm run dev
```

Useful checks:

```bash
npm test
npm run check
npm run build
```

## Screenshots

![Landscape](/src/assets/images/landscape.png "Landscape")

![Portrait](/src/assets/images/portrait.png "Portrait")

![Minimal](/src/assets/images/minimal.png "Minimal")

![Low-power](/src/assets/images/lowpower.png "Low-power")
