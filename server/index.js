import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Load config from repo config/plex.config.json (kept out of frontend)
let config = {};
try {
  const cfgPath = path.resolve(__dirname, '..', 'config', 'plex.config.json');
  config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
} catch (err) {
  console.warn('Failed to load server config:', err.message);
}

// Serve built frontend
const distPath = path.resolve(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// API: return public config (without token)
app.get('/api/config', (req, res) => {
  const { PLEX_TOKEN, ...publicCfg } = config || {};
  res.json({
    PLEX_URL: publicCfg.PLEX_URL,
    PLAYERS: publicCfg.PLAYERS || [],
    USERS: publicCfg.USERS || [],
    LIBRARIES: publicCfg.LIBRARIES || []
  });
});

// API: proxy sessions XML from Plex, keeping token server-side
app.get('/api/sessions', async (req, res) => {
  if (!config || !config.PLEX_URL || !config.PLEX_TOKEN) {
    return res.status(500).send('Plex config not available');
  }
  try {
    const url = `${config.PLEX_URL.replace(/\/$/, '')}/status/sessions?X-Plex-Token=${config.PLEX_TOKEN}`;
    const proxied = await fetch(url);
    const text = await proxied.text();
    res.type('application/xml').send(text);
  } catch (err) {
    console.error('Error proxying sessions:', err);
    res.status(502).send('Failed to fetch sessions');
  }
});

// API: proxy artwork/thumbs so token is not exposed to clients
app.get('/api/art', async (req, res) => {
  const thumb = req.query.thumb;
  if (!thumb) return res.status(400).send('Missing thumb');
  if (!config || !config.PLEX_URL || !config.PLEX_TOKEN) return res.status(500).send('Plex config not available');

  try {
    // thumb can be a path like /photo/... or a full URL; build a proper URL
    let url;
    if (thumb.startsWith('http://') || thumb.startsWith('https://')) {
      url = thumb;
    } else {
      url = `${config.PLEX_URL.replace(/\/$/, '')}${thumb}`;
    }
    const sep = url.includes('?') ? '&' : '?';
    url = `${url}${sep}X-Plex-Token=${config.PLEX_TOKEN}`;

    const proxied = await fetch(url);
    if (!proxied.ok) return res.status(502).send('Failed to fetch art');
    // pipe content-type and data
    res.set('content-type', proxied.headers.get('content-type') || 'image/jpeg');
    const buffer = await proxied.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Error proxying art:', err);
    res.status(502).send('Failed to fetch art');
  }
});

// Fallback to index.html for SPA routes
app.get('*', (req, res) => {
  const indexPath = path.resolve(distPath, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).send('Not found');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
