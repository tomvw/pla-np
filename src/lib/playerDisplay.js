export function format(ms, { forceHours = false } = {}) {
  const s = Math.floor(ms / 1000);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = String(s % 60).padStart(2, "0");

  if (forceHours || hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
  }

  return `${minutes}:${seconds}`;
}

export function getProgressPercent(session) {
  if (!session?.duration) return 0;
  return Math.max(
    0,
    Math.min(100, (session.localOffset / session.duration) * 100),
  );
}

function formatKbps(value) {
  const num = Number(value);
  if (!num || Number.isNaN(num)) return "";
  if (num >= 1000) {
    const mbps = Math.round((num / 1000) * 10) / 10;
    return `${Number.isInteger(mbps) ? mbps.toFixed(0) : mbps}Mbps`;
  }
  return `${Math.round(num)}kbps`;
}

function formatSamplingRate(value) {
  const num = Number(value);
  if (!num || Number.isNaN(num)) return "";
  const khz = Math.round((num / 1000) * 10) / 10;
  return `${Number.isInteger(khz) ? khz.toFixed(0) : khz}kHz`;
}

function pushUnique(parts, value) {
  if (value && !parts.includes(value)) parts.push(value);
}

function normalizeCodecLabel(value) {
  if (!value) return "";
  const codec = String(value).toUpperCase();
  const labels = {
    EAC3: "EAC3",
    "EAC-3": "EAC3",
    AC3: "AC3",
    H264: "H264",
    "H.264": "H264",
    AVC: "H264",
    HEVC: "HEVC",
    H265: "HEVC",
    "H.265": "HEVC",
    AAC: "AAC",
    TRUEHD: "TRUEHD",
    DTS: "DTS",
    FLAC: "FLAC",
    ASS: "ASS",
    SSA: "SSA",
    SRT: "SRT",
    PGS: "PGS",
  };
  return labels[codec] || codec.replace(/\s+/g, "");
}

function normalizeChannelLayout(value) {
  if (!value) return "";
  const raw = String(value).trim().toLowerCase();
  const compact = raw.replace(/\s+/g, "");

  const direct = compact.match(/^(\d+(?:\.\d+)?)(?:ch(?:annels?)?)?$/);
  if (direct) {
    const num = Number(direct[1]);
    if (num === 1) return "1.0";
    if (num === 2) return "2.0";
    if (num === 6) return "5.1";
    if (num === 8) return "7.1";
    return direct[1];
  }

  if (compact.includes("7.1")) return "7.1";
  if (compact.includes("6.1")) return "6.1";
  if (compact.includes("5.1")) return "5.1";
  if (compact.includes("stereo")) return "2.0";
  if (compact.includes("mono")) return "1.0";

  const namedChannels = new Set(
    compact
      .replace(/[()]/g, ",")
      .split(/[,/|+ -]+/)
      .filter(Boolean),
  );
  if (namedChannels.has("lfe")) {
    const fullRangeCount = [...namedChannels].filter((channel) => channel !== "lfe").length;
    if (fullRangeCount === 7) return "7.1";
    if (fullRangeCount === 5) return "5.1";
  }

  return raw;
}

function getVideoBadge(details = {}) {
  const parts = [];
  pushUnique(parts, details.resolution ? String(details.resolution).toUpperCase() : "");
  pushUnique(parts, normalizeCodecLabel(details.codec));
  pushUnique(parts, details.hdr);
  pushUnique(parts, formatKbps(details.bitrate));
  return parts.join(" / ");
}

function getAudioBadge(details = {}) {
  const parts = [];
  pushUnique(parts, details.language);
  pushUnique(parts, normalizeCodecLabel(details.codec));
  pushUnique(parts, normalizeChannelLayout(details.channels));
  return parts.join(" / ");
}

function getSubtitleBadge(details = {}) {
  const parts = [];
  pushUnique(parts, details.language);
  pushUnique(parts, normalizeCodecLabel(details.codec));
  pushUnique(parts, details.forced ? "Forced" : "");
  return parts.join(" / ");
}

export function getMediaInfoParts(session) {
  if (!session) return { codec: "", details: "", badges: [] };

  if (["movie", "show"].includes(session.viewType)) {
    const badgeEntries = [
      {
        label: session.playbackDecision?.label || "",
        type: session.playbackDecision?.type
          ? `decision-${session.playbackDecision.type}`
          : "",
      },
      {
        label: getVideoBadge(session.videoDetails || { codec: session.videoCodec }),
        type: "media-video",
      },
      {
        label: getAudioBadge(session.audioDetails || { codec: session.audioCodec }),
        type: "media-audio",
      },
      {
        label: getSubtitleBadge(session.subtitleDetails || { codec: session.subtitleCodec }),
        type: "media-subtitle",
      },
    ].filter((entry) => entry.label);
    const badges = badgeEntries.map((entry) => entry.label);
    const badgeTypes = badgeEntries.map((entry) => entry.type);

    return {
      codec: "",
      details: badges.join(" / "),
      badges,
      badgeTypes,
    };
  }

  const detailParts = [];
  if (session.samplingRate) detailParts.push(`${session.samplingRate}kHz`);
  if (session.bitDepth) detailParts.push(`${session.bitDepth}bit`);
  if (session.bitrate) detailParts.push(`${session.bitrate}kbps`);

  const badges = detailParts.length ? [detailParts.join(" / ")] : [];

  return {
    codec: session.codec || "",
    details: badges.join(" / "),
    badges,
    badgeTypes: badges.map(() => ""),
  };
}

export function getDisplayLines(session, fallbackArtist = "") {
  if (!session) {
    return {
      title: "",
      subtitle: "",
      detail: "",
      artAlt: "Artwork",
    };
  }

  if (session.viewType === "movie") {
    return {
      title: session.title || "Unknown Movie",
      subtitle: session.tagline || "",
      detail: session.year ? String(session.year) : "",
      artAlt: `${session.title || "Movie"} poster`,
    };
  }

  if (session.viewType === "show") {
    const hasSeasonNumber =
      session.seasonNumber !== undefined &&
      session.seasonNumber !== null &&
      session.seasonNumber !== "";
    const hasEpisodeNumber =
      session.episodeNumber !== undefined &&
      session.episodeNumber !== null &&
      session.episodeNumber !== "";
    const seasonEpisode = [
      hasSeasonNumber ? `S${String(session.seasonNumber).padStart(2, "0")}` : "",
      hasEpisodeNumber ? `E${String(session.episodeNumber).padStart(2, "0")}` : "",
    ]
      .filter(Boolean)
      .join("");
    const episodeDetail = [seasonEpisode, session.episodeTitle]
      .filter(Boolean)
      .join(" - ");

    return {
      title: session.showTitle || session.title || "Unknown Show",
      subtitle: episodeDetail,
      detail: session.year ? String(session.year) : "",
      artAlt: `${session.showTitle || "TV show"} poster`,
    };
  }

  return {
    title: session.title || "Unknown Track",
    subtitle: fallbackArtist || "Unknown Artist",
    detail: `${session.album || ""}${session.year ? ` (${session.year})` : ""}`,
    artAlt: `${session.title || "Album"} artwork`,
  };
}

export function getClientInfoParts(session, showUsername = true) {
  if (!session) return { badges: [] };

  const badges = [];
  if (session.product) badges.push(session.product);
  if (session.player) badges.push(session.player);
  if (showUsername && session.user) badges.push(session.user);

  return { badges };
}
