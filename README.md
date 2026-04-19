# pla-np

A Plex/Plexamp Now Playing page made in Svelte 5.

## Features

- Responsive layout from 480p to 4K, in both portrait and landscape
- Multi-session slideshow when more than one player is active
- Configurable UI options for a cleaner or more detailed display
- Optional filtering by players, users, and libraries

## Installation

### Docker

Copy `plex.config.json.example` to your config directory, rename it to `plex.config.json`, and edit it.

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

This project targets Node `25.9.0` and npm `11.12.1`.

If you use `nvm`:

```bash
nvm use
```

Then clone the repo, create `config/plex.config.json`, and run:

```bash
npm ci
npm run build
npm start
```

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

Config reference:

| Option | Values | Description |
| :-- | :-- | :-- |
| `PLEX_URL` | `"http://your.plex.url"` | URL of your Plex instance[^1] |
| `PLEX_TOKEN` | `"your-plex-token"` | Plex token[^2] |
| `PLAYERS` | `["raspberrypi", "android"]` or `[]` | List of players to include, or empty for no filtering |
| `USERS` | `["bob", "jane"]` or `[]` | List of users to include, or empty for no filtering |
| `LIBRARIES` | `["music", "chiptunes"]` or `[]` | List of libraries to include, or empty for no filtering |
| `ARTIST_DISPLAY` | `"track"`, `"album"` or `"both"` | Show track artist, album artist, or both |
| `SHOW_USERNAME` | `true` or `false` | Show usernames |
| `SHOW_MEDIAINFO` | `true` or `false` | Show codec, sampling rate, bit depth, and bitrate |
| `SHOW_CLIENTINFO` | `true` or `false` | Show player, device, and user info |
| `SHOW_PROGRESS` | `true` or `false` | Show the song progress bar[^3] |
| `LOW_POWER_MODE` | `true` or `false` | Reduce effects, lower refresh work, and replace marquee text with ellipsis |
| `IMAGE_CACHE_ENABLED` | `true` or `false` | Enable or disable the server-side artwork cache |

## Image Cache

Artwork requested through `/api/art` is cached on the server by default to reduce repeat Plex fetches and make slide changes smoother.

Disable the cache in `plex.config.json`:

```json
"IMAGE_CACHE_ENABLED": false
```

When disabled, artwork is fetched directly from Plex for each request and the server responds with `Cache-Control: no-store`.

Check cache stats:

```text
http://localhost:3000/api/cache-stats
```

The response includes whether the cache is enabled, request counters, hit rate, file count, total size, and the largest cached items.

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

## Notes

This project was built with Codex.

[^1]: _Doesn't support self-signed certificates_
[^2]: https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/
[^3]: _Song progress doesn't match exactly_
