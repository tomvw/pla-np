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

- Node `25.9.0`
- npm `11.12.1`

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

## Configuration

Example `plex.config.json`:

```json
{
  "PLEX_URL": "http://your.plex.url",
  "PLEX_TOKEN": "your-plex-token",
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

Clear the cache:

```text
http://localhost:3000/api/cache-clear
```

Example:

```bash
curl -X POST http://localhost:3000/api/cache-clear
```

Clear the cache and reset the counters:

```bash
curl -X POST "http://localhost:3000/api/cache-clear?reset=true"
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
