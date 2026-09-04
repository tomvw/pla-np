export const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

const OPTIONAL_BOOLEAN_KEYS = [
  "SHOW_USERNAME",
  "SHOW_PROGRESS",
  "SHOW_MEDIAINFO",
  "SHOW_CLIENTINFO",
  "LOW_POWER_MODE",
  "IMAGE_CACHE_ENABLED",
];

const OPTIONAL_LIST_KEYS = ["PLAYERS", "USERS", "LIBRARIES"];

export function validateConfig(value) {
  const errors = [];
  const config = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  if (typeof config.PLEX_URL !== "string" || !config.PLEX_URL.trim()) {
    errors.push("PLEX_URL must be a non-empty string");
  } else {
    try {
      const url = new URL(config.PLEX_URL);
      if (!["http:", "https:"].includes(url.protocol)) errors.push("PLEX_URL must use http or https");
    } catch {
      errors.push("PLEX_URL must be a valid URL");
    }
  }
  if (typeof config.PLEX_TOKEN !== "string" || !config.PLEX_TOKEN.trim()) {
    errors.push("PLEX_TOKEN must be a non-empty string");
  }
  if (config.LOG_LEVEL !== undefined && !Object.hasOwn(LOG_LEVELS, String(config.LOG_LEVEL).toLowerCase())) {
    errors.push("LOG_LEVEL is invalid");
  }
  if (config.ARTIST_DISPLAY !== undefined && !["track", "album", "both"].includes(config.ARTIST_DISPLAY)) {
    errors.push("ARTIST_DISPLAY must be track, album, or both");
  }
  for (const key of OPTIONAL_BOOLEAN_KEYS) {
    if (config[key] !== undefined && typeof config[key] !== "boolean") errors.push(`${key} must be boolean`);
  }
  for (const key of OPTIONAL_LIST_KEYS) {
    if (config[key] !== undefined && !Array.isArray(config[key])) errors.push(`${key} must be an array`);
    if (Array.isArray(config[key]) && config[key].some((item) => typeof item !== "string")) errors.push(`${key} must contain only strings`);
  }
  return errors;
}

export function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
