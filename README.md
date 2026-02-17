# pla-np

A Plex/Plexamp Now Playing page made in Svelte.

## Features

- **Responsive design:** Supports displays from 480p up to 4K, both in portrait and landscape
- **Supports multiple sessions:** When multiple players are active, a slideshow will cycle between them
- **Filtering:** Filter by players, users or libraries

## Installation

### Docker

Docker run:

```bash
docker run -d \
  --name pla-np \
  -p 3000:3000 \
  -v /path/to/config/plex.config.json:/app/config/plex.config.json:ro \
  --restart unless-stopped \
  tomvw/pla-np:latest
```

or docker compose:

```yaml
services:
  pla-np:
    image: tomvw/pla-np:latest
    container_name: pla-np
    ports:
      - "3000:3000"
    volumes:
      - /path/to/config/plex.config.json:/app/config/plex.config.json:ro
    restart: unless-stopped
```

### From Source

Clone the repo, edit and rename the `plex.config.json.example` file and run the following commands:

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
  "SHOW_PROGRESS": true
}
```

Config reference:

| Option              | Values                               | Explanation                                                                         |
| :------------------ | ------------------------------------ | ----------------------------------------------------------------------------------- |
| **PLEX_URL**        | `"http://your.plex.url"`             | The URL of your Plex instance[^1]                                                   |
| **PLEX_TOKEN**      | `"your-plex-token"`                  | Your Plex token                                                                     |
| **PLAYERS**         | `["rapsberrypi", "android"]` or `[]` | A comma-seperated list of players you want to filter by or empty for no filtering   |
| **USERS**           | `["bob", "jane"]` or `[]`            | A comma-seperated list of users you want to filter by or empty for no filtering     |
| **LIBRARIES**       | `["music", "chiptunes"]` or `[]`     | A comma-seperated list of libraries you want to filter by or empty for no filtering |
| **ARTIST_DISPLAY**  | `"track"`, `"album"` or `"both"`     | Shows eather track artist, album artist or both                                     |
| **SHOW_USERNAME**   | `true` or `false`                    | Show usernames                                                                      |
| **SHOW_MEDIAINFO**  | `true` or `false`                    | Show media info (codec, sampling rate, bit depth, bitrate)                          |
| **SHOW_CLIENTINFO** | `true` or `false`                    | Show client info (player, device, user)                                             |
| **SHOW_PROGRESS**   | `true` or `false`                    | Show the song progress bar[^2]                                                      |

[^1]: _Doesn't support self-signed certificates_

[^2]: _Song progress is very inaccurate and more for looks_
