<svelte:options runes={true} />

<script>
  import { onMount, onDestroy } from "svelte";
  import SessionSlide from "./components/SessionSlide.svelte";
  import {
    getClientInfoParts,
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
    return [track.guid, track.updatedAt, track.title, track.album, track.duration]
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
    return {
      identityKey: session.identityKey,
      title: session.title,
      artist: getRenderedArtist(session),
      album: session.album,
      year: session.year,
      codec: mediaInfo.codec,
      mediaBadges: mediaInfo.badges,
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

  function normalizeSession(track, fetchedAt) {
    const player = getChild(track, "Player");
    const user = getChild(track, "User");
    const mediaElem = getChild(track, "Media");
    const mediainfo = getChild(mediaElem, "Part") || getChild(track, "Part");
    const audioStream = getAudioStream(track, mediainfo, mediaElem);

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

    const session = {
      sessionKey:
        getValue(track, "sessionKey") ||
        getValue(getChild(track, "Session"), "id"),
      guid: getValue(track, "guid"),
      updatedAt: getValue(track, "updatedAt"),
      title: getValue(track, "title")?.trim() || "",
      year: getValue(track, "parentYear"),
      trackArtist,
      albumArtist,
      album: getValue(track, "parentTitle")?.trim() || "",
      art:
        getValue(track, "parentThumb") ||
        getValue(track, "grandparentThumb") ||
        "",
      duration: Number(getValue(track, "duration") || 0),
      localOffset: Number(getValue(track, "viewOffset") || 0),
      library: getValue(track, "librarySectionTitle"),
      state: getValue(player, "state"),
      player: getValue(player, "title"),
      product: getValue(player, "product"),
      user: getValue(user, "title"),
      codec: codecRaw ? codecRaw.toUpperCase() : "",
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
        rawNodes = Array.from(xml.querySelectorAll("Track"));
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
