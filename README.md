# pla-np

A Plex/Plexamp Now Playing page made in Svelte.

## Installation

### Using NPM

Clone the repo, edit and rename the ```plex.config.json.example``` file and run the following commands:

```bash
npm ci
npm run build
npm start
```

Your instance will be available at ```http://localhost:3000```

### Docker

```bash
docker run -d --name pla-np -p 3000:3000 -v /path/to/config/plex.config.json:/app/config/plex.config.json:ro" --restart unless-stopped tomvw/pla-np:latest
```

### Docker Compose

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

```bash
docker compose pull && docker compose up -d
```