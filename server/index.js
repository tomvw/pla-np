import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Image cache configuration (top-level so it's initialized once)
const CACHE_DIR = path.resolve(__dirname, "..", "cache", "art");
const CACHE_TTL = parseInt(
  process.env.ART_CACHE_TTL_SECONDS || String(24 * 3600),
  10,
); // seconds
const CACHE_MAX_BYTES = parseInt(
  process.env.ART_CACHE_MAX_BYTES || String(200 * 1024 * 1024),
  10,
); // default 200MB
let CACHE_HITS = 0;
let CACHE_MISSES = 0;
let CACHE_REQUESTS = 0;
let LAST_CLEANUP = null;
try {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch (e) {}

// Cache cleanup function (removes expired files and enforces max size)
async function cleanupCache() {
  try {
    const files = await fs.promises.readdir(CACHE_DIR);
    const metas = [];
    let total = 0;
    for (const name of files) {
      if (!name.endsWith(".json")) continue;
      const metaPath = path.join(CACHE_DIR, name);
      try {
        const meta = JSON.parse(await fs.promises.readFile(metaPath, "utf8"));
        const dataPath = metaPath.replace(/\.json$/, "");
        const stat = await fs.promises.stat(dataPath).catch(() => null);
        if (!stat) {
          await fs.promises.unlink(metaPath).catch(() => {});
          continue;
        }
        metas.push({
          meta,
          metaPath,
          dataPath,
          mtime: meta.timestamp || stat.mtimeMs,
          size: stat.size,
        });
        total += stat.size;
      } catch (err) {
        await fs.promises.unlink(metaPath).catch(() => {});
      }
    }
    const now = Date.now();
    // remove expired
    for (const item of metas) {
      if (now - (item.meta.timestamp || 0) > CACHE_TTL * 1000) {
        await Promise.all([
          fs.promises.unlink(item.dataPath).catch(() => {}),
          fs.promises.unlink(item.metaPath).catch(() => {}),
        ]);
        total -= item.size;
      }
    }
    // enforce max size by deleting oldest
    const remaining = metas.filter(
      (item) => now - (item.meta.timestamp || 0) <= CACHE_TTL * 1000,
    );
    if (total > CACHE_MAX_BYTES) {
      remaining.sort(
        (a, b) => (a.meta.timestamp || 0) - (b.meta.timestamp || 0),
      );
      for (const item of remaining) {
        await Promise.all([
          fs.promises.unlink(item.dataPath).catch(() => {}),
          fs.promises.unlink(item.metaPath).catch(() => {}),
        ]);
        total -= item.size;
        if (total <= CACHE_MAX_BYTES) break;
      }
    }
  } catch (err) {
    console.warn("Cache cleanup error", err);
  }
  LAST_CLEANUP = Date.now();
}
// schedule cleanup (hourly)
setInterval(cleanupCache, 60 * 60 * 1000);
cleanupCache().catch(() => {});

// Load config from repo config/plex.config.json (kept out of frontend)
let config = {};
let configVersion = 0;
const cfgPath = path.resolve(__dirname, "..", "config", "plex.config.json");

function loadConfig() {
  try {
    const raw = fs.readFileSync(cfgPath, "utf8");
    const parsed = JSON.parse(raw);
    config = parsed || {};
    const stat = fs.statSync(cfgPath);
    configVersion = stat.mtimeMs;
    console.log("Loaded server config from", cfgPath);
  } catch (err) {
    console.warn("Failed to load server config:", err.message);
  }
}

// initial load
loadConfig();

// Watch the config file for changes and reload automatically.
// Use fs.watchFile for cross-platform stability and a 1s polling interval.
try {
  fs.watchFile(cfgPath, { interval: 1000 }, (curr, prev) => {
    // mtime changed
    if (curr.mtimeMs !== prev.mtimeMs) {
      console.log("plex.config.json changed — reloading config");
      loadConfig();
    }
  });
} catch (err) {
  console.warn("Failed to watch config file for changes:", err.message);
}

// Serve built frontend
const distPath = path.resolve(__dirname, "..", "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// API: return public config (without token)
app.get("/api/config", (req, res) => {
  const { PLEX_TOKEN, ...publicCfg } = config || {};
  res.json({
    CONFIG_VERSION: publicCfg.CONFIG_VERSION || configVersion,
    PLEX_URL: publicCfg.PLEX_URL,
    SHOW_USERNAME: publicCfg.SHOW_USERNAME,
    SHOW_PROGRESS: publicCfg.SHOW_PROGRESS,
    SHOW_MEDIAINFO: publicCfg.SHOW_MEDIAINFO,
    SHOW_CLIENTINFO: publicCfg.SHOW_CLIENTINFO,
    ARTIST_DISPLAY: publicCfg.ARTIST_DISPLAY,
    PLAYERS: publicCfg.PLAYERS || [],
    USERS: publicCfg.USERS || [],
    LIBRARIES: publicCfg.LIBRARIES || [],
  });
});

// API: proxy sessions XML from Plex, keeping token server-side
app.get("/api/sessions", async (req, res) => {
  if (!config || !config.PLEX_URL || !config.PLEX_TOKEN) {
    return res.status(500).send("Plex config not available");
  }
  try {
    const url = `${config.PLEX_URL.replace(/\/$/, "")}/status/sessions?X-Plex-Token=${config.PLEX_TOKEN}`;
    const proxied = await fetch(url);
    const text = await proxied.text();
    res.type("application/xml").send(text);
  } catch (err) {
    console.error("Error proxying sessions:", err);
    res.status(502).send("Failed to fetch sessions");
  }
});

// API: proxy artwork/thumbs so token is not exposed to clients
app.get("/api/art", async (req, res) => {
  const thumb = req.query.thumb;
  if (!thumb) return res.status(400).send("Missing thumb");
  if (!config || !config.PLEX_URL || !config.PLEX_TOKEN)
    return res.status(500).send("Plex config not available");
  CACHE_REQUESTS++;

  try {
    // Build target URL and a cache key that excludes the token
    let targetUrl;
    let keyStr;
    try {
      if (thumb.startsWith("http://") || thumb.startsWith("https://")) {
        const u = new URL(thumb);
        u.searchParams.delete("X-Plex-Token");
        keyStr = u.toString();
        targetUrl = thumb;
      } else {
        const base = config.PLEX_URL.replace(/\/$/, "");
        keyStr = `${base}${thumb}`;
        targetUrl = `${base}${thumb}`;
      }
    } catch (err) {
      keyStr = thumb;
      targetUrl = thumb.startsWith("/")
        ? `${config.PLEX_URL.replace(/\/$/, "")}${thumb}`
        : thumb;
    }

    const hash = crypto.createHash("sha256").update(keyStr).digest("hex");
    const dataPath = path.join(CACHE_DIR, hash);
    const metaPath = dataPath + ".json";

    // Try cache hit
    try {
      const metaRaw = await fs.promises
        .readFile(metaPath, "utf8")
        .catch(() => null);
      if (metaRaw) {
        const meta = JSON.parse(metaRaw);
        if (Date.now() - (meta.timestamp || 0) <= CACHE_TTL * 1000) {
          const stat = await fs.promises.stat(dataPath).catch(() => null);
          if (stat) {
            CACHE_HITS++;
            res.set("content-type", meta.contentType || "image/jpeg");
            res.set(
              "cache-control",
              `public, max-age=${Math.min(CACHE_TTL, 86400)}`,
            );
            return res.sendFile(dataPath);
          }
        } else {
          // expired
          await Promise.all([
            fs.promises.unlink(dataPath).catch(() => {}),
            fs.promises.unlink(metaPath).catch(() => {}),
          ]);
        }
      }
    } catch (err) {
      console.warn("Cache read error", err);
    }

    // Miss: fetch from Plex and cache
    CACHE_MISSES++;
    const sep = targetUrl.includes("?") ? "&" : "?";
    const fetchUrl = `${targetUrl}${sep}X-Plex-Token=${config.PLEX_TOKEN}`;
    const proxied = await fetch(fetchUrl);
    if (!proxied.ok) return res.status(502).send("Failed to fetch art");
    const contentType = proxied.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await proxied.arrayBuffer());

    // atomic write
    await fs.promises.writeFile(dataPath + ".tmp", buffer);
    await fs.promises.rename(dataPath + ".tmp", dataPath);
    const meta = { timestamp: Date.now(), contentType, size: buffer.length };
    await fs.promises.writeFile(metaPath, JSON.stringify(meta));

    res.set("content-type", contentType);
    res.set("cache-control", `public, max-age=${Math.min(CACHE_TTL, 86400)}`);
    res.send(buffer);
  } catch (err) {
    console.error("Error proxying art:", err);
    res.status(502).send("Failed to fetch art");
  }
});

// Cache stats endpoint
app.get("/api/cache-stats", async (req, res) => {
  try {
    const files = await fs.promises.readdir(CACHE_DIR);
    let total = 0;
    let count = 0;
    let oldest = Infinity;
    let newest = 0;
    const top = [];
    for (const name of files) {
      if (!name.endsWith(".json")) continue;
      const metaPath = path.join(CACHE_DIR, name);
      try {
        const meta = JSON.parse(await fs.promises.readFile(metaPath, "utf8"));
        const dataPath = metaPath.replace(/\.json$/, "");
        const stat = await fs.promises.stat(dataPath).catch(() => null);
        if (!stat) continue;
        total += stat.size;
        count += 1;
        const ts = meta.timestamp || stat.mtimeMs;
        if (ts < oldest) oldest = ts;
        if (ts > newest) newest = ts;
        top.push({
          key: name.replace(/\.json$/, ""),
          size: stat.size,
          timestamp: ts,
        });
      } catch (err) {
        // ignore
      }
    }
    top.sort((a, b) => b.size - a.size);
    const largest = top.slice(0, 10);
    const hitRate =
      CACHE_HITS + CACHE_MISSES > 0
        ? CACHE_HITS / (CACHE_HITS + CACHE_MISSES)
        : null;
    res.json({
      hits: CACHE_HITS,
      misses: CACHE_MISSES,
      requests: CACHE_REQUESTS,
      hitRate,
      totalBytes: total,
      fileCount: count,
      oldest: isFinite(oldest) ? oldest : null,
      newest: newest || null,
      largest,
    });
  } catch (err) {
    res.status(500).json({ error: "failed" });
  }
});

// Clear the cache (POST). Optional query `reset=true` to reset hit/miss/request counters.
app.post("/api/cache-clear", async (req, res) => {
  try {
    const files = await fs.promises.readdir(CACHE_DIR);
    let freed = 0;
    let removed = 0;
    for (const name of files) {
      if (name.endsWith(".json")) {
        const metaPath = path.join(CACHE_DIR, name);
        const dataPath = metaPath.replace(/\.json$/, "");
        const stat = await fs.promises.stat(dataPath).catch(() => null);
        if (stat) freed += stat.size;
        await Promise.all([
          fs.promises.unlink(dataPath).catch(() => {}),
          fs.promises.unlink(metaPath).catch(() => {}),
        ]);
        removed += 1;
      }
    }
    if (req.query.reset === "true") {
      CACHE_HITS = 0;
      CACHE_MISSES = 0;
      CACHE_REQUESTS = 0;
    }
    LAST_CLEANUP = Date.now();
    res.json({ removed, freedBytes: freed });
  } catch (err) {
    res.status(500).json({ error: "failed" });
  }
});

// Fallback to index.html for SPA routes (but don't catch API routes)
app.get("*", (req, res) => {
  if (req.path && req.path.startsWith("/api/"))
    return res.status(404).send("Not found");
  const indexPath = path.resolve(distPath, "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).send("Not found");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
