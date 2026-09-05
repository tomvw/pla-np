import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { LOG_LEVELS, parsePositiveInteger, validateConfig } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Frame-Options": "DENY",
  });
  next();
});
const PORT = parsePositiveInteger(process.env.PORT, 3000);

const DEFAULT_LOG_LEVEL = "info";
const REQUEST_TIMEOUT_MS = parsePositiveInteger(process.env.PLEX_REQUEST_TIMEOUT_MS, 10000);
const ART_MAX_BYTES = parsePositiveInteger(process.env.ART_MAX_BYTES, 10 * 1024 * 1024);
const CACHE_ADMIN_TOKEN = process.env.CACHE_ADMIN_TOKEN || "";
const RASTER_ART_CONTENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ALLOWED_ART_PATH_PREFIXES = [
  "/library/metadata/",
  "/photo/:/transcode",
];

function getLogLevel() {
  const configured = String(config?.LOG_LEVEL || DEFAULT_LOG_LEVEL).toLowerCase();
  return Object.hasOwn(LOG_LEVELS, configured) ? configured : DEFAULT_LOG_LEVEL;
}

function log(level, message, details) {
  if (LOG_LEVELS[level] > LOG_LEVELS[getLogLevel()]) return;
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  const output = details === undefined ? prefix : `${prefix} ${JSON.stringify(details)}`;
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
}

// Image cache configuration (top-level so it's initialized once)
const CACHE_DIR = path.resolve(__dirname, "..", "cache", "art");
const CACHE_TTL = parsePositiveInteger(process.env.ART_CACHE_TTL_SECONDS, 24 * 3600); // seconds
const CACHE_MAX_BYTES = parsePositiveInteger(process.env.ART_CACHE_MAX_BYTES, 200 * 1024 * 1024);
let CACHE_HITS = 0;
let CACHE_MISSES = 0;
let CACHE_REQUESTS = 0;
let LAST_CLEANUP = null;
try {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch (e) {
  log("error", "Failed to create artwork cache directory", { error: e.message });
}

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
    log("warn", "Cache cleanup failed", { error: err.message });
  }
  LAST_CLEANUP = Date.now();
}
// schedule cleanup (hourly)
setInterval(cleanupCache, 60 * 60 * 1000);
cleanupCache().catch(() => {});

// Load config from repo config/plex.config.json (kept out of frontend)
let config = {};
let configVersion = "";
let configErrors = [];
const cfgPath = path.resolve(__dirname, "..", "config", "plex.config.json");

function isImageCacheEnabled() {
  return config.IMAGE_CACHE_ENABLED === undefined
    ? true
    : Boolean(config.IMAGE_CACHE_ENABLED);
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(cfgPath, "utf8");
    const parsed = JSON.parse(raw);
    config = parsed || {};
    configErrors = validateConfig(config);
    configVersion = crypto.createHash("sha256").update(raw).digest("hex");
    log("info", "Loaded server config", {
      path: cfgPath,
      logLevel: getLogLevel(),
      plexUrl: config.PLEX_URL || null,
      configErrors,
    });
  } catch (err) {
    log("error", "Failed to load server config", { error: err.message, path: cfgPath });
  }
}

function ensureFreshConfig() {
  try {
    const raw = fs.readFileSync(cfgPath, "utf8");
    const nextVersion = crypto.createHash("sha256").update(raw).digest("hex");
    if (nextVersion !== configVersion) {
      log("info", "Configuration changed; reloading");
      loadConfig();
    }
  } catch (err) {
    log("warn", "Failed to read server config", { error: err.message });
  }
}

function getPlexHeaders({ accept = "application/json" } = {}) {
  return {
    Accept: accept,
    "X-Plex-Token": config.PLEX_TOKEN,
    "X-Plex-Product": "pla-np",
    "X-Plex-Client-Identifier": "pla-np",
    "X-Plex-Pms-Api-Version": "1.2.0",
  };
}

function normalizedFilterValues(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value).toLowerCase().trim()).filter(Boolean)
    : [];
}

