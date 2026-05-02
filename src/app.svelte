<svelte:options runes={true} />

<script>
  import { onMount, onDestroy } from "svelte";
  import SessionSlide from "./components/SessionSlide.svelte";
  import {
    getClientInfoParts,
    getDisplayLines,
    getMediaInfoParts,
  } from "./lib/playerDisplay.js";

  let progressTimer;
  let rotationTimer;
  let refreshTimer;

  let sessions = $state([]);
  let activeIndex = $state(0);
  let config = $state();
  let configLoaded = $state(false);
  let configVersion = $state(null);
  let pageVisible = $state(true);

  let ALLOWED_PLAYERS = [];
  let ALLOWED_USERS = [];
  let ALLOWED_LIBRARIES = [];
  let ARTIST_DISPLAY = $state("both");
  let SHOW_USERNAME = $state(true);
  let SHOW_PROGRESS = $state(false);
  let SHOW_MEDIAINFO = $state(true);
  let SHOW_CLIENTINFO = $state(true);
  let LOW_POWER_MODE = $state(false);
  const SESSION_ROTATION_MS = 14000;
  const LOW_POWER_PROGRESS_INTERVAL_MS = 2000;
  const DEFAULT_PROGRESS_INTERVAL_MS = 750;
  const TRACK_TRANSITION_MS = 2800;
  const TRACK_TRANSITION_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
  const TRACK_TRANSITION_CLEANUP_MS = TRACK_TRANSITION_MS + 150;
  let handleVisibilityChange = null;

  function getSyncedOffset(track, now = Date.now()) {
    if (!track) return 0;
    if (track.state !== "playing") return track.syncedOffset ?? track.localOffset ?? 0;
    const baseOffset = track.syncedOffset ?? track.localOffset ?? 0;
    const syncedAt = track.syncedAt ?? now;
    return Math.min(baseOffset + Math.max(0, now - syncedAt), track.duration || 0);
  }

  function getSessionIdentity(track) {
    return (
      track.sessionKey ||
      [track.player, track.product, track.user].filter(Boolean).join("::")
    );
  }

  function getTrackSignature(track) {
    return [
      track.guid,
      track.updatedAt,
      track.mediaType,
      track.title,
      track.album,
      track.showTitle,
      track.seasonNumber,
      track.episodeNumber,
      track.duration,
    ]
      .filter((value) => value !== undefined && value !== null)
      .join("::");
  }

  function getDisplayArtist(session) {
    if (!session) return "";
    if (
      session.albumArtist &&
      session.albumArtist.toLowerCase() !== "various artists"
    ) {
      return `${session.albumArtist} \/ ${session.trackArtist}`;
    }
    return session.trackArtist || "Unknown Artist";
  }

  function getRenderedArtist(session) {
    if (!session) return "Unknown Artist";
    if (ARTIST_DISPLAY === "both") {
      return getDisplayArtist(session);
    }
    if (
      ARTIST_DISPLAY === "album" &&
      session.albumArtist &&
      session.albumArtist.toLowerCase() !== "various artists"
    ) {
      return session.albumArtist;
    }
    if (ARTIST_DISPLAY === "track" && session.trackArtist) {
      return session.trackArtist;
    }
    return "Unknown Artist";
  }

  function getTextSnapshot(session) {
    if (!session) return null;
    const mediaInfo = getMediaInfoParts(session);
    const clientInfo = getClientInfoParts(session);
    const displayLines = getDisplayLines(session, getRenderedArtist(session));
    return {
      identityKey: session.identityKey,
      viewType: session.viewType,
      title: displayLines.title,
      subtitle: displayLines.subtitle,
      detail: displayLines.detail,
      codec: mediaInfo.codec,
      videoDetails: session.videoDetails,
      audioDetails: session.audioDetails,
      subtitleDetails: session.subtitleDetails,
      playbackDecision: session.playbackDecision,
      mediaBadges: mediaInfo.badges,
      mediaBadgeTypes: mediaInfo.badgeTypes,
      clientBadges: clientInfo.badges,
    };
  }

  function firstItem(value) {
    return Array.isArray(value) ? value[0] : value;
  }

  function getValue(item, key) {
    if (!item) return undefined;
    if (item instanceof Element) return item.getAttribute(key);
    return item[key];
  }

  function getChild(item, key) {
    if (!item) return null;
    if (item instanceof Element) return item.querySelector(key);
    return firstItem(item[key]);
  }

  function getArray(item, key) {
    if (!item) return [];
    if (item instanceof Element) return Array.from(item.querySelectorAll(key));
    const value = item[key];
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function getType(item) {
    const attrType = getValue(item, "type");
    if (attrType) return attrType;
    if (item instanceof Element) {
      const tagName = item.tagName.toLowerCase();
      if (tagName === "track") return "track";
      if (tagName === "video") return "video";
    }
    return "track";
  }

  function getStreams(track, part, media) {
    if (track instanceof Element) {
      return [
        ...Array.from(part?.querySelectorAll("Stream") || []),
        ...Array.from(media?.querySelectorAll("Stream") || []),
        ...Array.from(track.querySelectorAll("Stream")),
      ];
    }

    return [
      ...getArray(part, "Stream"),
      ...getArray(media, "Stream"),
      ...getArray(track, "Stream"),
    ];
  }

  function getStreamByType(track, part, media, streamType) {
    const streams = getStreams(track, part, media);
    return streams.find(
      (stream) => Number(getValue(stream, "streamType")) === streamType,
    );
  }

  function isTruthyAttr(value) {
    return value === true || value === 1 || value === "1" || value === "true";
  }

  function getSelectedStreamByType(track, part, media, streamType) {
    const streams = getStreams(track, part, media).filter(
      (stream) => Number(getValue(stream, "streamType")) === streamType,
    );
    return streams.find((stream) => isTruthyAttr(getValue(stream, "selected"))) || streams[0];
  }

  function getAudioStream(track, part, media) {
    if (track instanceof Element) {
      return (
        (part && part.querySelector('Stream[streamType="2"]')) ||
        (part && part.querySelector("Stream")) ||
        track.querySelector("Stream")
      );
    }

    const streams = [
      ...getArray(part, "Stream"),
      ...getArray(media, "Stream"),
      ...getArray(track, "Stream"),
    ];
    return (
      streams.find((stream) => Number(getValue(stream, "streamType")) === 2) ||
      streams[0]
    );
  }

  function formatCodec(value) {
    if (!value) return "";
    return String(value)
      .replace(/_/g, " ")
      .trim()
      .toUpperCase();
  }

  function normalizeSubtitleFormat(value) {
    const codec = formatCodec(value);
    if (!codec) return "";
    if (codec === "S_TEXT/UTF8") return "SRT";
    if (codec === "S_TEXT/ASS") return "ASS";
    if (codec === "S_TEXT/SSA") return "SSA";
    if (codec === "S_HDMV/PGS") return "PGS";
    return codec.replace(/^S_TEXT\//, "");
  }

  function getLanguageLabel(stream) {
    return (
      getValue(stream, "languageTitle") ||
      getValue(stream, "language") ||
      getValue(stream, "languageCode") ||
      ""
    );
  }

  function getBitrateKbps(...values) {
    for (const value of values) {
      const num = Number(value);
      if (!isNaN(num) && num > 0) return Math.round(num);
    }
    return "";
  }

  function normalizeFrameRate(value) {
    const num = Number(value);
    if (isNaN(num) || num <= 0) return "";
    const rounded = Math.round(num * 1000) / 1000;
    return Number.isInteger(rounded)
      ? String(rounded)
      : String(rounded).replace(/0+$/, "").replace(/\.$/, "");
  }

  function normalizeIndex(value) {
    if (value === undefined || value === null || value === "") return "";
    const num = Number(value);
    return isNaN(num) ? "" : num;
  }

  function getVideoHdrLabel(stream) {
    const values = [
      getValue(stream, "hdr"),
      getValue(stream, "dynamicRange"),
      getValue(stream, "displayTitle"),
      getValue(stream, "colorPrimaries"),
      getValue(stream, "colorSpace"),
      getValue(stream, "colorTrc"),
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    if (values.some((value) => value.includes("dolby vision") || value === "dv")) {
      return "DV";
    }
    if (
      values.some(
        (value) =>
          value.includes("hdr") ||
          value.includes("bt2020") ||
          value.includes("smpte2084") ||
          value.includes("arib-std-b67"),
      )
    ) {
      return "HDR";
    }
    return "";
  }

  function normalizeVideoStream(stream, media, part) {
    if (!stream && !media && !part) return {};
    const width = getValue(stream, "width") || getValue(media, "width");
    const height = getValue(stream, "height") || getValue(media, "height");
    const resolution =
      getValue(media, "videoResolution") ||
      (height ? `${height}p` : width ? `${width}w` : "");

    return {
      codec: formatCodec(
        getValue(stream, "codec") ||
          getValue(media, "videoCodec") ||
          getValue(part, "videoCodec") ||
          "",
      ),
      profile: getValue(stream, "profile") || getValue(media, "videoProfile") || "",
      resolution,
      bitrate: getBitrateKbps(
        getValue(stream, "bitrate"),
        getValue(media, "bitrate"),
      ),
      frameRate: normalizeFrameRate(
        getValue(stream, "frameRate") || getValue(media, "videoFrameRate"),
      ),
      bitDepth: getValue(stream, "bitDepth") || "",
      hdr: getVideoHdrLabel(stream),
    };
  }

  function normalizeAudioStream(stream, media) {
    if (!stream && !media) return {};

    return {
      codec: formatCodec(
        getValue(stream, "codec") || getValue(media, "audioCodec") || "",
      ),
      profile: getValue(stream, "profile") || getValue(media, "audioProfile") || "",
      language: getLanguageLabel(stream),
      channels:
        getValue(stream, "audioChannelLayout") ||
        getValue(stream, "channels") ||
        getValue(media, "audioChannels") ||
        "",
      bitrate: getBitrateKbps(getValue(stream, "bitrate")),
      samplingRate: getValue(stream, "samplingRate") || "",
    };
  }

  function normalizeSubtitleStream(stream) {
    if (!stream) return {};

    return {
      codec: normalizeSubtitleFormat(
        getValue(stream, "codec") || getValue(stream, "format") || "",
      ),
      language: getLanguageLabel(stream),
      title: getValue(stream, "displayTitle") || "",
      forced: isTruthyAttr(getValue(stream, "forced")),
      default: isTruthyAttr(getValue(stream, "default")),
    };
  }

  function normalizePlaybackDecision(track, part, media, viewType) {
    const sessionNode = getChild(track, "Session");
    const transcodeSession = getChild(track, "TranscodeSession");
    const rawDecision = [
      getValue(sessionNode, "decision") ||
        "",
      getValue(transcodeSession, "decision") || "",
      getValue(track, "decision") || "",
      getValue(media, "decision") || "",
      getValue(part, "decision") || "",
      ...getStreams(track, part, media).map((stream) => getValue(stream, "decision") || ""),
      ...getStreams(track, part, media).map((stream) => getValue(stream, "location") || ""),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (rawDecision.includes("transcode") || transcodeSession) {
      return { type: "transcode", label: "Transcode" };
    }
    if (rawDecision.includes("directstream") || rawDecision.includes("direct stream")) {
      return { type: "direct-stream", label: "Direct Stream" };
    }
    if (
      rawDecision.includes("directplay") ||
      rawDecision.includes("direct play") ||
      rawDecision.includes("direct")
    ) {
      return { type: "direct-play", label: "Direct Play" };
    }

    if (["movie", "show"].includes(viewType)) {
      return { type: "direct-play", label: "Direct Play" };
    }

    return null;
  }

  function normalizeSession(track, fetchedAt) {
    const player = getChild(track, "Player");
    const user = getChild(track, "User");
    const mediaElem = getChild(track, "Media");
    const mediainfo = getChild(mediaElem, "Part") || getChild(track, "Part");
    const typedAudioStream = getSelectedStreamByType(track, mediainfo, mediaElem, 2);
    const audioStream = typedAudioStream || getAudioStream(track, mediainfo, mediaElem);
    const videoStream = getSelectedStreamByType(track, mediainfo, mediaElem, 1);
    const subtitleStream = getSelectedStreamByType(track, mediainfo, mediaElem, 3);
    const mediaType = getType(track);
    const viewType =
      mediaType === "movie" || mediaType === "video"
        ? "movie"
        : mediaType === "episode"
          ? "show"
          : "music";

    const trackArtist = (
      getValue(track, "originalTitle") ||
      getValue(track, "grandparentTitle") ||
      ""
    ).trim();
    const albumArtistRaw = (
      getValue(track, "grandparentTitle") || ""
    ).trim();
    const albumArtist =
      albumArtistRaw &&
      albumArtistRaw.toLowerCase() !== "various artists" &&
      albumArtistRaw.toLowerCase() !== trackArtist.toLowerCase()
        ? albumArtistRaw
        : "";

    const codecRaw =
      getValue(audioStream, "codec") ||
      getValue(audioStream, "audioCodec") ||
      getValue(mediaElem, "audioCodec") ||
      getValue(mediainfo, "container") ||
      "";

    const samplingRateAttr =
      getValue(audioStream, "samplingRate") ||
      getValue(mediaElem, "samplingRate") ||
      "";
    const samplingRateRaw = samplingRateAttr ? Number(samplingRateAttr) : NaN;
    let samplingRateKHz = "";
    if (!isNaN(samplingRateRaw) && samplingRateRaw > 0) {
      const val = Math.round((samplingRateRaw / 1000) * 10) / 10;
      samplingRateKHz =
        val % 1 === 0 ? String(val.toFixed(0)) : String(val.toFixed(1));
    }

    const bitrateAttr =
      getValue(audioStream, "bitrate") ||
      getValue(mediaElem, "bitrate") ||
      getValue(mediainfo, "bitrate") ||
      "";
    const bitrateNum = bitrateAttr ? Number(bitrateAttr) : NaN;
    const videoDetails = normalizeVideoStream(videoStream, mediaElem, mediainfo);
    const audioDetails = normalizeAudioStream(typedAudioStream, mediaElem);
    const subtitleDetails = normalizeSubtitleStream(subtitleStream);
    const playbackDecision = normalizePlaybackDecision(
      track,
      mediainfo,
      mediaElem,
      viewType,
    );

    const session = {
      mediaType,
      viewType,
      sessionKey:
        getValue(track, "sessionKey") ||
        getValue(getChild(track, "Session"), "id"),
      guid: getValue(track, "guid"),
      updatedAt: getValue(track, "updatedAt"),
      title: getValue(track, "title")?.trim() || "",
      tagline: getValue(track, "tagline")?.trim() || "",
      year:
        getValue(track, "year") ||
        getValue(track, "parentYear") ||
        getValue(track, "grandparentYear"),
      trackArtist,
      albumArtist,
      album: getValue(track, "parentTitle")?.trim() || "",
      showTitle: getValue(track, "grandparentTitle")?.trim() || "",
      seasonNumber: normalizeIndex(getValue(track, "parentIndex")),
      episodeNumber: normalizeIndex(getValue(track, "index")),
      episodeTitle:
        mediaType === "episode" ? getValue(track, "title")?.trim() || "" : "",
      art:
        viewType === "music"
          ? getValue(track, "parentThumb") ||
            getValue(track, "grandparentThumb") ||
            getValue(track, "thumb") ||
            ""
          : viewType === "show"
            ? getValue(track, "grandparentThumb") ||
              getValue(track, "thumb") ||
              getValue(track, "parentThumb") ||
              ""
          : getValue(track, "thumb") ||
            getValue(track, "grandparentThumb") ||
            getValue(track, "parentThumb") ||
            "",
      backgroundArt:
        viewType === "music"
          ? getValue(track, "parentThumb") ||
            getValue(track, "grandparentThumb") ||
            getValue(track, "thumb") ||
            ""
          : viewType === "show"
            ? getValue(track, "grandparentArt") ||
              getValue(track, "art") ||
              getValue(track, "grandparentThumb") ||
              getValue(track, "thumb") ||
              ""
            : getValue(track, "art") ||
              getValue(track, "thumb") ||
              getValue(track, "grandparentArt") ||
              "",
      duration: Number(getValue(track, "duration") || 0),
      localOffset: Number(getValue(track, "viewOffset") || 0),
      library: getValue(track, "librarySectionTitle"),
      state: getValue(player, "state"),
      player: getValue(player, "title"),
      product: getValue(player, "product"),
      user: getValue(user, "title"),
      codec: formatCodec(codecRaw),
      audioCodec: audioDetails.codec,
      videoCodec: videoDetails.codec,
      subtitleCodec: subtitleDetails.codec,
      videoDetails,
      audioDetails,
      subtitleDetails,
      playbackDecision,
      bitDepth:
        getValue(audioStream, "bitDepth") ||
        getValue(mediaElem, "bitDepth") ||
        "",
      samplingRate: samplingRateKHz,
      bitrate:
        !isNaN(bitrateNum) && bitrateNum > 0 ? Math.round(bitrateNum) : "",
    };

    return {
      ...session,
      syncedOffset: session.localOffset,
      syncedAt: fetchedAt,
      identityKey: getSessionIdentity(session),
      trackSignature: getTrackSignature(session),
    };
  }

  async function loadConfig({ reloadOnChange = false } = {}) {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load config");

      const nextConfig = await res.json();
      const nextVersion = nextConfig.CONFIG_VERSION ?? null;

      if (
        reloadOnChange &&
        configLoaded &&
        configVersion !== null &&
        nextVersion !== null &&
        nextVersion !== configVersion
      ) {
        window.location.reload();
        return;
      }

      config = nextConfig;
      configVersion = nextVersion;

      // Normalize allowed lists to lowercase trimmed strings for robust matching
      ALLOWED_PLAYERS = (config.PLAYERS || [])
        .map((p) => String(p).toLowerCase().trim())
        .filter(Boolean);
      ALLOWED_USERS = (config.USERS || [])
        .map((u) => String(u).toLowerCase().trim())
        .filter(Boolean);
      ALLOWED_LIBRARIES = (config.LIBRARIES || [])
        .map((l) => String(l).toLowerCase().trim())
        .filter(Boolean);
      // ARTIST_DISPLAY determines how to show artist info: 'track' = track artist only, 'album' = album artist only, 'both' = "album artist — track artist"
      ARTIST_DISPLAY = ["track", "album", "both"].includes(
        config.ARTIST_DISPLAY,
      )
        ? config.ARTIST_DISPLAY
        : "both";
      // SHOW_USERNAME determines whether to display the session user in the client line
      SHOW_USERNAME =
        config.SHOW_USERNAME === undefined
          ? true
          : Boolean(config.SHOW_USERNAME);
      // SHOW_PROGRESS determines whether to show the progress bar and time info
      SHOW_PROGRESS =
        config.SHOW_PROGRESS === undefined
          ? true
          : Boolean(config.SHOW_PROGRESS);
      // SHOW_MEDIAINFO determines whether to show codec/samplingRate/bitDepth info
      SHOW_MEDIAINFO =
        config.SHOW_MEDIAINFO === undefined
          ? true
          : Boolean(config.SHOW_MEDIAINFO);
      // SHOW_CLIENTINFO determines whether to show client product/player and optionally username
      SHOW_CLIENTINFO =
        config.SHOW_CLIENTINFO === undefined
          ? true
          : Boolean(config.SHOW_CLIENTINFO);
      // LOW_POWER_MODE disables marquee and reduces transition work for weaker devices
      LOW_POWER_MODE =
        config.LOW_POWER_MODE === undefined
          ? false
          : Boolean(config.LOW_POWER_MODE);

      configLoaded = true;
    } catch (err) {
      console.error("Failed to load runtime config", err);
    }
  }

  // Fetch Plex now playing sessions
  async function fetchNowPlaying() {
    if (!configLoaded) return;
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error("Failed to load sessions");

      let rawNodes = [];
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const payload = await res.json();
        rawNodes = payload?.MediaContainer?.Metadata || [];
      } else {
        const xmlText = await res.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(xmlText, "application/xml");
        rawNodes = Array.from(
          xml.querySelectorAll("MediaContainer > Metadata, MediaContainer > Track, MediaContainer > Video"),
        );
      }

      const fetchedAt = Date.now();
      let newTracks = rawNodes.map((track) =>
        normalizeSession(track, fetchedAt),
      );

      // Filter by allowed players if config is set
      // Apply filters in a single pass (AND semantics)
      if (
        ALLOWED_PLAYERS.length ||
        ALLOWED_USERS.length ||
        ALLOWED_LIBRARIES.length
      ) {
        newTracks = newTracks.filter((track) => {
          const p = String(track.player || "")
            .toLowerCase()
            .trim();
          const u = String(track.user || "")
            .toLowerCase()
            .trim();
          const l = String(track.library || "")
            .toLowerCase()
            .trim();
          if (ALLOWED_PLAYERS.length && !ALLOWED_PLAYERS.includes(p))
            return false;
          if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(u)) return false;
          if (ALLOWED_LIBRARIES.length && !ALLOWED_LIBRARIES.includes(l))
            return false;
          return true;
        });
      }

      const current = sessions;
      const activeSessionBefore = current[activeIndex || 0];
      const activeIdentityBefore = activeSessionBefore?.identityKey;

      const currentByIdentity = new Map(
        current.map((session) => [session.identityKey, session]),
      );
      const incomingByIdentity = new Map(
        newTracks.map((track) => [track.identityKey, track]),
      );

      // Preserve current ordering for active sessions to avoid visual churn when
      // Plex returns the same sessions in a different order between polls.
      const orderedTracks = [
        ...current
          .map((session) => incomingByIdentity.get(session.identityKey))
          .filter(Boolean),
        ...newTracks.filter((track) => !currentByIdentity.has(track.identityKey)),
      ];

      // Merge tracks: each client/session keeps a stable slide while the content
      // inside it updates when the track changes.
      const merged = orderedTracks.map((track) => {
        const existing = currentByIdentity.get(track.identityKey);

        if (!existing) {
          return { ...track };
        }

        if (existing.trackSignature !== track.trackSignature) {
          return { ...track };
        }

        return {
          ...track,
          localOffset: getSyncedOffset(track, fetchedAt),
        };
      });

      let nextActiveIndex = 0;
      if (merged.length > 0) {
        const preservedIndex = merged.findIndex(
          (session) => session.identityKey === activeIdentityBefore,
        );
        const currentIndex = activeIndex || 0;
        nextActiveIndex =
          preservedIndex >= 0
            ? preservedIndex
            : Math.min(currentIndex, merged.length - 1);
      }

      sessions = merged;

      // If we transitioned from no sessions to some, ensure activeIndex is valid and start slideshow
      if (merged.length > 0) {
        activeIndex = nextActiveIndex;
        if (current.length === 0) {
          // start at the first playing session
          const startIdx = nextPlayingIndex(0, merged);
          activeIndex = startIdx;
          startSlideshow();
        } else if (merged.length !== current.length) {
          startSlideshow();
        }
      } else {
        // no sessions — ensure activeIndex resets to 0 so UI shows "Nothing playing" consistently
        activeIndex = 0;
      }

      // If the currently active session is now paused, immediately advance
      // to the next playing session so paused items exit the slideshow faster.
      const listAfter = merged;
      if (listAfter.length) {
        const ci = activeIndex || 0;
        const active = listAfter[ci];
        if (active && active.state !== "playing") {
          const next = nextPlayingIndex(ci, listAfter);
          activeIndex = next;
        }
      }
    } catch (err) {
      console.error("Failed to fetch Plex sessions", err);
    }
  }

  function startProgress() {
    clearInterval(progressTimer);
    const intervalMs = LOW_POWER_MODE
      ? LOW_POWER_PROGRESS_INTERVAL_MS
      : DEFAULT_PROGRESS_INTERVAL_MS;
    progressTimer = setInterval(() => {
      if (!pageVisible) return;
      const now = Date.now();
      const currentIndex = activeIndex || 0;
      const currentSession = sessions[currentIndex];
      if (!currentSession || currentSession.state !== "playing") return;
      sessions = sessions.map((s, index) =>
        index === currentIndex && s.state === "playing"
          ? { ...s, localOffset: getSyncedOffset(s, now) }
          : s,
      );
    }, intervalMs);
  }

  function startSlideshow() {
    clearInterval(rotationTimer);
    if (sessions.length <= 1) return;
    rotationTimer = setInterval(() => {
      if (!pageVisible) return;
      const list = sessions;
      if (!list.length) return;
      const prev = activeIndex || 0;
      const next = nextPlayingIndex(prev, list);
      if (next !== prev) {
        activeIndex = next;
      }
    }, SESSION_ROTATION_MS);
  }

  // Find the next playing session index after `current`.
  // If no other playing sessions exist, returns `current`.
  function nextPlayingIndex(current, list) {
    const n = list.length;
    if (n === 0) return 0;
    for (let offset = 1; offset < n; offset++) {
      const idx = (current + offset) % n;
      if (list[idx] && list[idx].state === "playing") return idx;
    }
    return current;
  }

  function startAutoRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      if (!pageVisible) return;
      await loadConfig({ reloadOnChange: true });
      fetchNowPlaying();
    }, 15000);
  }

  let activeSession = $derived(sessions[activeIndex]);

  let previousActiveSession = null;
  let textOverlay = $state(null);
  let textOverlayTimer = null;

  $effect(() => {
    const currentSession = activeSession;

    if (currentSession) {
      const sameSessionTrackChanged =
        previousActiveSession &&
        previousActiveSession.identityKey === currentSession.identityKey &&
        previousActiveSession.trackSignature !== currentSession.trackSignature;

      if (sameSessionTrackChanged) {
        if (LOW_POWER_MODE) {
          if (textOverlayTimer) {
            clearTimeout(textOverlayTimer);
            textOverlayTimer = null;
          }
          textOverlay = null;
          previousActiveSession = currentSession;
          return;
        }
        textOverlay = getTextSnapshot(previousActiveSession);
        if (textOverlayTimer) clearTimeout(textOverlayTimer);
        textOverlayTimer = setTimeout(() => {
          textOverlay = null;
          textOverlayTimer = null;
        }, TRACK_TRANSITION_CLEANUP_MS);
      }

      previousActiveSession = currentSession;
    } else {
      previousActiveSession = null;
      textOverlay = null;
      if (textOverlayTimer) {
        clearTimeout(textOverlayTimer);
        textOverlayTimer = null;
      }
    }
  });

  onMount(async () => {
    await loadConfig();

    if (!configLoaded) return;

    handleVisibilityChange = () => {
      pageVisible = document.visibilityState === "visible";
      if (pageVisible) {
        fetchNowPlaying();
        startProgress();
        startSlideshow();
        startAutoRefresh();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    fetchNowPlaying();
    if (SHOW_PROGRESS) {
      startProgress();
    }
    startSlideshow();
    startAutoRefresh();
  });

  onDestroy(() => {
    clearInterval(progressTimer);
    clearInterval(rotationTimer);
    clearInterval(refreshTimer);
    if (textOverlayTimer) clearTimeout(textOverlayTimer);
    if (handleVisibilityChange) {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
  });
</script>

{#if !configLoaded}
  <div class="idle">Loading...</div>
{:else if activeSession}
  <div class={`fade-wrapper ${LOW_POWER_MODE ? "low-power" : ""}`}>
    {#each sessions as session, i (session.identityKey)}
      <SessionSlide
        session={session}
        isActive={i === activeIndex}
        lowPowerMode={LOW_POWER_MODE}
        pageVisible={pageVisible}
        renderedArtist={getRenderedArtist(session)}
        textOverlay={textOverlay}
        showProgress={SHOW_PROGRESS}
        showMediaInfo={SHOW_MEDIAINFO}
        showClientInfo={SHOW_CLIENTINFO}
        showUsername={SHOW_USERNAME}
      />
    {/each}
  </div>
{:else}
  <div class="idle">Nothing playing</div>
{/if}
