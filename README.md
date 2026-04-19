# pla-np

A Plex/Plexamp Now Playing page made in Svelte 5.

## Features

- **Responsive design:** Supports displays from 480p up to 4K, both in portrait and landscape
- **Supports multiple sessions:** When multiple players are active, a slideshow will cycle between them
- **Customizable:** Toggle certain UI elements on and off to suit your taste
- **Filtering:** Filter by players, users or libraries

## Installation

### Docker

Copy the example `plex.config.json.example` to `/path/to/config`, rename it to `plex.config.json` and edit.

Docker run:

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

If you use `nvm`, run:

```bash
nvm use
```

Clone the repo, edit and rename `plex.config.json.example` and run the following commands:

```bash
npm ci
npm run build
npm start
```

Your instance will be available at `http://localhost:3000`

## Configuration

Example config file:

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
  "LOW_POWER_MODE": false
}
```

Config reference:

| Option              | Values                               | Explanation                                                                         |
| :------------------ | ------------------------------------ | ----------------------------------------------------------------------------------- |
| **`PLEX_URL`**        | `"http://your.plex.url"`             | The URL of your Plex instance[^1]                                                   |
| **`PLEX_TOKEN`**      | `"your-plex-token"`                  | Your Plex token[^2]                                                                     |
| **`PLAYERS`**         | `["rapsberrypi", "android"]` or `[]` | A comma-seperated list of players you want to filter by or empty for no filtering   |
| **`USERS`**           | `["bob", "jane"]` or `[]`            | A comma-seperated list of users you want to filter by or empty for no filtering     |
| **`LIBRARIES`**       | `["music", "chiptunes"]` or `[]`     | A comma-seperated list of libraries you want to filter by or empty for no filtering |
| **`ARTIST_DISPLAY`**  | `"track"`, `"album"` or `"both"`     | Shows either track artist, album artist or both                                     |
| **`SHOW_USERNAME`**   | `true` or `false`                    | Show usernames                                                                      |
| **`SHOW_MEDIAINFO`**  | `true` or `false`                    | Show media info (codec, sampling rate, bit depth, bitrate)                          |
| **`SHOW_CLIENTINFO`** | `true` or `false`                    | Show client info (player, device, user)                                             |
| **`SHOW_PROGRESS`**   | `true` or `false`                    | Show the song progress bar[^3]                                                      |
| **`LOW_POWER_MODE`**  | `true` or `false`                    | Reduces animations and effects, lowers polling frequency, and replaces marquee text with ellipsis for lower powered devices               |

## Screenshots

Landscape view:
![Landscape](/src/assets/images/landscape.png "Landscape")
Portrait view:
![Portrait](/src/assets/images/portrait.png "Portrait")
Minimal view:
![Minimal](/src/assets/images/minimal.png "Minimal")
Low-power view:
![Low-power](/src/assets/images/lowpower.png "Low-power")

#### ⚠️This project was vibe-coded using Codex

[^1]: _Doesn't support self-signed certificates_
[^2]: https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/
[^3]: _Song progress doesn't match exactly_