function firstNestedValue(item, key) {
  const value = item?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function sessionMatchesFilters(session) {
  const players = normalizedFilterValues(config.PLAYERS);
  const users = normalizedFilterValues(config.USERS);
  const libraries = normalizedFilterValues(config.LIBRARIES);
  const player = String(firstNestedValue(session?.Player, "title") || "").toLowerCase().trim();
  const user = String(firstNestedValue(session?.User, "title") || "").toLowerCase().trim();
  const library = String(session?.librarySectionTitle || "").toLowerCase().trim();

  return (
    (!players.length || players.includes(player)) &&
    (!users.length || users.includes(user)) &&
    (!libraries.length || libraries.includes(library))
  );
}

function filterSessionPayload(payload) {
  if (!payload || typeof payload !== "object" || !payload.MediaContainer) {
    return payload;
  }
  const metadata = payload.MediaContainer.Metadata;
  if (!Array.isArray(metadata)) return payload;

  return {
    ...payload,
    MediaContainer: {
      ...payload.MediaContainer,
      Metadata: metadata.filter(sessionMatchesFilters),
    },
  };
}

function resolveArtworkUrl(thumb, plexUrlValue = config.PLEX_URL) {
  if (typeof thumb !== "string" || !thumb.trim()) throw new Error("Missing thumb");
  if (!thumb.startsWith("/") || thumb.startsWith("//")) {
    throw new Error("Artwork path must be relative");
  }
  let rawPath;
  try {
    rawPath = decodeURIComponent(thumb.split(/[?#]/, 1)[0]);
  } catch {
    throw new Error("Artwork path is invalid");
  }
  if (rawPath.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("Artwork path must not contain dot segments");
  }
  const plexUrl = new URL(plexUrlValue);
  const target = new URL(thumb, plexUrl);
  if (!ALLOWED_ART_PATH_PREFIXES.some((prefix) => target.pathname.startsWith(prefix))) {
    throw new Error("Unsupported artwork path");
  }
  target.searchParams.delete("X-Plex-Token");
  return target;
}

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

async function readLimitedBody(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Artwork response is too large");
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error("Artwork response is too large");
    return buffer;
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Artwork response is too large");
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function requireCacheAdmin(req, res, next) {
  if (!CACHE_ADMIN_TOKEN) return res.status(404).send("Not found");
  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : req.get("x-cache-admin-token");
  if (token !== CACHE_ADMIN_TOKEN) return res.status(401).send("Unauthorized");
  next();
}

// initial load
loadConfig();

// Watch the config file for changes and reload automatically.
// Use fs.watchFile for cross-platform stability and a 1s polling interval.
try {
  fs.watchFile(cfgPath, { interval: 1000 }, (curr, prev) => {
    // mtime changed
    if (curr.mtimeMs !== prev.mtimeMs) {
      log("info", "Configuration file changed; reloading");
      loadConfig();
    }
  });
} catch (err) {
  log("warn", "Failed to watch config file", { error: err.message });
}

// Serve built frontend
const distPath = path.resolve(__dirname, "..", "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// API: return public config (without token)
app.get("/api/config", (req, res) => {
  ensureFreshConfig();
  if (configErrors.length) return res.status(503).json({ error: "Invalid Plex configuration", details: configErrors });
  const { PLEX_TOKEN, ...publicCfg } = config || {};
  res.json({
    CONFIG_VERSION: publicCfg.CONFIG_VERSION || configVersion,
    SHOW_USERNAME: publicCfg.SHOW_USERNAME,
    SHOW_PROGRESS: publicCfg.SHOW_PROGRESS,
    SHOW_MEDIAINFO: publicCfg.SHOW_MEDIAINFO,
    SHOW_CLIENTINFO: publicCfg.SHOW_CLIENTINFO,
    LOW_POWER_MODE: publicCfg.LOW_POWER_MODE,
    LOG_LEVEL: getLogLevel(),
    ARTIST_DISPLAY: publicCfg.ARTIST_DISPLAY,
    PLAYERS: publicCfg.PLAYERS || [],
    USERS: publicCfg.USERS || [],
    LIBRARIES: publicCfg.LIBRARIES || [],
  });
});

// API: proxy sessions from Plex, keeping token server-side
app.get("/api/sessions", async (req, res) => {
  ensureFreshConfig();
  if (configErrors.length || !config || !config.PLEX_URL || !config.PLEX_TOKEN) {
    log("error", "Cannot connect to Plex: incomplete configuration", {
      hasUrl: Boolean(config?.PLEX_URL),
      hasToken: Boolean(config?.PLEX_TOKEN),
    });
    return res.status(500).send("Plex config not available");
  }
  const startedAt = Date.now();
  try {
    const url = `${config.PLEX_URL.replace(/\/$/, "")}/status/sessions`;
    log("debug", "Requesting Plex sessions", { url });
    const proxied = await fetchWithTimeout(url, {
      headers: getPlexHeaders(),
    });
    if (!proxied.ok) {
      log("warn", "Plex sessions request failed", {
        status: proxied.status,
        durationMs: Date.now() - startedAt,
      });
      return res.status(502).send("Failed to fetch sessions");
    }

    const contentType = proxied.headers.get("content-type") || "application/json";
    const text = await proxied.text();
    let responseBody = text;
    if (contentType.toLowerCase().includes("application/json")) {
      try {
        responseBody = JSON.stringify(filterSessionPayload(JSON.parse(text)));
      } catch (err) {
        log("warn", "Plex returned invalid JSON", { error: err.message });
        return res.status(502).send("Plex returned invalid session data");
      }
    }
    log("debug", "Plex sessions request succeeded", {
      status: proxied.status,
      durationMs: Date.now() - startedAt,
      bytes: Buffer.byteLength(text),
    });
    res.type(contentType).send(responseBody);
  } catch (err) {
    log("error", "Error connecting to Plex sessions", {
      error: err.message,
      durationMs: Date.now() - startedAt,
    });
    res.status(502).send("Failed to fetch sessions");
  }
});

// API: proxy artwork/thumbs so token is not exposed to clients
app.get("/api/art", async (req, res) => {
  ensureFreshConfig();
  const thumb = req.query.thumb;
  if (!thumb) return res.status(400).send("Missing thumb");
  if (configErrors.length || !config || !config.PLEX_URL || !config.PLEX_TOKEN) {
    log("error", "Cannot fetch artwork: incomplete Plex configuration");
    return res.status(500).send("Plex config not available");
  }
  CACHE_REQUESTS++;

  try {
    // Build target URL and a cache key that excludes the token
    let target;
    try {
      target = resolveArtworkUrl(thumb);
    } catch (err) {
      return res.status(400).send(err.message);
    }
    const targetUrl = target.toString();
    const keyStr = targetUrl;

    const hash = crypto.createHash("sha256").update(keyStr).digest("hex");
    const dataPath = path.join(CACHE_DIR, hash);
    const metaPath = dataPath + ".json";
    const cacheEnabled = isImageCacheEnabled();

    // Try cache hit
    if (cacheEnabled) {
      try {
        const metaRaw = await fs.promises
          .readFile(metaPath, "utf8")
          .catch(() => null);
        if (metaRaw) {
          const meta = JSON.parse(metaRaw);
          const cachedContentType = String(meta.contentType || "image/jpeg")
            .split(";", 1)[0]
            .trim()
            .toLowerCase();
          if (
            RASTER_ART_CONTENT_TYPES.has(cachedContentType) &&
            Date.now() - (meta.timestamp || 0) <= CACHE_TTL * 1000
          ) {
            const stat = await fs.promises.stat(dataPath).catch(() => null);
            if (stat) {
              CACHE_HITS++;
              res.set("content-type", cachedContentType);
              res.set("content-disposition", "inline");
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
        log("warn", "Cache read failed", { error: err.message });
      }
    }

    // Miss: fetch from Plex and cache when enabled
    CACHE_MISSES++;
    const proxied = await fetchWithTimeout(targetUrl, {
      redirect: "error",
      headers: getPlexHeaders({ accept: "image/*,*/*" }),
    });
    if (!proxied.ok) {
      log("warn", "Plex artwork request failed", { status: proxied.status });
      return res.status(502).send("Failed to fetch art");
    }
    const contentType = (proxied.headers.get("content-type") || "image/jpeg")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!RASTER_ART_CONTENT_TYPES.has(contentType)) {
      return res.status(502).send("Plex returned a non-image artwork response");
    }
    const buffer = await readLimitedBody(proxied, ART_MAX_BYTES);

    if (cacheEnabled) {
      const tempSuffix = `${process.pid}.${crypto.randomUUID()}`;
      const dataTempPath = `${dataPath}.${tempSuffix}.tmp`;
      const metaTempPath = `${metaPath}.${tempSuffix}.tmp`;
      const meta = { timestamp: Date.now(), contentType, size: buffer.length };
      try {
        await fs.promises.writeFile(dataTempPath, buffer);
        await fs.promises.rename(dataTempPath, dataPath);
        await fs.promises.writeFile(metaTempPath, JSON.stringify(meta));
        await fs.promises.rename(metaTempPath, metaPath);
      } finally {
        await Promise.all([
          fs.promises.unlink(dataTempPath).catch(() => {}),
          fs.promises.unlink(metaTempPath).catch(() => {}),
        ]);
      }
    }

    res.set("content-type", contentType);
    res.set("content-disposition", "inline");
    res.set(
      "cache-control",
      cacheEnabled
        ? `public, max-age=${Math.min(CACHE_TTL, 86400)}`
        : "no-store",
    );
    res.send(buffer);
  } catch (err) {
    log("error", "Error fetching artwork from Plex", { error: err.message });
    res.status(502).send("Failed to fetch art");
  }
});

// Cache stats endpoint
app.get("/api/cache-stats", requireCacheAdmin, async (req, res) => {
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
      enabled: isImageCacheEnabled(),
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
app.post("/api/cache-clear", requireCacheAdmin, async (req, res) => {
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

app.get("/api/health", (req, res) => {
  ensureFreshConfig();
  if (configErrors.length) return res.status(503).json({ status: "unhealthy", details: configErrors });
  res.json({ status: "ok" });
});

// Fallback to index.html for SPA routes (but don't catch API routes).
// Express 5 requires named wildcards; `/{*splat}` also matches `/`.
app.get("/{*splat}", (req, res) => {
  if (req.path && req.path.startsWith("/api/"))
    return res.status(404).send("Not found");
  const indexPath = path.resolve(distPath, "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).send("Not found");
});

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  app.listen(PORT, () => {
  log("info", "Server listening", { port: PORT, logLevel: getLogLevel() });
  });
}

export { app, filterSessionPayload, resolveArtworkUrl, readLimitedBody };
